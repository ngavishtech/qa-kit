export const meta = {
  name: 'feature-deliver',
  description: 'Review (with a confirming re-review after fixes) and deliver (commit, push/PR if authorized) tests already on a branch - standalone tail end of feature-implement for branches that only need Review/Deliver, not Write/Execute',
  phases: [
    { title: 'Review', detail: 'test-reviewer agent per target - reviews, fixes unless args.apply === false, confirms with a re-review if apply-review-fixes changed anything, no git' },
    { title: 'Deliver', detail: 'test-deliverer agent per target - always commits (running this workflow is the request to deliver); push/PR only if authorized' },
  ],
}

// args.targets: array of { task, branch, worktreePath } - same shape as feature-plan/feature-implement
// report entries, minus testType/planPath (Write/Execute already happened, or never applied here).
// Resolved by the /qa-kit:feature-deliver command before this script runs - see feature-deliver.md's
// 3-tier resolution order (named match in conversation -> all such entries -> cwd fallback).
// args.maxParallel: optional override for MAX_PARALLEL_FEATURES below.
// args.targets[].ownedFiles: optional, every path the feature-implement run produced on that branch (its
// report's `ownedFiles`). Running feature-deliver is the request to deliver EVERYTHING git sees as changed in
// the project folder (modified, deleted, renamed, staged, or new and not ignored): the pipeline's files and
// anything the person changed or added by hand, including a file that was already modified before the
// implement run and files that are not test files. Only git decides what is left out: a path git ignores never
// shows up, and the usual staging safety rules still stop on a secret file (.env, *.pem, *.key, a token in the
// diff) and skip another package manager's lockfile. `ownedFiles` only tells the two apart: everything staged
// that is not in it is returned as `handChanges`, named in the commit message, and warned about by the runner.
// Absent for the current-checkout fallback, where nothing recorded what the pipeline produced: then nothing is
// reported as `handChanges` and the report's `scope` says so.
// args.targets[].baselineChanges: optional, paths that were already modified before the implement run
// started (feature-implement's report carries them). Informational here: Review never edits them (they are
// the person's work in progress) but Deliver stages them like everything else git shows as changed.
// No args.commit - this workflow always commits, since running it is the request to deliver. The flag
// is accepted by the runner and the commands for symmetry with feature-implement, and changes nothing.
// args.push: optional, default false. Only true when the human's original request that triggered
// THIS run explicitly asked for the branches to be pushed - decided once, up front, never per-target
// mid-run (there's no human to ask mid-run). When false, every target gets committed but left
// unpushed - report.pushed will be false, and the human pushes manually (or re-runs with push
// explicitly requested) after reviewing each branch.
// args.createPr: optional, default false. Only true when the human's original request explicitly
// asked for PRs to be opened for this run. Implies push (you can't PR an unpushed branch).
// args.apply: optional, default true. The Review stage applies its own findings (test-reviewer
// invokes review-tests, then apply-review-fixes, then a confirming re-review via review-tests if
// anything actually changed) unless this is explicitly false, in which case it only reviews and
// reports (test-reviewer invokes review-tests alone, no edits, no re-review - there's nothing to
// confirm). Default is true for the same reason feature-implement.js's args.apply defaults true -
// Deliver should receive a clean, already-fixed branch, not a pile of unactioned findings.
// No args.heal - there is no Execute stage in this workflow.

const MAX_PARALLEL_FEATURES = args?.maxParallel || 3
// The Workflow tool or the runner sets the agent prefix through args.agentPrefix ("qa-kit:" for Claude Code,
// "qa-kit-" for OpenCode, "" for none) - this is the one place the namespace lives.
const AGENT_PREFIX = args?.agentPrefix ?? 'qa-kit:'

const PR_AUTHORIZED = args?.createPr === true
const PUSH_AUTHORIZED = args?.push === true || PR_AUTHORIZED
const APPLY = args?.apply !== false

// One target running through this invocation stays headed; several running at once go headless -
// same rule as feature-implement.js, decided once for the whole invocation from the total target
// count, not dynamically per batch. Relevant here because apply-review-fixes' confirming re-run
// (execute-tests) launches a browser same as feature-implement.js's Execute stage does.
const HEADLESS = args.targets.length > 1

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    lintClean: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    reReviewed: { type: 'boolean' },
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
    // Paths staged that the pipeline did not produce: files the person changed or added by hand (git root relative).
    handChanges: { type: 'array', items: { type: 'string' } },
    // Paths that showed changes but were not staged because a staging safety rule refused them: another package manager's lockfile (git root relative). A secret file blocks the target instead.
    skippedPaths: { type: 'array', items: { type: 'string' } },
    blocked: { type: 'boolean' },
    blockReason: { type: 'string' },
  },
  required: ['committed', 'pushed', 'blocked'],
}

// meta.phases titles are matched exactly, so the phase passed to agent() must use the same capitalised strings.
const PHASE_TITLE = { review: 'Review', deliver: 'Deliver' }

function withStage(prev, stageName, agentType, skill, result) {
  const history = [...(prev?.history || []), { stage: stageName, agentType, skill, ...result }]
  return { ...prev, ...result, stage: stageName, agentType, skill, history }
}

function reviewPrompt(target) {
  const headlessNote = HEADLESS
    ? 'Multiple targets are running through this invocation at once - use HEADLESS=true for any test run in this stage.'
    : 'Only one target is running through this invocation - headed is fine, use your normal standalone default.'
  const applyNote = APPLY
    ? 'Apply fixes (invoke apply-review-fixes against your findings) and run fix-lint per your normal rules. If apply-review-fixes changes any file, invoke review-tests one more time against this same branch to confirm no Blocking/Should-fix findings remain - a confirming re-review, not a second fix cycle. If apply-review-fixes changed nothing, skip the re-review entirely. If the re-review still finds a Blocking/Should-fix finding that could not be resolved (e.g. it needs a new file - write-tests territory), do NOT let this proceed to Deliver - report blocked/blockReason instead. Report whether the confirming re-review actually ran (reReviewed).'
    : '--no-apply was requested for this run - invoke review-tests alone, report findings only, do not apply anything, make no edits, and do not re-review (there is nothing to confirm). Deliver still proceeds against the branch as-is.'
  const owned = target.ownedFiles || []
  const baseline = target.baselineChanges || []
  const scopeNote =
    (owned.length
      ? `The earlier implement run produced these files on the branch: ${owned.join(', ')}. `
      : 'No earlier implement run was recorded for this branch, so there is no list of the files it produced. ') +
    'Everything git shows as changed in the project folder will be delivered, including files the person changed or added by hand: review and fix every test and support file among them like the rest, and leave any other kind of file (application code, for example) untouched, since the test checklist does not apply to it. ' +
    (baseline.length ? `These paths were already modified before the implement run and are the person's work in progress: review them and report findings, but never edit them: ${baseline.join(', ')}. ` : '')
  return (
    `In Review mode: operating inside ${target.worktreePath} (branch ${target.branch}), review the test files currently on this branch. ` +
    `${scopeNote}${headlessNote} ${applyNote} Do NOT commit, push, or open a PR here - that's a separate Deliver step, even though it's the same agent.`
  )
}

function deliverPrompt(reviewed) {
  const authNote = PR_AUTHORIZED
    ? 'PR creation was explicitly requested for this run - invoke create-pr (which composes commit-and-push internally), telling it push and PR creation are both pre-authorized so it skips its interactive confirmations.'
    : PUSH_AUTHORIZED
      ? 'Push was explicitly requested for this run (but not PR creation) - invoke commit-and-push, telling it push is pre-authorized so it skips its interactive confirmation. Do not invoke create-pr.'
      : 'Neither push nor PR creation was requested for this run - invoke commit-and-push, telling it push is NOT pre-authorized, so it commits only and leaves the branch for the human to push manually.'
  const owned = reviewed.ownedFiles || []
  const scopeNote =
    'Deliver every change git shows in the project folder (git status --porcelain -- .): modified, deleted, renamed and staged files, and new files that are not ignored. Stage each by name (git add -- <path>, never a directory, never -A). ' +
    'Running this workflow is the request to deliver everything the person has changed, so do not leave a file out because it is not a test file, because it was already modified before the implement run, or because the pipeline did not produce it. ' +
    "Leave out only what git itself ignores (it never shows in git status) and what the commit-and-push staging rules refuse: a secret file or credential in the diff (stop and report blocked, as that rule says) and another package manager's lockfile (skip it and return it in skippedPaths with the reason). " +
    (owned.length
      ? `The earlier implement run produced these files: ${owned.join(', ')}. Every staged path that is not in that list is the person's own work: return those paths in handChanges, and say in the commit message (and PR description, if any) that the commit includes manual edits.`
      : 'No earlier implement run was recorded for this branch, so return an empty handChanges.')
  return (
    `In Deliver mode: operating inside ${reviewed.worktreePath} (branch ${reviewed.branch}). ${scopeNote} ` +
    `If \`git rev-parse --show-prefix\` prints a non-empty path there, qa-kit lives in a subfolder of a larger repo: stage with root-anchored pathspecs and look only at that folder (\`-- .\`), as the git-safety pattern describes. ${authNote}`
  )
}

// Retries once on a null/errored agent() call, and short-circuits if the previous stage was
// already blocked, so a transient failure or an upstream block is recorded once with a clear
// reason instead of the target either silently vanishing or cascading into a confusing crash.
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
    blockReason: `${stageName} failed twice (transient agent failure or terminal error) - needs a human to investigate and re-run this target`,
  })
}

function reviewStage(target) {
  const skill = APPLY ? 'apply-review-fixes' : 'review-tests'
  return runStage(target, 'review', 'test-reviewer', skill, reviewPrompt(target), REVIEW_SCHEMA, `review:${target.branch}`)
}

function deliverStage(reviewed) {
  const skill = PR_AUTHORIZED ? 'create-pr' : 'commit-and-push'
  return runStage(reviewed, 'deliver', 'test-deliverer', skill, deliverPrompt(reviewed), DELIVER_SCHEMA, `deliver:${reviewed.branch}`)
}

const allResults = []
for (let offset = 0; offset < args.targets.length; offset += MAX_PARALLEL_FEATURES) {
  const batch = args.targets.slice(offset, offset + MAX_PARALLEL_FEATURES)
  log(`Delivering targets ${offset + 1}-${offset + batch.length} of ${args.targets.length} (max ${MAX_PARALLEL_FEATURES} in parallel)`)
  const batchResults = await pipeline(batch, reviewStage, deliverStage)
  allResults.push(...batchResults)
}

const report = args.targets.map((t, i) => {
  const r = allResults[i]
  return {
    task: t.task,
    branch: r?.branch ?? t.branch,
    stage: r?.stage || 'review',
    agent: r?.agentType,
    skill: r?.skill,
    reReviewed: r?.reReviewed ?? false,
    blocked: r?.blocked ?? false,
    blockReason: r?.blockReason,
    lintClean: r?.lintClean,
    ownedFiles: t.ownedFiles || [],
    scope: (t.ownedFiles || []).length ? 'recorded run' : 'no recorded run: all outstanding test changes',
    handChanges: r?.handChanges,
    skippedPaths: r?.skippedPaths,
    committed: r?.committed ?? false,
    pushed: r?.pushed ?? false,
    prUrl: r?.prUrl,
    history: r?.history || [],
  }
})

const blocked = report.filter(r => r.blocked)
if (blocked.length) {
  log(`${blocked.length}/${report.length} target(s) blocked on a human decision (stage: ${blocked.map(r => r.stage).join(', ')}) - see blockReason per target.`)
}

return report
