import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { baselineChangesOf, ensureArtifacts, readTestType, resolveInputs, saveRun } from '../../runner/lib/state.mjs'
import { git, makeDir, makeRepo, write } from './helpers.mjs'

const startedAt = new Date('2026-11-09T10:15:30.123Z')

function save(cwd, workflow, report, args = {}) {
  return saveRun({ cwd, workflow, startedAt, args, report, violations: [], warnings: [] })
}

test('ensureArtifacts creates a self-ignoring folder once and never overwrites', t => {
  const cwd = makeDir(t)
  const dir = ensureArtifacts(cwd)
  assert.equal(readFileSync(path.join(dir, '.gitignore'), 'utf8'), '*\n')
  write(cwd, 'qa-kit-artifacts/.gitignore', 'custom\n')
  ensureArtifacts(cwd)
  assert.equal(readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'custom\n')
})

test('saveRun writes the timestamped report and overwrites latest', t => {
  const cwd = makeDir(t)
  const runDir = save(cwd, 'feature-plan', [{ task: 'one' }])
  assert.equal(path.basename(runDir), '20261109T101530Z-feature-plan')
  const saved = JSON.parse(readFileSync(path.join(runDir, 'report.json'), 'utf8'))
  assert.deepEqual(saved.report, [{ task: 'one' }])
  assert.deepEqual(saved.violations, [])
  save(cwd, 'feature-plan', [{ task: 'two' }])
  const latest = JSON.parse(readFileSync(path.join(cwd, 'qa-kit-artifacts', 'latest', 'feature-plan.json'), 'utf8'))
  assert.deepEqual(latest.report, [{ task: 'two' }])
})

test('feature-implement uses the unblocked plans from the latest feature-plan run', t => {
  const cwd = makeDir(t)
  save(cwd, 'feature-plan', [
    { task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui', blocked: false },
    { task: 'ABC-2', blocked: true, blockReason: 'no ticket' },
    { task: 'ABC-3', planPath: 'qa-kit-artifacts/ABC-3-test-plan.md', testType: 'api', blocked: false, updated: true },
  ])
  const args = resolveInputs({ workflow: 'feature-implement', args: { push: true }, items: [], cwd })
  assert.equal(args.push, true)
  assert.deepEqual(args.plans, [
    { task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' },
    { task: 'ABC-3', planPath: 'qa-kit-artifacts/ABC-3-test-plan.md', testType: 'api' },
  ])
})

test('named plans match by task or plan file name and may come straight from disk', t => {
  const cwd = makeDir(t)
  save(cwd, 'feature-plan', [
    { task: 'ABC-1 + ABC-2', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui', blocked: false },
    { task: 'ABC-9', planPath: 'qa-kit-artifacts/ABC-9-test-plan.md', testType: 'api', blocked: false },
  ])
  write(cwd, 'qa-kit-artifacts/ABC-5-test-plan.md', '**Test Type**: both\n')
  const plans = resolveInputs({
    workflow: 'feature-implement',
    args: {},
    items: ['ABC-9', 'ABC-1-test-plan.md', 'qa-kit-artifacts/ABC-5-test-plan.md'],
    cwd,
  }).plans
  assert.deepEqual(plans.map(plan => [plan.task, plan.testType]), [['ABC-9', 'api'], ['ABC-1 + ABC-2', 'ui'], ['ABC-5-test-plan.md', 'both']])
  assert.throws(() => resolveInputs({ workflow: 'feature-implement', args: {}, items: ['ABC-404'], cwd }), /matches 0 planned features/)
  assert.throws(() => resolveInputs({ workflow: 'feature-implement', args: {}, items: ['ABC-'], cwd }), /matches 2 planned features/)
  assert.throws(() => resolveInputs({ workflow: 'feature-implement', args: {}, items: ['qa-kit-artifacts/none.md'], cwd }), /plan file not found/)
})

test('feature-implement fails clearly when there is nothing to implement', t => {
  assert.throws(() => resolveInputs({ workflow: 'feature-implement', args: {}, items: [], cwd: makeDir(t) }), /no approved plans/)
})

test('test type comes from the header or is derived from scenario types', () => {
  assert.equal(readTestType('# Plan\n**Test Type**: API\n'), 'api')
  assert.equal(readTestType('Type: UI\n\nType: UI\n'), 'ui')
  assert.equal(readTestType('Type: UI\n\nType: API\n'), 'both')
  assert.equal(readTestType('Type: UI API\n'), 'both')
  assert.throws(() => readTestType('nothing here'), /cannot tell the plan test type/)
})

test('feature-deliver uses the unblocked implemented branches with their baseline changes', t => {
  const cwd = makeDir(t)
  save(cwd, 'feature-implement', [
    {
      task: 'ABC-1',
      branch: 'feature/0-abc-1',
      worktreePath: '/wt/0',
      blocked: false,
      history: [{ stage: 'write', baselineChanges: [' M keep.ts'] }, { stage: 'execute' }],
    },
    { task: 'ABC-2', branch: 'feature/1-abc-2', worktreePath: '/wt/1', blocked: true },
  ])
  const { targets } = resolveInputs({ workflow: 'feature-deliver', args: {}, items: [], cwd })
  assert.deepEqual(targets, [{ task: 'ABC-1', branch: 'feature/0-abc-1', worktreePath: '/wt/0', baselineChanges: [' M keep.ts'] }])
  const named = resolveInputs({ workflow: 'feature-deliver', args: {}, items: ['feature/0-abc-1'], cwd }).targets
  assert.equal(named[0].task, 'ABC-1')
  assert.throws(() => resolveInputs({ workflow: 'feature-deliver', args: {}, items: ['nope'], cwd }), /matches 0 implemented features/)
})

test('feature-deliver falls back to the current branch and checkout', t => {
  const repo = makeRepo(t)
  git(repo, 'checkout', '-b', 'feature/manual')
  const { targets } = resolveInputs({ workflow: 'feature-deliver', args: {}, items: [], cwd: repo })
  assert.deepEqual(targets, [{ branch: 'feature/manual', worktreePath: repo }])
  assert.throws(() => resolveInputs({ workflow: 'feature-deliver', args: {}, items: [], cwd: makeDir(t) }), /no targets to deliver/)
})

test('a corrupt latest report is reported instead of ignored', t => {
  const cwd = makeDir(t)
  write(cwd, 'qa-kit-artifacts/latest/feature-plan.json', '{nope')
  assert.throws(() => resolveInputs({ workflow: 'feature-implement', args: {}, items: [], cwd }), /not a valid qa-kit report/)
  assert.ok(existsSync(path.join(cwd, 'qa-kit-artifacts', 'latest', 'feature-plan.json')))
})

test('baselineChangesOf reads the write stage of a feature-implement entry', () => {
  assert.deepEqual(baselineChangesOf({ history: [{ stage: 'write', baselineChanges: ['a'] }] }), ['a'])
  assert.deepEqual(baselineChangesOf({ baselineChanges: ['b'], history: [] }), ['b'])
  assert.deepEqual(baselineChangesOf({}), [])
})

test('a plan picks up the files an earlier run of the same plan left, by plan file and by task', t => {
  const cwd = makeDir(t)
  save(cwd, 'feature-plan', [
    { task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui', blocked: false },
    { task: 'ABC-2', planPath: 'qa-kit-artifacts/ABC-2-test-plan.md', testType: 'api', blocked: false },
    { task: 'ABC-3', planPath: 'qa-kit-artifacts/ABC-3-test-plan.md', testType: 'ui', blocked: false },
  ])
  save(cwd, 'feature-implement', [
    { task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', branch: 'feature/abc-1', ownedFiles: ['src/tests/a.spec.ts', 'src/support/pages/APage.ts'] },
    { task: 'ABC-2', branch: 'feature/abc-2', ownedFiles: ['src/tests/b.spec.ts'] },
    { task: 'ABC-3', planPath: 'qa-kit-artifacts/ABC-3-test-plan.md', branch: 'feature/abc-3', ownedFiles: [] },
  ])
  const { plans } = resolveInputs({ workflow: 'feature-implement', args: {}, items: [], cwd })
  assert.deepEqual(plans[0].priorOwned, ['src/tests/a.spec.ts', 'src/support/pages/APage.ts'])
  assert.deepEqual(plans[1].priorOwned, ['src/tests/b.spec.ts'])
  assert.ok(!('priorOwned' in plans[2]), 'an empty ledger adds nothing')
  const named = resolveInputs({ workflow: 'feature-implement', args: {}, items: ['qa-kit-artifacts/ABC-1-test-plan.md'], cwd }).plans
  assert.deepEqual(named[0].priorOwned, ['src/tests/a.spec.ts', 'src/support/pages/APage.ts'])
})

test('a plan with no earlier run has no priorOwned', t => {
  const cwd = makeDir(t)
  save(cwd, 'feature-plan', [{ task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui', blocked: false }])
  const { plans } = resolveInputs({ workflow: 'feature-implement', args: {}, items: [], cwd })
  assert.deepEqual(plans, [{ task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' }])
})

test('feature-deliver targets carry the files the implement run produced', t => {
  const cwd = makeDir(t)
  save(cwd, 'feature-implement', [
    { task: 'ABC-1', branch: 'feature/abc-1', worktreePath: '/wt', blocked: false, ownedFiles: ['src/tests/a.spec.ts'], history: [{ stage: 'write', baselineChanges: [' M keep.ts'] }] },
  ])
  const { targets } = resolveInputs({ workflow: 'feature-deliver', args: {}, items: [], cwd })
  assert.deepEqual(targets, [{ task: 'ABC-1', branch: 'feature/abc-1', worktreePath: '/wt', baselineChanges: [' M keep.ts'], ownedFiles: ['src/tests/a.spec.ts'] }])
})
