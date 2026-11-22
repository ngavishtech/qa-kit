export const meta = {
  name: 'feature-implement',
  description: 'Write, execute/heal, review, and (if authorized) deliver tests for pre-approved plans from feature-plan - one plan runs in the current checkout, several plans each get their own isolated worktree/branch, capped concurrency',
  phases: [
    { title: 'Write', detail: 'agent-writer per plan' },
    { title: 'Execute', detail: 'agent-executor per plan - runs and heals unless args.heal === false' },
    { title: 'Review', detail: 'agent-reviewer per plan - reviews and checks the specs against the plan (verify-coverage), fixes unless args.apply === false, no git' },
    { title: 'Deliver', detail: 'agent-deliverer per plan - skipped unless args.commit, args.push or args.createPr; commit, then push/PR only if authorized' },
  ],
}

// args.plans: array of feature-plan's output entries (task, planPath, testType, ...) that a human
// has reviewed and approved - filter feature-plan's report down to only the approved ones before
// calling this. The plan file (qa-kit-artifacts/<slug>-test-plan.md, gitignored) is the only thing carried over
// from feature-plan; no worktree or branch exists yet at this point.
// Where the work happens is decided here, once, from the plan count (ISOLATED below): exactly one
// plan runs in the CURRENT checkout (on a new feature/<slug> branch if you're on the default
// branch, or on whatever feature branch you're already on); two or more each get their own git
// worktree at <worktreeDir>/<index>-<slug> on feature/<index>-<slug> off <baseRef>, so parallel
// writes/test runs/commits never collide.
// args.maxParallel: optional override for MAX_PARALLEL_FEATURES below.
// args.commit: optional, default false. Only true when the human's original request that triggered
// THIS run explicitly asked for the work to be committed - decided once, up front, by whoever calls
// Workflow(), never per-feature mid-run. When false (and push/createPr are false too) the Deliver
// stage does not run at all: the tests stay uncommitted in the checkout (one plan) or in each plan's
// worktree (several), report.committed is false, and the human delivers later with feature-deliver
// or by hand. Implied by push and createPr (you can't push what isn't committed).
// args.push: optional, default false. Only true when the human's original request explicitly asked
// for the branches to be pushed - same up-front rule. When false, every committed feature branch is
// left unpushed - report.pushed will be false, and the human pushes manually (or re-runs with push
// explicitly requested) after reviewing each branch. This is the real confirmation gate for pipeline
// use, since a mid-script interactive prompt isn't possible. Implies commit.
// args.createPr: optional, default false. Only true when the human's original request explicitly
// asked for PRs to be opened for this run. Implies push (you can't PR an unpushed branch).
// args.heal: optional, default true. The Execute stage heals failures (agent-executor invokes
// heal-tests, which composes execute-tests) unless this is explicitly false, in which case it only
// runs and classifies (agent-executor invokes execute-tests alone, no edits). Default is true, not
// false, because this pipeline's whole purpose is to hand Review/Deliver passing tests - opting out
// is for a human who wants to see raw failures before letting anything touch the branch.
// args.apply: optional, default true. Same shape as args.heal, one stage over: the Review stage
// applies its own findings (agent-reviewer invokes review-tests, then apply-review-fixes) unless this
// is explicitly false, in which case it only reviews and reports (agent-reviewer invokes review-tests
// alone, no edits). Default is true for the same reason heal defaults true - Deliver should receive
// a clean, already-fixed branch, not a pile of findings nobody acted on; opting out is for a human
// who wants to see findings before anything touches the branch.
// args.level: optional, one of smoke | sanity | regression (case-insensitive), default unset = every level.
// Decided once per invocation and applied to every plan in it. The Write stage implements only the
// scenarios whose `Level:` field in the plan file equals this value (exact level, not cumulative), and
// skips scenarios an earlier run already implemented, so running smoke first and sanity later adds only
// the delta on the same branch. A plan with no scenario at that level makes the Write stage block with
// a clear reason. Later stages need no filter: they work on the spec files the Write stage returns.
// args.plans[].priorOwned: optional, the `ownedFiles` of the previous feature-implement report entry for the
// same plan (the runner reads it from qa-kit-artifacts/latest/, the Claude command from the conversation).
// A run that does not commit leaves its files uncommitted, so without this list the next run would take them
// for the user's own changes. With it, they are this pipeline's earlier work: they are subtracted from the
// baseline, continued from, and carried into this run's `ownedFiles`.
// Every report entry carries `ownedFiles`: each path the pipeline created or changed on the branch (Write's
// filesWritten and specFiles, Execute's and Review's filesChanged, plus priorOwned). Review is limited to
// those paths, and Deliver stages exactly those paths and nothing else (the rest goes to `skippedPaths`).

const MAX_PARALLEL_FEATURES = args?.maxParallel || 3
// The Workflow tool or the runner sets the agent prefix through args.agentPrefix ("qa-kit:" for Claude Code,
// "qa-kit-" for OpenCode, "" for none) - this is the one place the namespace lives.
const AGENT_PREFIX = args?.agentPrefix ?? 'qa-kit:'

const PR_AUTHORIZED = args?.createPr === true
const PUSH_AUTHORIZED = args?.push === true || PR_AUTHORIZED
const COMMIT_AUTHORIZED = args?.commit === true || PUSH_AUTHORIZED
const HEAL = args?.heal !== false
const APPLY = args?.apply !== false
const LEVELS = ['smoke', 'sanity', 'regression']
const LEVEL = args?.level === undefined || args.level === null ? undefined : String(args.level).toLowerCase()
if (LEVEL !== undefined && !LEVELS.includes(LEVEL)) {
  throw new Error(`args.level must be one of ${LEVELS.join(', ')} (got "${args.level}")`)
}
const LEVEL_LABEL = LEVEL && LEVEL[0].toUpperCase() + LEVEL.slice(1)

// args.baseRef (default origin/HEAD, i.e. whatever the remote's default branch is), args.worktreeDir
// (default ../worktrees, relative to the git root, which is also the project folder unless qa-kit lives in a subfolder) and args.installCommand (default: auto-detect from the lockfile) replace what
// used to be hard-coded for one repo - override per run, or set once in the command if a repo needs it.
const BASE_REF = args?.baseRef || 'origin/HEAD'
const WORKTREE_DIR = (args?.worktreeDir || '../worktrees').replace(/[\\/]+$/, '')
const INSTALL_NOTE = args?.installCommand
  ? `run \`${args.installCommand}\` inside the worktree`
  : `detect the package manager from the lockfile in the main checkout's project folder (yarn.lock -> \`yarn install --frozen-lockfile\`, pnpm-lock.yaml -> \`pnpm install --frozen-lockfile\`, package-lock.json -> \`npm ci\`) and run that inside the worktree's project folder, never a different manager than the lockfile's`

// One agent running through this invocation stays headed (nothing to contend with, and a human
// may well be watching this one deliberately-scoped run); several running at once go headless
// (no one's watching any single one of them, and N headed browsers fight over the same machine).
// Decided once for the whole invocation from the total plan count, not dynamically per batch -
// the script can't observe true moment-to-moment overlap between agent() calls anyway. Standalone
// the standalone execute-tests skill (not through this workflow at all) is a separate path and always stays headed.
const HEADLESS = args.plans.length > 1

// Same threshold as HEADLESS and for the same reason: isolation only matters when features run
// side by side. A lone feature gets the current checkout - no worktree to create, find, or clean up.
const ISOLATED = args.plans.length > 1

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

// Slug comes from the plan file's name (qa-kit-artifacts/ABC-123-test-plan.md -> abc-123), the one stable
// identifier feature-plan hands over. Index-prefixed only when isolated, so two features can never
// collide on a worktree path or branch name.
function planSlug(plan, i) {
  const base = String(plan.planPath || plan.task || 'feature')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/-test-plan$/i, '')
  const slug = slugify(base) || 'feature'
  return ISOLATED ? `${i}-${slug}` : slug
}

const PLANS = args.plans.map((p, i) => {
  const slug = planSlug(p, i)
  return { ...p, slug, branch: `feature/${slug}` }
})

const WRITE_SCHEMA = {
  type: 'object',
  properties: {
    specFiles: { type: 'array', items: { type: 'string' } },
    // Every path this stage created or changed (specs and support code), relative to the git root as git prints it.
    filesWritten: { type: 'array', items: { type: 'string' } },
    lintClean: { type: 'boolean' },
    worktreePath: { type: 'string' },
    branch: { type: 'string' },
    notes: { type: 'string' },
    // Paths already modified/untracked BEFORE this run touched anything (git status --porcelain at start),
    // minus the files an earlier run of this pipeline left (priorOwned).
    // They belong to the user: Deliver must never stage them.
    baselineChanges: { type: 'array', items: { type: 'string' } },
    blocked: { type: 'boolean' },
    blockReason: { type: 'string' },
  },
  required: ['blocked'],
}

const EXECUTE_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    healedIssues: { type: 'array', items: { type: 'string' } },
    // Every path edited while healing, relative to the git root as git prints it (empty when nothing was edited).
    filesChanged: { type: 'array', items: { type: 'string' } },
    lintClean: { type: 'boolean' },
    blocked: { type: 'boolean' },
    blockReason: { type: 'string' },
  },
  required: ['passed', 'blocked'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    lintClean: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    // One short line per planned scenario the coverage check found missing or weak (empty when clean).
    coverageGaps: { type: 'array', items: { type: 'string' } },
    blocked: { type: 'boolean' },
    blockReason: { type: 'string' },
  },
  required: ['lintClean', 'filesChanged'],
}

const DELIVER_SCHEMA = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    pushed: { type: 'boolean' },
    prUrl: { type: 'string' },
    // Paths that showed changes but were not staged because the pipeline did not produce them (git root relative).
    skippedPaths: { type: 'array', items: { type: 'string' } },
    blocked: { type: 'boolean' },
    blockReason: { type: 'string' },
  },
  required: ['committed', 'pushed', 'blocked'],
}

// Everything the pipeline produced on this plan's branch so far: files an earlier run left (priorOwned) plus what each
// stage that already ran reported. History keeps every stage's own result, so a later stage's field of the same name
// cannot hide an earlier one.
function ownedFilesOf(entry) {
  const fromStages = (entry.history || []).flatMap(step => [...(step.filesWritten || []), ...(step.specFiles || []), ...(step.filesChanged || [])])
  return [...new Set([...(entry.priorOwned || []), ...fromStages].map(file => String(file).replace(/\\/g, '/')))]
}

// meta.phases titles are matched exactly, so the phase passed to agent() must use the same capitalised strings.
const PHASE_TITLE = { write: 'Write', execute: 'Execute', review: 'Review', deliver: 'Deliver' }

function withStage(prev, stageName, agentType, skill, result) {
  const history = [...(prev?.history || []), { stage: stageName, agentType, skill, ...result }]
  return { ...prev, ...result, stage: stageName, agentType, skill, history }
}

function writePrompt(plan) {
  const setup = ISOLATED
    ? `Several features are running through this invocation at once, so first set up an isolated git worktree for this one: resolve the plan's absolute path in the current checkout BEFORE changing directory (qa-kit-artifacts/ is gitignored, so the plan will not exist inside the worktree - read it from the current checkout), ` +
      `fetch origin, then create a worktree at ${WORKTREE_DIR}/${plan.slug} (a relative folder is relative to the git root, \`git rev-parse --show-toplevel\`, not to the folder you are in) on a new branch ${plan.branch} off ${BASE_REF} ` +
      `(git worktree add ${WORKTREE_DIR}/${plan.slug} -b ${plan.branch} ${BASE_REF}) - or, if that worktree/branch already exists from a prior run, reuse it instead of failing. ` +
      `A fresh worktree has neither the gitignored .env nor node_modules, so tests and lint cannot run without both: resolve the main checkout's absolute path before changing directory, ` +
      `copy its .env into the worktree's project folder (the same place, next to package.json; if the main checkout has no .env, skip the copy and continue), then ${INSTALL_NOTE} ` +
      `(skip the install if a reused worktree already has node_modules). Never stage or commit .env. ` +
      `A worktree is a checkout of the whole repository. Before you change directory, run \`git rev-parse --show-prefix\` in the current checkout: if it prints a non-empty path (qa-kit lives in a subfolder of a larger repo), your project folder inside the worktree is <worktree>/<that path>, not the worktree root - copy .env, install, run everything and report worktreePath for THAT folder. ` +
      `Do ALL writing for this feature inside that project folder of the worktree, never the main checkout. `
    : `Only one feature is running through this invocation, so work directly in the current checkout - do NOT create a git worktree. ` +
      `First run git fetch origin and check whether the local default branch is behind origin (only look - never pull, merge, reset or otherwise move it). ` +
      `If the current branch is the repo's default branch (master/main): if ${plan.branch} already exists locally (e.g. from a prior run), switch to it (git checkout ${plan.branch}), otherwise create it from the current HEAD (git checkout -b ${plan.branch}); ` +
      `if you are already on some other branch, stay on it and use it as-is. If switching fails (e.g. uncommitted changes that conflict with the target branch), report blocked with the exact git error rather than stashing or discarding anything. ` +
      `Everything already modified or untracked in the working tree before you start belongs to the user - leave it untouched. `
  const levelNote = LEVEL
    ? `Implement ONLY the scenarios whose Level is ${LEVEL_LABEL} (exact level, not cumulative: skip Smoke/Sanity/Regression scenarios of any other level, and do not infer a scenario's level - use its Level field). ` +
      `Skip any ${LEVEL_LABEL} scenario that existing specs already implement (an earlier run on this plan); write only what is missing. ` +
      `Create a Proposed Support Additions entry or perform an Existing (renamed) move only if one of the scenarios you implement needs it; defer the rest and say so in notes. ` +
      `The ${LEVEL_LABEL} scenarios must still respect the Level rules (Smoke: at most 5 per feature, Critical, production-safe). ` +
      `specFiles must list every spec file you created or added to. If the plan has no ${LEVEL_LABEL} scenario to write (none at that level, or all already implemented), write nothing and return blocked: true with a blockReason saying which. `
    : ''
  const prior = plan.priorOwned || []
  const priorNote = prior.length
    ? `An earlier run of this pipeline on this plan left these files uncommitted: ${prior.join(', ')}. They are this pipeline's own work, not the user's: continue from them (reuse or add to them), leave them out of baselineChanges, and list any of them you change again in filesWritten. `
    : ''
  const existingNote =
    'Before writing a scenario, check whether a test for it already exists (the repo\'s test index first, then the spec files this plan covers): skip it if so, so running this plan twice writes nothing new. ' +
    'A scenario whose Description starts with "Extends <file>" is added as a test inside that existing spec and describe, reusing its setup, never as a copy of the original test. '
  return (
    `${setup}Then implement tests from the approved plan at ${plan.planPath} (test type: ${plan.testType}). ${levelNote}${existingNote}` +
    `Before you change anything, run git status --porcelain -- . in the directory you will work in (if it lists an untracked directory, list that directory's files with git status --porcelain -uall -- <directory>) and return every path it lists, exactly as git prints it (relative to the git root), as baselineChanges (an empty array in a fresh worktree) - those belong to the user, not to this run. ${priorNote}` +
    `Also return filesWritten: every path you create or change in this stage - spec files and support code such as Page Objects, fixtures, constants and helpers - relative to the git root, as git prints it. ` +
    `Return the absolute path of the directory you worked in as worktreePath, the branch you ended up on as branch, and always blocked: false on success (or blocked: true with blockReason if setup or switching failed). ` +
    `Also return a short notes string${ISOLATED ? '' : ' saying which branch the user is left on and, if the local default branch was behind origin, how far behind (so they can update it themselves)'}.`
  )
}

function executePrompt(written) {
  const headlessNote = HEADLESS
    ? 'Multiple features are running through this invocation at once - use HEADLESS=true for every test run in this stage.'
    : 'Only one feature is running through this invocation - headed is fine, use your normal standalone default.'
  const healNote = HEAL
    ? 'Heal any failures (invoke heal-tests, which runs execute-tests first) - this pipeline needs passing tests before Review/Deliver.'
    : '--no-heal was requested for this run - run only (invoke execute-tests alone), do not heal, make no edits.'
  return (
    `Operating inside ${written.worktreePath} (branch ${written.branch}), ${HEAL ? 'run and heal' : 'run (no healing)'}: ${(written.specFiles || []).join(', ')}. ` +
    `${headlessNote} ${healNote} Return filesChanged: every path you edit in this stage, relative to the git root as git prints it (an empty array if you edit nothing).`
  )
}

function reviewPrompt(executed) {
  const coverageNote =
    `The approved plan is ${executed.planPath}: after review-tests, also invoke verify-coverage in implementation mode with that plan and these spec files (${(executed.specFiles || []).join(', ')})` +
    `${LEVEL ? `, level ${LEVEL} (only the plan's ${LEVEL_LABEL} scenarios were implemented in this run)` : ''}, and treat its findings as part of this review. ` +
    'If it finds a planned scenario with no test, report blocked with the scenario names as blockReason (that needs write-tests, not a review fix) and list them in coverageGaps; also list weak scenarios there. '
  const applyNote = APPLY
    ? 'Apply fixes (invoke apply-review-fixes against your findings) and run fix-lint per your normal rules - this pipeline needs a clean, already-fixed branch before Deliver.'
    : '--no-apply was requested for this run - invoke review-tests alone, report findings only, do not apply anything, make no edits.'
  const owned = ownedFilesOf(executed)
  const baseline = executed.baselineChanges || []
  const scopeNote = owned.length
    ? `Review and edit only these files, which are everything this pipeline produced on the branch: ${owned.join(', ')}. ` +
      (baseline.length ? `These paths belong to the user and must not be edited: ${baseline.join(', ')}. ` : '') +
      'A finding in any other file is reported but never edited. '
    : ''
  return (
    `In Review mode: operating inside ${executed.worktreePath} (branch ${executed.branch}), review the test files just written and healed ` +
    `(healing notes: ${(executed.healedIssues || []).join('; ') || 'none'}). ${scopeNote}` +
    `${coverageNote}${applyNote} Do NOT commit, push, or open a PR here - that's a separate Deliver step, even though it's the same agent.`
  )
}

function deliverPrompt(reviewed) {
  const authNote = PR_AUTHORIZED
    ? 'PR creation was explicitly requested for this run - invoke create-pr (which composes commit-and-push internally), telling it push and PR creation are both pre-authorized so it skips its interactive confirmations.'
    : PUSH_AUTHORIZED
      ? 'Push was explicitly requested for this run (but not PR creation) - invoke commit-and-push, telling it push is pre-authorized so it skips its interactive confirmation. Do not invoke create-pr.'
      : 'Only a commit was requested for this run (neither push nor PR creation) - invoke commit-and-push, telling it push is NOT pre-authorized, so it commits only and leaves the branch for the human to push manually.'
  const baseline = reviewed.baselineChanges || []
  const owned = ownedFilesOf(reviewed)
  const baselineNote = baseline.length
    ? `These paths were already modified or untracked before the run started and belong to the user - do NOT stage or commit them: ${baseline.join(', ')}. If one of them is also in the list above, do not stage it either; report blocked with blockReason naming the path so a human can split the change. `
    : ''
  const scopeNote = owned.length
    ? `Stage exactly these paths, which are everything this pipeline produced on the branch, and only those that still show changes in git status (git add -- <path> for each, never a directory, never -A): ${owned.join(', ')}. ` +
      `${baselineNote}Anything else that shows changes belongs to someone else: leave it unstaged and return its paths in skippedPaths (relative to the git root).`
    : baseline.length
      ? `Deliver only what THIS run produced (from write-tests, execute-tests, and the prior Review step). ${baselineNote}Return anything you leave out in skippedPaths.`
      : 'Deliver everything outstanding on this branch (from write-tests, execute-tests, and the prior Review step); nothing was modified before this run started.'
  return (
    `In Deliver mode: operating inside ${reviewed.worktreePath} (branch ${reviewed.branch}). ${scopeNote} ` +
    (LEVEL ? `This run implemented only the ${LEVEL_LABEL}-level scenarios of the plan; say so in the commit message (and PR description, if any). ` : '') +
    `If \`git rev-parse --show-prefix\` prints a non-empty path there, qa-kit lives in a subfolder of a larger repo: stage with root-anchored pathspecs and look only at that folder (\`-- .\`), as the git-safety pattern describes. ${authNote}`
  )
}

// Retries once on a null/errored agent() call, and short-circuits if the previous stage was
// already blocked, so a transient failure or an upstream block is recorded once with a clear
// reason instead of the feature either silently vanishing or cascading into a confusing crash
// (e.g. executeStage reading .specFiles off a write-stage result that never got that far).
async function runStage(prev, stageName, agentType, skill, prompt, schema, label) {
  if (prev.blocked) return prev
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await agent(prompt, { agentType: AGENT_PREFIX + agentType, phase: PHASE_TITLE[stageName], label, schema })
      if (r) return withStage(prev, stageName, agentType, skill, r)
      log(`${label}: ${stageName} returned nothing (attempt ${attempt}/2)${attempt < 2 ? ' - retrying' : ''}`)
    } catch (err) {
      log(`${label}: ${stageName} errored (attempt ${attempt}/2): ${err?.message || err}${attempt < 2 ? ' - retrying' : ''}`)
    }
  }
  return withStage(prev, stageName, agentType, skill, {
    blocked: true,
    blockReason: `${stageName} failed twice (transient agent failure or terminal error) - needs a human to investigate and re-run this feature`,
  })
}

function writeStage(plan) {
  return runStage(plan, 'write', 'agent-writer', 'write-tests', writePrompt(plan), WRITE_SCHEMA, `write:${plan.branch}`)
}

function executeStage(written) {
  const skill = HEAL ? 'heal-tests' : 'execute-tests'
  return runStage(written, 'execute', 'agent-executor', skill, executePrompt(written), EXECUTE_SCHEMA, `execute:${written.branch}`)
}

function reviewStage(executed) {
  const skill = APPLY ? 'apply-review-fixes' : 'review-tests'
  return runStage(executed, 'review', 'agent-reviewer', skill, reviewPrompt(executed), REVIEW_SCHEMA, `review:${executed.branch}`)
}

function deliverStage(reviewed) {
  if (!COMMIT_AUTHORIZED) {
    if (!reviewed.blocked) log(`deliver:${reviewed.branch}: skipped (no --commit, --push or --pr) - tests left uncommitted in ${reviewed.worktreePath}; run feature-deliver to review and commit them`)
    return reviewed
  }
  const skill = PR_AUTHORIZED ? 'create-pr' : 'commit-and-push'
  return runStage(reviewed, 'deliver', 'agent-deliverer', skill, deliverPrompt(reviewed), DELIVER_SCHEMA, `deliver:${reviewed.branch}`)
}

const allResults = []
for (let offset = 0; offset < PLANS.length; offset += MAX_PARALLEL_FEATURES) {
  const batch = PLANS.slice(offset, offset + MAX_PARALLEL_FEATURES)
  log(`Implementing plans ${offset + 1}-${offset + batch.length} of ${PLANS.length} (max ${MAX_PARALLEL_FEATURES} in parallel, ${ISOLATED ? 'one worktree each' : 'current checkout'})`)
  const batchResults = await pipeline(batch, writeStage, executeStage, reviewStage, deliverStage)
  allResults.push(...batchResults)
}

const report = PLANS.map((p, i) => {
  const r = allResults[i]
  return {
    task: p.task,
    planPath: p.planPath,
    level: LEVEL,
    worktreePath: r?.worktreePath,
    branch: r?.branch ?? p.branch,
    notes: r?.notes,
    stage: r?.stage || 'write',
    agent: r?.agentType,
    skill: r?.skill,
    blocked: r?.blocked ?? false,
    blockReason: r?.blockReason,
    lintClean: r?.lintClean,
    coverageGaps: r?.coverageGaps,
    ownedFiles: r ? ownedFilesOf(r) : [...(p.priorOwned || [])],
    skippedPaths: r?.skippedPaths,
    committed: r?.committed ?? false,
    pushed: r?.pushed ?? false,
    prUrl: r?.prUrl,
    history: r?.history || [],
  }
})

const blocked = report.filter(r => r.blocked)
if (blocked.length) {
  log(`${blocked.length}/${report.length} feature(s) blocked on a human decision (stage: ${blocked.map(r => r.stage).join(', ')}) - see blockReason per feature.`)
}

return report
