import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runWorkflow } from '../../runner/qa-kit.mjs'
import { makeRuntime } from '../../runner/lib/shims.mjs'
import { validate } from '../../runner/lib/schema.mjs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function canned(label) {
  const [stage, ...rest] = label.split(':')
  const name = rest.join(':')
  const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  switch (stage) {
    case 'plan':
    case 'update':
      return { planPath: `qa-kit-artifacts/${slug}-test-plan.md`, testType: 'ui', blocked: false, ...(stage === 'update' ? { updated: true } : {}) }
    case 'write':
      return { specFiles: [`${slug}.spec.ts`], lintClean: true, worktreePath: `/work/${slug}`, branch: name, baselineChanges: [' M keep.ts'], blocked: false }
    case 'execute':
      return { passed: true, blocked: false }
    case 'review':
      return { lintClean: true, filesChanged: [] }
    default:
      return { committed: true, pushed: false, blocked: false }
  }
}

// Answers every call with a schema-valid result unless `override` returns something for that call.
function fakeAdapter({ override = () => undefined, delay = 0 } = {}) {
  const calls = []
  let active = 0
  let peak = 0
  return {
    calls,
    get peak() {
      return peak
    },
    async run({ prompt, agentType, schema, label }) {
      const call = { prompt, agentType, label, attempt: calls.filter(c => c.label === label && c.agentType === agentType).length + 1 }
      calls.push(call)
      active++
      peak = Math.max(peak, active)
      await sleep(delay)
      active--
      const result = override(call)
      const value = result === undefined ? canned(label) : result
      if (value !== null) assert.deepEqual(validate(value, schema), [], `${label} result must satisfy its schema`)
      return value
    },
  }
}

const run = (name, args, adapter) => runWorkflow({ name, args: { agentPrefix: 'qa-kit-', ...args }, adapter, log: () => {} })

test('feature-plan plans each feature with the prefixed agent-planner', async () => {
  const adapter = fakeAdapter()
  const report = await run('feature-plan', { features: [{ jiraKeys: ['ABC-1'] }, { descriptions: ['Add export'] }] }, adapter)
  assert.equal(report.length, 2)
  assert.deepEqual(report.map(r => r.task), ['ABC-1', 'Add export'])
  assert.ok(report.every(r => r.blocked === false && r.planPath.endsWith('-test-plan.md')))
  assert.ok(adapter.calls.every(c => c.agentType === 'qa-kit-agent-planner'))
  assert.match(adapter.calls[0].prompt, /Jira story ABC-1/)
})

test('feature-plan runs updates against the existing plan file', async () => {
  const adapter = fakeAdapter()
  const report = await run('feature-plan', { updates: [{ plan: { planPath: 'qa-kit-artifacts/ABC-1-test-plan.md' }, descriptions: ['more'] }] }, adapter)
  assert.equal(report[0].updated, true)
  assert.match(adapter.calls[0].prompt, /qa-kit-artifacts\/ABC-1-test-plan\.md/)
})

test('maxParallel caps how many features run at once', async () => {
  const adapter = fakeAdapter({ delay: 15 })
  const features = ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5'].map(key => ({ jiraKeys: [key] }))
  const report = await run('feature-plan', { features, maxParallel: 2 }, adapter)
  assert.equal(report.length, 5)
  assert.equal(adapter.peak, 2)
})

test('a null answer is retried once and then recorded as blocked', async () => {
  const flaky = fakeAdapter({ override: call => (call.attempt === 1 ? null : undefined) })
  const [recovered] = await run('feature-plan', { features: [{ jiraKeys: ['ABC-1'] }] }, flaky)
  assert.equal(recovered.blocked, false)
  assert.equal(flaky.calls.length, 2)

  const dead = fakeAdapter({ override: () => null })
  const [failed] = await run('feature-plan', { features: [{ jiraKeys: ['ABC-1'] }] }, dead)
  assert.equal(failed.blocked, true)
  assert.match(failed.blockReason, /failed twice/)
  assert.equal(dead.calls.length, 2)
})

test('a single plan runs headed in the current checkout and, with no delivery flag, stops after Review uncommitted', async () => {
  const adapter = fakeAdapter()
  const plans = [{ task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' }]
  const [entry] = await run('feature-implement', { plans }, adapter)
  assert.deepEqual(adapter.calls.map(c => c.agentType), ['qa-kit-agent-writer', 'qa-kit-agent-executor', 'qa-kit-agent-reviewer'])
  assert.match(adapter.calls[0].prompt, /work directly in the current checkout/)
  assert.doesNotMatch(adapter.calls[0].prompt, /git worktree add/)
  assert.match(adapter.calls[1].prompt, /headed is fine/)
  assert.equal(entry.branch, 'feature/abc-1')
  assert.equal(entry.blocked, false)
  assert.equal(entry.committed, false)
  assert.equal(entry.pushed, false)
  assert.equal(entry.stage, 'review')
  assert.equal(entry.worktreePath, '/work/feature-abc-1')
  assert.deepEqual(entry.history.map(h => h.stage), ['write', 'execute', 'review'])
})

test('--commit adds the agent-deliverer Deliver stage: commit only, honouring the baseline', async () => {
  const adapter = fakeAdapter()
  const plans = [{ task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' }]
  const [entry] = await run('feature-implement', { plans, commit: true }, adapter)
  assert.deepEqual(adapter.calls.map(c => c.agentType), ['qa-kit-agent-writer', 'qa-kit-agent-executor', 'qa-kit-agent-reviewer', 'qa-kit-agent-deliverer'])
  assert.match(adapter.calls[3].prompt, /invoke commit-and-push/)
  assert.match(adapter.calls[3].prompt, /NOT pre-authorized/)
  assert.doesNotMatch(adapter.calls[3].prompt, /invoke create-pr/)
  assert.match(adapter.calls[3].prompt, / M keep\.ts/)
  assert.equal(entry.committed, true)
  assert.equal(entry.pushed, false)
  assert.deepEqual(entry.history.map(h => h.stage), ['write', 'execute', 'review', 'deliver'])
})

test('--push alone implies the commit and pre-authorizes the push', async () => {
  const adapter = fakeAdapter()
  const plans = [{ task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' }]
  await run('feature-implement', { plans, push: true }, adapter)
  const deliver = adapter.calls.find(c => c.label.startsWith('deliver:'))
  assert.equal(deliver.agentType, 'qa-kit-agent-deliverer')
  assert.match(deliver.prompt, /invoke commit-and-push/)
  assert.match(deliver.prompt, /push is pre-authorized/)
})

test('a skipped Deliver is logged with where the tests are, and a blocked Review is not reported as skipped', async () => {
  const plans = [{ task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' }]
  const skipped = []
  await runWorkflow({ name: 'feature-implement', args: { agentPrefix: 'qa-kit-', plans }, adapter: fakeAdapter(), log: message => skipped.push(message) })
  assert.ok(skipped.some(message => /deliver:feature\/abc-1: skipped.*\/work\/feature-abc-1/.test(message)))

  const messages = []
  const adapter = fakeAdapter({ override: call => (call.label.startsWith('review:') ? { lintClean: false, filesChanged: [], blocked: true, blockReason: 'needs a new fixture' } : undefined) })
  const [entry] = await runWorkflow({ name: 'feature-implement', args: { agentPrefix: 'qa-kit-', plans }, adapter, log: message => messages.push(message) })
  assert.equal(entry.blocked, true)
  assert.equal(entry.stage, 'review')
  assert.ok(!messages.some(message => /skipped/.test(message)))
})

test('several plans each get an isolated worktree and run headless', async () => {
  const adapter = fakeAdapter()
  const plans = [
    { task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' },
    { task: 'ABC-2', planPath: 'qa-kit-artifacts/ABC-2-test-plan.md', testType: 'api' },
  ]
  const report = await run('feature-implement', { plans, createPr: true, worktreeDir: '../wt' }, adapter)
  assert.deepEqual(report.map(r => r.branch), ['feature/0-abc-1', 'feature/1-abc-2'])
  const writes = adapter.calls.filter(c => c.agentType === 'qa-kit-agent-writer')
  assert.equal(writes.length, 2)
  assert.match(writes[0].prompt, /git worktree add \.\.\/wt\/0-abc-1 -b feature\/0-abc-1 origin\/HEAD/)
  assert.ok(adapter.calls.filter(c => c.label.startsWith('execute:')).every(c => /HEADLESS=true/.test(c.prompt)))
  assert.ok(adapter.calls.filter(c => c.label.startsWith('deliver:')).every(c => /invoke create-pr/.test(c.prompt)))
  // qa-kit may live in a subfolder of a larger repo: the worktree is the whole repo, so its project folder is <worktree>/<prefix>.
  assert.ok(writes.every(c => /git rev-parse --show-prefix/.test(c.prompt) && /<worktree>\/<that path>/.test(c.prompt) && /relative to the git root/.test(c.prompt)))
  assert.ok(writes.every(c => /git status --porcelain -- ./.test(c.prompt)))
  assert.ok(adapter.calls.filter(c => c.label.startsWith('deliver:')).every(c => /root-anchored pathspecs/.test(c.prompt)))
})

test('a blocked write short-circuits the later stages for that plan only', async () => {
  const adapter = fakeAdapter({
    override: call => (call.label === 'write:feature/0-abc-1' ? { blocked: true, blockReason: 'dirty tree' } : undefined),
  })
  const plans = [
    { task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' },
    { task: 'ABC-2', planPath: 'qa-kit-artifacts/ABC-2-test-plan.md', testType: 'ui' },
  ]
  const report = await run('feature-implement', { plans }, adapter)
  assert.equal(report[0].blocked, true)
  assert.equal(report[0].stage, 'write')
  assert.equal(report[0].blockReason, 'dirty tree')
  assert.equal(report[1].stage, 'review')
  assert.equal(adapter.calls.filter(c => c.label.includes('abc-1') && !c.label.startsWith('write:')).length, 0)
})

test('heal and apply default on and --no-heal/--no-apply reach the prompts', async () => {
  const plans = [{ task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' }]
  const defaults = fakeAdapter()
  await run('feature-implement', { plans }, defaults)
  assert.match(defaults.calls[1].prompt, /Heal any failures/)
  assert.match(defaults.calls[2].prompt, /Apply fixes/)

  const off = fakeAdapter()
  await run('feature-implement', { plans, heal: false, apply: false }, off)
  assert.match(off.calls[1].prompt, /--no-heal was requested/)
  assert.match(off.calls[2].prompt, /--no-apply was requested/)
})

test('--level reaches the write and deliver prompts of every plan and is reported; no level adds no text', async () => {
  const plans = [
    { task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' },
    { task: 'ABC-2', planPath: 'qa-kit-artifacts/ABC-2-test-plan.md', testType: 'api' },
  ]
  const leveled = fakeAdapter()
  const report = await run('feature-implement', { plans, level: 'Smoke', commit: true }, leveled)
  const writes = leveled.calls.filter(c => c.label.startsWith('write:'))
  assert.equal(writes.length, 2)
  assert.equal(leveled.calls.filter(c => c.label.startsWith('deliver:')).length, 2)
  assert.ok(writes.every(c => /Implement ONLY the scenarios whose Level is Smoke/.test(c.prompt) && /already implement/.test(c.prompt) && /blocked: true/.test(c.prompt)))
  assert.ok(leveled.calls.filter(c => c.label.startsWith('deliver:')).every(c => /only the Smoke-level scenarios/.test(c.prompt)))
  assert.ok(leveled.calls.filter(c => c.label.startsWith('execute:')).every(c => !/Smoke/.test(c.prompt)))
  assert.ok(leveled.calls.filter(c => c.label.startsWith('review:')).every(c => /verify-coverage in implementation mode.*level smoke \(only the plan's Smoke scenarios/.test(c.prompt)))
  assert.deepEqual(report.map(r => r.level), ['smoke', 'smoke'])

  const plain = fakeAdapter()
  const [entry] = await run('feature-implement', { plans: plans.slice(0, 1) }, plain)
  assert.ok(plain.calls.every(c => !/Level is|-level scenarios/.test(c.prompt)))
  assert.equal(entry.level, undefined)
})

test('the Review stage names the plan for the coverage check and a missing scenario ends the stage blocked', async () => {
  const plans = [{ task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' }]
  const clean = fakeAdapter()
  const [entry] = await run('feature-implement', { plans }, clean)
  const review = clean.calls.find(c => c.label.startsWith('review:'))
  assert.match(review.prompt, /The approved plan is qa-kit-artifacts\/ABC-1-test-plan\.md/)
  assert.match(review.prompt, /invoke verify-coverage in implementation mode with that plan and these spec files \(feature-abc-1\.spec\.ts\)/)
  assert.doesNotMatch(review.prompt, /scenarios were implemented in this run/)
  assert.equal(entry.coverageGaps, undefined)

  const gaps = fakeAdapter({
    override: call => (call.label.startsWith('review:')
      ? { lintClean: true, filesChanged: [], coverageGaps: ['Export empty order list: no test'], blocked: true, blockReason: 'planned scenario without a test: Export empty order list' }
      : undefined),
  })
  const [blocked] = await run('feature-implement', { plans, commit: true }, gaps)
  assert.equal(blocked.blocked, true)
  assert.equal(blocked.stage, 'review')
  assert.deepEqual(blocked.coverageGaps, ['Export empty order list: no test'])
  assert.equal(gaps.calls.filter(c => c.label.startsWith('deliver:')).length, 0)
})

test('--level with no scenario at that level blocks the plan at Write', async () => {
  const adapter = fakeAdapter({
    override: call => (call.label.startsWith('write:') ? { blocked: true, blockReason: 'no Sanity scenario in the plan' } : undefined),
  })
  const plans = [{ task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' }]
  const [entry] = await run('feature-implement', { plans, level: 'sanity' }, adapter)
  assert.equal(entry.blocked, true)
  assert.equal(entry.stage, 'write')
  assert.equal(adapter.calls.length, 1)
})

test('an unknown level is rejected before any agent runs', async () => {
  const adapter = fakeAdapter()
  const plans = [{ task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' }]
  await assert.rejects(run('feature-implement', { plans, level: 'critical' }, adapter), /args\.level must be one of smoke, sanity, regression/)
  assert.equal(adapter.calls.length, 0)
})

test('feature-deliver reviews with the agent-reviewer then delivers with the agent-deliverer', async () => {
  const adapter = fakeAdapter()
  const targets = [
    { task: 'ABC-1', branch: 'feature/0-abc-1', worktreePath: '/work/a' },
    { task: 'ABC-2', branch: 'feature/1-abc-2', worktreePath: '/work/b' },
  ]
  const report = await run('feature-deliver', { targets, push: true }, adapter)
  assert.equal(report.length, 2)
  assert.deepEqual(report.map(r => r.stage), ['deliver', 'deliver'])
  assert.ok(adapter.calls.filter(c => c.label.startsWith('review:')).every(c => c.agentType === 'qa-kit-agent-reviewer'))
  assert.ok(adapter.calls.filter(c => c.label.startsWith('deliver:')).every(c => c.agentType === 'qa-kit-agent-deliverer'))
  assert.match(adapter.calls[0].prompt, /HEADLESS=true/)
  assert.ok(adapter.calls.filter(c => c.label.startsWith('deliver:')).every(c => /invoke commit-and-push/.test(c.prompt) && /push is pre-authorized/.test(c.prompt)))
})

test('feature-deliver always commits without any flag and delivers everything git shows, even a file modified before the implement run', async () => {
  const adapter = fakeAdapter()
  const targets = [{ task: 'ABC-1', branch: 'feature/abc-1', worktreePath: '/work/a', baselineChanges: [' M keep.ts'] }]
  const [entry] = await run('feature-deliver', { targets }, adapter)
  const deliver = adapter.calls.find(c => c.label.startsWith('deliver:'))
  assert.match(deliver.prompt, /invoke commit-and-push/)
  assert.match(deliver.prompt, /NOT pre-authorized/)
  assert.match(deliver.prompt, /Deliver every change git shows in the project folder/)
  assert.match(deliver.prompt, /because it was already modified before the implement run/)
  assert.doesNotMatch(deliver.prompt, /do NOT stage or commit them/)
  assert.match(deliver.prompt, /root-anchored pathspecs/)
  assert.equal(entry.committed, true)
})

test('pipeline turns a throwing stage into a blocked item without disturbing the others', async () => {
  const messages = []
  const { pipeline } = makeRuntime({ adapter: null, log: message => messages.push(message) })
  const first = async item => ({ ...item, first: true })
  const second = async item => {
    if (item.id === 1) throw new Error('boom')
    return { ...item, second: true }
  }
  const results = await pipeline([{ id: 0 }, { id: 1 }, { id: 2 }], first, second)
  assert.deepEqual(results[0], { id: 0, first: true, second: true })
  assert.deepEqual(results[1], { id: 1, first: true, blocked: true, blockReason: 'second threw: boom' })
  assert.deepEqual(results[2], { id: 2, first: true, second: true })
})

test('parallel returns null for a throwing task and agent never throws', async () => {
  const { parallel, agent } = makeRuntime({
    adapter: { run: async () => { throw new Error('spawn failed') } },
    log: () => {},
  })
  assert.deepEqual(await parallel([async () => 1, async () => { throw new Error('x') }]), [1, null])
  assert.equal(await agent('p', { agentType: 'a', phase: 'Plan', label: 'l', schema: {} }), null)
})

const onePlan = [{ task: 'ABC-1', planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui' }]

test('every Write prompt carries the idempotence and Extends rules and asks for filesWritten', async () => {
  const adapter = fakeAdapter()
  await run('feature-implement', { plans: onePlan }, adapter)
  const write = adapter.calls.find(c => c.label.startsWith('write:')).prompt
  assert.match(write, /check whether a test for it already exists/)
  assert.match(write, /running this plan twice writes nothing new/)
  assert.match(write, /Description starts with "Extends <file>"/)
  assert.match(write, /return filesWritten|Also return filesWritten/)
  assert.doesNotMatch(write, /earlier run of this pipeline/, 'no prior ledger, no prior note')
})

test('files an earlier run left uncommitted are the pipeline\'s own work, not the baseline', async () => {
  const adapter = fakeAdapter()
  const plans = [{ ...onePlan[0], priorOwned: ['src/tests/smoke.spec.ts', 'src/support/pages/OrdersPage.ts'] }]
  const [entry] = await run('feature-implement', { plans, level: 'sanity', commit: true }, adapter)
  const write = adapter.calls.find(c => c.label.startsWith('write:')).prompt
  assert.match(write, /An earlier run of this pipeline on this plan left these files uncommitted: src\/tests\/smoke\.spec\.ts, src\/support\/pages\/OrdersPage\.ts/)
  assert.match(write, /leave them out of baselineChanges/)
  assert.match(write, /git status --porcelain -uall -- <directory>/)
  // the ledger carries forward and reaches Review and Deliver
  const review = adapter.calls.find(c => c.label.startsWith('review:')).prompt
  const deliver = adapter.calls.find(c => c.label.startsWith('deliver:')).prompt
  for (const prompt of [review, deliver]) assert.match(prompt, /src\/tests\/smoke\.spec\.ts, src\/support\/pages\/OrdersPage\.ts/)
  assert.ok(entry.ownedFiles.includes('src/tests/smoke.spec.ts'))
})

test('ownedFiles is everything every stage reported, and Review and Deliver are limited to it', async () => {
  const adapter = fakeAdapter({
    override: call => {
      if (call.label.startsWith('write:')) return { specFiles: ['src/tests/a.spec.ts'], filesWritten: ['src/tests/a.spec.ts', 'src/support/pages/APage.ts'], lintClean: true, worktreePath: '/work/a', branch: 'feature/abc-1', baselineChanges: [' M src/user.ts'], blocked: false }
      if (call.label.startsWith('execute:')) return { passed: true, filesChanged: ['src/support/pages/APage.ts', 'src/tests/helpers/wait.ts'], blocked: false }
      if (call.label.startsWith('review:')) return { lintClean: true, filesChanged: ['src/tests/a.spec.ts', 'src/tests/b.spec.ts'] }
      return undefined
    },
  })
  const [entry] = await run('feature-implement', { plans: onePlan, commit: true }, adapter)
  const owned = ['src/tests/a.spec.ts', 'src/support/pages/APage.ts', 'src/tests/helpers/wait.ts']
  assert.deepEqual(entry.ownedFiles, [...owned, 'src/tests/b.spec.ts'])

  const review = adapter.calls.find(c => c.label.startsWith('review:')).prompt
  assert.match(review, /Review and edit only these files[^:]*: src\/tests\/a\.spec\.ts, src\/support\/pages\/APage\.ts, src\/tests\/helpers\/wait\.ts\./)
  assert.match(review, /must not be edited:  M src\/user\.ts/)
  assert.doesNotMatch(review, /b\.spec\.ts/, 'Review cannot know the files it will change itself')

  const deliver = adapter.calls.find(c => c.label.startsWith('deliver:')).prompt
  assert.match(deliver, /Stage exactly these paths/)
  assert.match(deliver, /src\/tests\/b\.spec\.ts/)
  assert.match(deliver, /never a directory, never -A/)
  assert.match(deliver, /skippedPaths/)
  assert.match(deliver, /do NOT stage or commit them:  M src\/user\.ts/)
})

test('the Deliver result carries skippedPaths into the report', async () => {
  const adapter = fakeAdapter({ override: call => (call.label.startsWith('deliver:') ? { committed: true, pushed: false, skippedPaths: ['src/user.ts'], blocked: false } : undefined) })
  const [entry] = await run('feature-implement', { plans: onePlan, commit: true }, adapter)
  assert.deepEqual(entry.skippedPaths, ['src/user.ts'])
  assert.equal(entry.planPath, 'qa-kit-artifacts/ABC-1-test-plan.md')
})

test('feature-deliver delivers every changed file, tells the pipeline\'s files from the person\'s, and never edits baseline paths in Review', async () => {
  const adapter = fakeAdapter({ override: call => (call.label.startsWith('deliver:') ? { committed: true, pushed: false, handChanges: ['src/tests/gap.spec.ts', 'src/user.ts'], skippedPaths: ['package-lock.json'], blocked: false } : undefined) })
  const targets = [{ task: 'ABC-1', branch: 'feature/abc-1', worktreePath: '/work/a', ownedFiles: ['src/tests/a.spec.ts'], baselineChanges: [' M src/user.ts'] }]
  const [entry] = await run('feature-deliver', { targets }, adapter)
  const review = adapter.calls.find(c => c.label.startsWith('review:')).prompt
  const deliver = adapter.calls.find(c => c.label.startsWith('deliver:')).prompt
  // Review covers everything that will be delivered, but a pre-existing change is only reported on, never edited
  assert.match(review, /The earlier implement run produced these files on the branch: src\/tests\/a\.spec\.ts\./)
  assert.match(review, /Everything git shows as changed in the project folder will be delivered/)
  assert.match(review, /never edit them:  M src\/user\.ts/)
  // Deliver takes everything git shows, and only the staging safety rules and git's own ignore list leave anything out
  assert.match(deliver, /Deliver every change git shows in the project folder/)
  assert.match(deliver, /because it is not a test file, because it was already modified before the implement run, or because the pipeline did not produce it/)
  assert.match(deliver, /Leave out only what git itself ignores/)
  assert.match(deliver, /another package manager's lockfile/)
  assert.match(deliver, /Every staged path that is not in that list is the person's own work/)
  assert.match(deliver, /commit includes manual edits/)
  assert.doesNotMatch(deliver, /do NOT stage or commit them|Stage exactly these paths|Stage these paths/)
  assert.equal(entry.scope, 'recorded run')
  assert.deepEqual(entry.ownedFiles, ['src/tests/a.spec.ts'])
  assert.deepEqual(entry.handChanges, ['src/tests/gap.spec.ts', 'src/user.ts'])
  assert.deepEqual(entry.skippedPaths, ['package-lock.json'])
})

test('feature-deliver on the current-checkout fallback says no run was recorded', async () => {
  const adapter = fakeAdapter()
  const [entry] = await run('feature-deliver', { targets: [{ branch: 'feature/manual', worktreePath: '/work/m' }] }, adapter)
  assert.match(adapter.calls.find(c => c.label.startsWith('review:')).prompt, /No earlier implement run was recorded/)
  assert.match(adapter.calls.find(c => c.label.startsWith('deliver:')).prompt, /No earlier implement run was recorded/)
  assert.doesNotMatch(adapter.calls.find(c => c.label.startsWith('deliver:')).prompt, /Stage exactly these paths/)
  assert.equal(entry.scope, 'no recorded run: all outstanding test changes')
})
