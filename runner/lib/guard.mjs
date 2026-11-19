import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { tryGh, tryGit } from './git.mjs'
import { baselineChangesOf, ownedFilesOf } from './state.mjs'

const ARTIFACTS_PREFIX = 'qa-kit-artifacts/'
const NETWORK_TIMEOUT_MS = 30_000
const PORCELAIN_PREFIX = /^[ MADRCUT?!]{2} /

// feature-deliver exists to deliver, so running it already authorizes the commit; feature-implement commits only when asked
// (--commit, or --push/--pr which imply it).
export function authorization(args, workflow) {
  const pr = args.createPr === true
  const push = args.push === true || pr
  return { commit: workflow === 'feature-deliver' || args.commit === true || push, push, pr }
}

const lines = text => (text ? text.split('\n').filter(Boolean) : [])

function detectDefaultBranch(cwd) {
  const remote = tryGit(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (remote) return remote.replace(/^origin\//, '')
  return ['main', 'master'].find(name => tryGit(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) ?? null
}

function branchSha(cwd, name) {
  return name ? tryGit(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]) : null
}

// Status and diff are limited to the project folder (`-- .`): when qa-kit lives in a subfolder of a larger
// repo, other people's edits elsewhere in the repo are not this run's doing. Porcelain paths stay relative to
// the git root, so the artifacts folder is recognised with the folder's offset in front of it.
// .env is normally ignored by git, so only a content hash can show that a run touched it. The content itself is never kept.
function envHash(cwd) {
  try {
    return createHash('sha256').update(readFileSync(path.join(cwd, '.env'))).digest('hex')
  } catch {
    return null
  }
}

function workingState(cwd) {
  const artifacts = (tryGit(cwd, ['rev-parse', '--show-prefix']) ?? '') + ARTIFACTS_PREFIX
  return {
    envHash: envHash(cwd),
    head: tryGit(cwd, ['rev-parse', 'HEAD']),
    branch: tryGit(cwd, ['branch', '--show-current']),
    status: lines(tryGit(cwd, ['status', '--porcelain', '--', '.'])).filter(line => !line.slice(3).startsWith(artifacts)),
    diffHash: createHash('sha256').update(tryGit(cwd, ['diff', 'HEAD', '--', '.']) ?? '').digest('hex'),
  }
}

function remoteHeads(cwd) {
  const output = tryGit(cwd, ['ls-remote', '--heads', 'origin'], NETWORK_TIMEOUT_MS)
  if (output === null) return null
  return Object.fromEntries(
    lines(output).map(line => {
      const [sha, ref] = line.split('\t')
      return [ref.replace(/^refs\/heads\//, ''), sha]
    }),
  )
}

function localHeads(cwd) {
  const output = tryGit(cwd, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads'])
  return Object.fromEntries(lines(output).map(line => line.split(' ')))
}

export function snapshot(cwd) {
  const defaultBranch = detectDefaultBranch(cwd)
  return {
    startedAt: Date.now(),
    defaultBranch,
    defaultSha: branchSha(cwd, defaultBranch),
    localHeads: localHeads(cwd),
    remoteHeads: remoteHeads(cwd),
    ...workingState(cwd),
  }
}

function defaultBranchViolations(before, cwd) {
  const now = branchSha(cwd, before.defaultBranch)
  if (!before.defaultSha || now === before.defaultSha) return []
  return [`default branch ${before.defaultBranch} moved from ${before.defaultSha.slice(0, 8)} to ${now?.slice(0, 8) ?? 'nothing'}: a commit landed on it`]
}

// Read-only workflows (feature-plan, feature-monkey) may write only inside the artifacts folder. Git cannot see inside that
// self-ignoring folder, so staying inside qa-kit-artifacts/monkey/ is a rule of the skill, not something checked here.
function readOnlyViolations(before, cwd, workflow) {
  const after = workingState(cwd)
  const changed = [...before.status.filter(line => !after.status.includes(line)), ...after.status.filter(line => !before.status.includes(line))]
  const violations = []
  if (changed.length) violations.push(`${workflow} changed files outside ${ARTIFACTS_PREFIX}: ${[...new Set(changed.map(line => line.slice(3)))].join(', ')}`)
  else if (after.diffHash !== before.diffHash) violations.push(`${workflow} edited tracked files outside ${ARTIFACTS_PREFIX}`)
  if (after.head !== before.head || after.branch !== before.branch) violations.push(`${workflow} moved HEAD or switched branch`)
  if (workflow === 'feature-monkey' && after.envHash !== before.envHash) violations.push('feature-monkey changed the .env file')
  return violations
}

const READ_ONLY_WORKFLOWS = ['feature-plan', 'feature-monkey']

function branchEntries(workflow, report, args) {
  return report
    .map((entry, i) => ({ entry, source: workflow === 'feature-deliver' ? (args.targets[i] ?? {}) : entry }))
    .filter(({ entry }) => entry.branch)
    .map(({ entry, source }) => ({
      branch: entry.branch,
      committed: entry.committed === true,
      pushed: entry.pushed === true,
      prUrl: entry.prUrl,
      worktreePath: source.worktreePath,
      // feature-deliver delivers everything git shows as changed, including files modified before the implement run, so the
      // 'committed a file that was already modified' check applies to feature-implement only.
      baseline: (workflow === 'feature-deliver' ? [] : baselineChangesOf(source)).map(normalizeBaselinePath),
      // feature-implement may commit only what the pipeline produced; feature-deliver also takes the person's own test edits,
      // so for it the recorded list is only used to tell them apart in a warning.
      owned: (workflow === 'feature-deliver' ? [] : ownedFilesOf(entry)).map(normalizeBaselinePath),
      recorded: (workflow === 'feature-deliver' ? ownedFilesOf(source) : []).map(normalizeBaselinePath),
    }))
}

export function normalizeBaselinePath(entry) {
  const text = PORCELAIN_PREFIX.test(entry) ? entry.slice(3) : entry
  return text.split(' -> ').at(-1).replace(/^"|"$/g, '').replace(/\\/g, '/')
}

// Only used when the run was not authorized to commit. A branch created during the run has no earlier tip to compare
// with, so for it the agent's own report is the only evidence.
function commitViolations({ before, entries, cwd }) {
  const now = localHeads(cwd)
  return entries
    .filter(({ branch, committed }) => committed || (before.localHeads?.[branch] !== undefined && now[branch] !== before.localHeads[branch]))
    .map(({ branch }) => `${branch} received a commit but neither --commit, --push nor --pr was given`)
}

function pushViolations({ before, entries, allowPush, cwd, warn }) {
  if (!entries.length) return []
  const after = remoteHeads(cwd)
  if (!before.remoteHeads || !after) {
    warn('could not list origin branches: pushes were not verified')
    return []
  }
  return entries
    .filter(({ branch, pushed }) => after[branch] !== undefined && after[branch] !== before.remoteHeads[branch] && !(allowPush && pushed))
    .map(({ branch }) => `${branch} was pushed to origin without authorization or without being reported as pushed`)
}

function pullRequestViolations({ before, entries, cwd, warn }) {
  const violations = []
  for (const { branch, prUrl } of entries) {
    if (prUrl) violations.push(`${branch} reports a pull request (${prUrl}) but --pr was not given`)
    const output = tryGh(cwd, ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'url,createdAt'], NETWORK_TIMEOUT_MS)
    if (output === null) {
      warn('could not list pull requests with gh: pull request creation was not verified')
      return violations
    }
    for (const pr of JSON.parse(output || '[]')) {
      if (Date.parse(pr.createdAt) >= before.startedAt) violations.push(`${branch} has a pull request opened during this run (${pr.url}) but --pr was not given`)
    }
  }
  return violations
}

function baselineViolations({ before, entries, cwd, warn }) {
  const violations = []
  for (const { branch, worktreePath, baseline } of entries) {
    if (!baseline.length || branch === before.defaultBranch) continue
    const dir = path.resolve(cwd, worktreePath ?? '.')
    const since = branch === before.branch ? before.head : tryGit(dir, ['merge-base', before.defaultBranch ?? 'HEAD', branch])
    const changed = since ? tryGit(dir, ['diff', '--name-only', since, branch]) : null
    if (changed === null) {
      warn(`could not diff ${branch}: its commits were not checked against files that were already modified`)
      continue
    }
    const committed = lines(changed).filter(file => baseline.some(item => file === item || (item.endsWith('/') && file.startsWith(item))))
    if (committed.length) violations.push(`${branch} commits files that were already modified before the run: ${committed.join(', ')}`)
  }
  return violations
}

// A branch that existed before the run is compared from the tip it had then, so earlier commits of the person are not counted;
// a branch created during the run is compared from where it forked.
function committedSince(before, branch, dir) {
  const since = before.localHeads?.[branch] ?? tryGit(dir, ['merge-base', before.defaultBranch ?? 'HEAD', branch])
  return since ? tryGit(dir, ['diff', '--name-only', since, branch]) : null
}

// Positive list: when the run recorded which files the pipeline produced, a commit may contain those and nothing else.
function ledgerViolations({ before, entries, cwd, warn }) {
  const violations = []
  for (const { branch, worktreePath, owned } of entries) {
    if (!owned.length || branch === before.defaultBranch) continue
    const changed = committedSince(before, branch, path.resolve(cwd, worktreePath ?? '.'))
    if (changed === null) {
      warn(`could not diff ${branch}: its commits were not checked against the files the pipeline produced`)
      continue
    }
    const foreign = lines(changed).map(file => file.replace(/\\/g, '/')).filter(file => !owned.some(item => file === item || (item.endsWith('/') && file.startsWith(item))))
    if (foreign.length) violations.push(`${branch} commits files the pipeline did not produce: ${foreign.join(', ')}`)
  }
  return violations
}

// feature-deliver delivers every file the person changed by hand after (or before) the implement run. They are not a violation, but they are
// named in the run's warnings so the commit's contents are never a surprise.
function handChangeWarnings({ before, entries, cwd, warn }) {
  for (const { branch, worktreePath, recorded } of entries) {
    if (!recorded.length || branch === before.defaultBranch) continue
    const changed = committedSince(before, branch, path.resolve(cwd, worktreePath ?? '.'))
    if (changed === null) continue
    const extra = lines(changed).map(file => file.replace(/\\/g, '/')).filter(file => !recorded.includes(file))
    if (extra.length) warn(`${branch} commit includes ${extra.length} file(s) the pipeline did not produce (changed by hand after the implement run?): ${extra.join(', ')}`)
  }
}

export function verify({ before, workflow, report, args, cwd, warn = () => {} }) {
  const violations = defaultBranchViolations(before, cwd)
  if (READ_ONLY_WORKFLOWS.includes(workflow)) return [...violations, ...readOnlyViolations(before, cwd, workflow)]
  const entries = branchEntries(workflow, report, args)
  const allowed = authorization(args, workflow)
  return [
    ...violations,
    ...(allowed.commit ? [] : commitViolations({ before, entries, cwd })),
    ...pushViolations({ before, entries, allowPush: allowed.push, cwd, warn }),
    ...(allowed.pr ? [] : pullRequestViolations({ before, entries, cwd, warn })),
    ...baselineViolations({ before, entries, cwd, warn }),
    ...ledgerViolations({ before, entries, cwd, warn }),
    ...(handChangeWarnings({ before, entries, cwd, warn }) ?? []),
  ]
}
