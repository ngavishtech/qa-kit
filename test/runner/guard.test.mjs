import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authorization, normalizeBaselinePath, snapshot, verify } from '../../runner/lib/guard.mjs'
import { ensureArtifacts } from '../../runner/lib/state.mjs'
import { rmSync } from 'node:fs'
import { commit, git, makeRepo, write } from './helpers.mjs'

function check(repo, before, input) {
  const warnings = []
  const violations = verify({ before, cwd: repo, warn: message => warnings.push(message), report: [], args: {}, ...input })
  return { violations, warnings }
}

test('snapshot records the default branch, its commit and the working tree', t => {
  const repo = makeRepo(t)
  const before = snapshot(repo)
  assert.equal(before.defaultBranch, 'main')
  assert.equal(before.defaultSha, git(repo, 'rev-parse', 'main'))
  assert.equal(before.branch, 'main')
  assert.deepEqual(before.status, [])
  assert.equal(before.remoteHeads.main, before.defaultSha)
})

test('a clean run has no violations', t => {
  const repo = makeRepo(t)
  const before = snapshot(repo)
  git(repo, 'checkout', '-b', 'feature/clean')
  commit(repo, 'src/new.spec.ts')
  const report = [{ branch: 'feature/clean', worktreePath: repo, pushed: false, history: [{ stage: 'write', baselineChanges: [] }] }]
  const { violations } = check(repo, before, { workflow: 'feature-implement', report })
  assert.deepEqual(violations, [])
})

test('a commit on the default branch is a violation', t => {
  const repo = makeRepo(t)
  const before = snapshot(repo)
  commit(repo, 'src/sneaky.ts')
  const { violations } = check(repo, before, { workflow: 'feature-implement' })
  assert.equal(violations.length, 1)
  assert.match(violations[0], /default branch main moved/)
})

test('committing a file that was already modified before the run is a violation', t => {
  const repo = makeRepo(t)
  write(repo, 'src/user.ts', 'export const edited = true\n')
  const before = snapshot(repo)
  assert.deepEqual(before.status, [' M src/user.ts'])
  git(repo, 'checkout', '-b', 'feature/greedy')
  git(repo, 'add', 'src/user.ts')
  git(repo, 'commit', '-m', 'oops')
  const report = [{ branch: 'feature/greedy', worktreePath: repo, pushed: false, history: [{ stage: 'write', baselineChanges: [' M src/user.ts'] }] }]
  const { violations } = check(repo, before, { workflow: 'feature-implement', report })
  assert.equal(violations.length, 1)
  assert.match(violations[0], /feature\/greedy commits files that were already modified.*src\/user\.ts/)
})

test('feature-deliver may commit a file that was already modified before the implement run: that is the request', t => {
  const repo = makeRepo(t)
  write(repo, 'src/user.ts', 'export const edited = true\n')
  const before = snapshot(repo)
  git(repo, 'checkout', '-b', 'feature/deliver')
  git(repo, 'add', 'src/user.ts')
  git(repo, 'commit', '-m', 'everything the person changed')
  const args = { targets: [{ branch: 'feature/deliver', worktreePath: repo, baselineChanges: ['src/user.ts'] }] }
  const { violations } = check(repo, before, { workflow: 'feature-deliver', args, report: [{ branch: 'feature/deliver', pushed: false }] })
  assert.deepEqual(violations, [])
})

test('an unauthorized or unreported push is a violation, an authorized reported one is not', t => {
  const repo = makeRepo(t)
  const before = snapshot(repo)
  git(repo, 'checkout', '-b', 'feature/pushed')
  commit(repo, 'src/a.spec.ts')
  git(repo, 'push', 'origin', 'feature/pushed')
  const report = [{ branch: 'feature/pushed', worktreePath: repo, pushed: false }]

  const denied = check(repo, before, { workflow: 'feature-implement', report })
  assert.equal(denied.violations.length, 1)
  assert.match(denied.violations[0], /feature\/pushed was pushed to origin/)

  const unreported = check(repo, before, { workflow: 'feature-implement', report, args: { push: true } })
  assert.equal(unreported.violations.length, 1)

  const allowed = check(repo, before, { workflow: 'feature-implement', report: [{ ...report[0], pushed: true }], args: { push: true } })
  assert.deepEqual(allowed.violations, [])
})

test('a branch that was already on origin before the run is not flagged', t => {
  const repo = makeRepo(t)
  git(repo, 'checkout', '-b', 'feature/old')
  commit(repo, 'src/old.spec.ts')
  git(repo, 'push', 'origin', 'feature/old')
  const before = snapshot(repo)
  const { violations } = check(repo, before, { workflow: 'feature-implement', report: [{ branch: 'feature/old', worktreePath: repo, pushed: false }] })
  assert.deepEqual(violations, [])
})

test('a pull request reported without --pr is a violation', t => {
  const repo = makeRepo(t)
  const before = snapshot(repo)
  const report = [{ branch: 'feature/pr', worktreePath: repo, pushed: false, prUrl: 'https://example.com/pull/1' }]
  const { violations } = check(repo, before, { workflow: 'feature-implement', report })
  assert.match(violations.join('\n'), /reports a pull request/)
  const allowed = check(repo, before, { workflow: 'feature-implement', report, args: { createPr: true } })
  assert.deepEqual(allowed.violations, [])
})

test('missing remote or gh access downgrades to warnings', t => {
  const repo = makeRepo(t)
  git(repo, 'remote', 'remove', 'origin')
  const before = snapshot(repo)
  assert.equal(before.remoteHeads, null)
  const { violations, warnings } = check(repo, before, {
    workflow: 'feature-implement',
    report: [{ branch: 'feature/x', worktreePath: repo, pushed: false }],
  })
  assert.deepEqual(violations, [])
  assert.match(warnings.join('\n'), /pushes were not verified/)
})

test('feature-plan may only write inside qa-kit-artifacts', t => {
  const repo = makeRepo(t)
  const before = snapshot(repo)
  ensureArtifacts(repo)
  write(repo, 'qa-kit-artifacts/ABC-1-test-plan.md')
  assert.deepEqual(check(repo, before, { workflow: 'feature-plan' }).violations, [])

  write(repo, 'src/user.ts', 'export const edited = true\n')
  const edited = check(repo, before, { workflow: 'feature-plan' }).violations
  assert.match(edited.join('\n'), /changed files outside qa-kit-artifacts\/: src\/user\.ts/)

  write(repo, 'notes.txt')
  assert.match(check(repo, before, { workflow: 'feature-plan' }).violations.join('\n'), /notes\.txt/)
})

test('feature-plan editing an already modified tracked file is caught by content', t => {
  const repo = makeRepo(t)
  write(repo, 'src/user.ts', 'one\n')
  const before = snapshot(repo)
  write(repo, 'src/user.ts', 'two\n')
  assert.match(check(repo, before, { workflow: 'feature-plan' }).violations.join('\n'), /edited tracked files/)
})

test('authorization is a ladder: --pr implies push, push implies commit, feature-deliver always commits', () => {
  assert.deepEqual(authorization({}, 'feature-implement'), { commit: false, push: false, pr: false })
  assert.deepEqual(authorization({ commit: true }, 'feature-implement'), { commit: true, push: false, pr: false })
  assert.deepEqual(authorization({ push: true }, 'feature-implement'), { commit: true, push: true, pr: false })
  assert.deepEqual(authorization({ createPr: true }, 'feature-implement'), { commit: true, push: true, pr: true })
  assert.deepEqual(authorization({}, 'feature-deliver'), { commit: true, push: false, pr: false })
  assert.deepEqual(authorization({}, 'feature-plan'), { commit: false, push: false, pr: false })
})

test('a commit without --commit is a violation: reported, or a branch that already existed moved', t => {
  const repo = makeRepo(t)
  git(repo, 'checkout', '-b', 'feature/existing')
  git(repo, 'checkout', 'main')
  const before = snapshot(repo)
  assert.ok(before.localHeads['feature/existing'])

  const reported = check(repo, before, { workflow: 'feature-implement', report: [{ branch: 'feature/new', worktreePath: repo, committed: true, pushed: false }] })
  assert.match(reported.violations.join('\n'), /feature\/new received a commit but neither --commit, --push nor --pr was given/)

  git(repo, 'checkout', 'feature/existing')
  commit(repo, 'src/quiet.spec.ts')
  const moved = check(repo, before, { workflow: 'feature-implement', report: [{ branch: 'feature/existing', worktreePath: repo, committed: false, pushed: false }] })
  assert.match(moved.violations.join('\n'), /feature\/existing received a commit/)

  const untouched = check(repo, before, { workflow: 'feature-implement', report: [{ branch: 'feature/untouched', worktreePath: repo, committed: false, pushed: false }] })
  assert.deepEqual(untouched.violations, [])
})

test('commits are allowed with --commit, and always for feature-deliver', t => {
  const repo = makeRepo(t)
  const before = snapshot(repo)
  git(repo, 'checkout', '-b', 'feature/ok')
  commit(repo, 'src/ok.spec.ts')
  const report = [{ branch: 'feature/ok', worktreePath: repo, committed: true, pushed: false }]
  assert.deepEqual(check(repo, before, { workflow: 'feature-implement', report, args: { commit: true } }).violations, [])
  assert.deepEqual(check(repo, before, { workflow: 'feature-deliver', report, args: { targets: [{ branch: 'feature/ok', worktreePath: repo }] } }).violations, [])
})

test('baseline entries are reduced to plain paths', () => {
  assert.equal(normalizeBaselinePath(' M src/a.ts'), 'src/a.ts')
  assert.equal(normalizeBaselinePath('?? tmp/'), 'tmp/')
  assert.equal(normalizeBaselinePath('R  old.ts -> new.ts'), 'new.ts')
  assert.equal(normalizeBaselinePath('"odd name.ts"'), 'odd name.ts')
  assert.equal(normalizeBaselinePath('src\\b.ts'), 'src/b.ts')
})

// qa-kit installed in a subfolder of a larger repo: the runner starts in automation/, the git root is its parent.
function subfolder(t) {
  const repo = makeRepo(t)
  commit(repo, 'automation/tests/a.spec.ts')
  return { repo, project: `${repo}/automation` }
}

test('feature-plan in a subfolder project ignores edits elsewhere in the repo', t => {
  const { repo, project } = subfolder(t)
  const before = snapshot(project)
  write(repo, 'src/user.ts', 'a developer is working here\n')
  write(repo, 'app/notes.txt')
  assert.deepEqual(check(project, before, { workflow: 'feature-plan' }).violations, [])
})

test('feature-plan in a subfolder project still catches edits inside it and allows its artifacts', t => {
  const { project } = subfolder(t)
  const before = snapshot(project)
  ensureArtifacts(project)
  write(project, 'qa-kit-artifacts/ABC-1-test-plan.md')
  assert.deepEqual(check(project, before, { workflow: 'feature-plan' }).violations, [])

  write(project, 'tests/a.spec.ts', 'edited by a plan run\n')
  assert.match(check(project, before, { workflow: 'feature-plan' }).violations.join('\n'), /automation\/tests\/a\.spec\.ts/)
})

test('baseline files are compared as git prints them (relative to the git root) in a subfolder project', t => {
  const { repo, project } = subfolder(t)
  write(repo, 'automation/tests/a.spec.ts', 'already modified by the user\n')
  const before = snapshot(project)
  assert.deepEqual(before.status, [' M automation/tests/a.spec.ts'])
  git(repo, 'checkout', '-b', 'feature/sub')
  git(repo, 'add', 'automation/tests/a.spec.ts')
  git(repo, 'commit', '-m', 'commits a file that was already modified')
  const report = [{ branch: 'feature/sub', worktreePath: project, pushed: false, history: [{ stage: 'write', baselineChanges: ['automation/tests/a.spec.ts'] }] }]
  const { violations } = check(project, before, { workflow: 'feature-implement', report })
  assert.match(violations.join('\n'), /commits files that were already modified before the run: automation\/tests\/a\.spec\.ts/)
})

test('a commit may contain only the files the pipeline produced when the run recorded them', t => {
  const repo = makeRepo(t)
  const before = snapshot(repo)
  git(repo, 'checkout', '-b', 'feature/ledger')
  write(repo, 'src/tests/a.spec.ts')
  write(repo, 'src/user.ts', 'changed by someone else\n')
  git(repo, 'add', 'src/tests/a.spec.ts', 'src/user.ts')
  git(repo, 'commit', '-m', 'both')
  const entry = ownedFiles => [{ branch: 'feature/ledger', worktreePath: repo, committed: true, pushed: false, ownedFiles }]
  const clean = check(repo, before, { workflow: 'feature-implement', args: { commit: true }, report: entry(['src/tests/a.spec.ts', 'src/user.ts']) })
  assert.deepEqual(clean.violations, [])
  const foreign = check(repo, before, { workflow: 'feature-implement', args: { commit: true }, report: entry(['src/tests/a.spec.ts']) })
  assert.match(foreign.violations.join('\n'), /feature\/ledger commits files the pipeline did not produce: src\/user\.ts/)
  const none = check(repo, before, { workflow: 'feature-implement', args: { commit: true }, report: entry([]) })
  assert.deepEqual(none.violations, [], 'no ledger, no ledger check')
})

test('the ledger check counts only commits made during the run on a branch that already existed', t => {
  const repo = makeRepo(t)
  git(repo, 'checkout', '-b', 'feature/old')
  commit(repo, 'src/tests/earlier-by-a-person.spec.ts')
  const before = snapshot(repo)
  commit(repo, 'src/tests/new.spec.ts')
  const report = [{ branch: 'feature/old', worktreePath: repo, committed: true, pushed: false, ownedFiles: ['src/tests/new.spec.ts'] }]
  assert.deepEqual(check(repo, before, { workflow: 'feature-implement', args: { commit: true }, report }).violations, [])
})

test('feature-deliver commits everything the person changed, and names what the pipeline did not produce in a warning', t => {
  const repo = makeRepo(t)
  write(repo, 'src/tests/a.spec.ts')
  write(repo, 'src/tests/gap.spec.ts', 'a gap the person closed by hand\n')
  write(repo, 'src/user.ts', 'the person was already editing this before the run\n')
  const before = snapshot(repo)
  git(repo, 'checkout', '-b', 'feature/deliver-hand')
  git(repo, 'add', 'src/tests/a.spec.ts', 'src/tests/gap.spec.ts', 'src/user.ts')
  git(repo, 'commit', '-m', 'pipeline file, a hand-added test and a file edited before the run')
  const target = { branch: 'feature/deliver-hand', worktreePath: repo, ownedFiles: ['src/tests/a.spec.ts'], baselineChanges: [' M src/user.ts'] }
  const report = [{ branch: 'feature/deliver-hand', committed: true, pushed: false }]
  const { violations, warnings } = check(repo, before, { workflow: 'feature-deliver', args: { targets: [target] }, report })
  assert.deepEqual(violations, [])
  assert.match(warnings.join('\n'), /commit includes 2 file\(s\) the pipeline did not produce.*src\/tests\/gap\.spec\.ts, src\/user\.ts/)
  assert.doesNotMatch(warnings.join('\n'), /src\/tests\/a\.spec\.ts/)
})

test('feature-implement --commit is still held to the files the run produced and to its baseline', t => {
  const repo = makeRepo(t)
  write(repo, 'src/user.ts', 'edited before the run\n')
  const before = snapshot(repo)
  git(repo, 'checkout', '-b', 'feature/implement-strict')
  write(repo, 'src/tests/a.spec.ts')
  git(repo, 'add', 'src/tests/a.spec.ts', 'src/user.ts')
  git(repo, 'commit', '-m', 'too much')
  const report = [{ branch: 'feature/implement-strict', worktreePath: repo, committed: true, pushed: false, ownedFiles: ['src/tests/a.spec.ts'], baselineChanges: [' M src/user.ts'] }]
  const { violations } = check(repo, before, { workflow: 'feature-implement', args: { commit: true }, report })
  assert.match(violations.join('\n'), /commits files that were already modified before the run: src\/user\.ts/)
  assert.match(violations.join('\n'), /commits files the pipeline did not produce: src\/user\.ts/)
})

test('the ledger check works on a branch checked out in a real git worktree', t => {
  const repo = makeRepo(t)
  const before = snapshot(repo)
  const worktree = `${repo}-wt`
  t.after(() => rmSync(worktree, { recursive: true, force: true, maxRetries: 3 }))
  git(repo, 'worktree', 'add', worktree, '-b', 'feature/0-wt', 'main')
  write(worktree, 'src/tests/wt.spec.ts')
  write(worktree, 'src/stray.ts')
  git(worktree, 'add', '.')
  git(worktree, 'commit', '-m', 'in the worktree')
  const entry = ownedFiles => [{ branch: 'feature/0-wt', worktreePath: worktree, committed: true, pushed: false, ownedFiles }]
  assert.deepEqual(check(repo, before, { workflow: 'feature-implement', args: { commit: true }, report: entry(['src/tests/wt.spec.ts', 'src/stray.ts']) }).violations, [])
  assert.match(check(repo, before, { workflow: 'feature-implement', args: { commit: true }, report: entry(['src/tests/wt.spec.ts']) }).violations.join('\n'), /src\/stray\.ts/)
})
