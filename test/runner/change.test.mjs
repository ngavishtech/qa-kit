import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toolRules } from '../../runner/lib/adapters/claude.mjs'
import { READ_ONLY_STRICT, authorization, snapshot, verify } from '../../runner/lib/guard.mjs'
import { parseCli, parseWorkflowArgs } from '../../runner/lib/parse.mjs'
import { validate } from '../../runner/lib/schema.mjs'
import { ensureArtifacts, resolveInputs } from '../../runner/lib/state.mjs'
import { git, makeDir, makeRepo, write } from './helpers.mjs'

// ---- parsing ---------------------------------------------------------------------------------

const select = (...tokens) => parseWorkflowArgs('feature-select', tokens)
const cover = (...tokens) => parseWorkflowArgs('feature-diff', tokens)

test('feature-select parses its flags and returns pull requests and ranges as items', () => {
  const { args, items } = select('123,', '130', 'main..feature/x', '--fetch', '--no-smoke', '--plan', '--threshold=40', '--repo=org/app', '--parallel=2')
  assert.deepEqual(items, ['123', '130', 'main..feature/x'])
  assert.deepEqual(args, { fetch: true, smoke: false, planGaps: true, threshold: 40, repos: ['org/app'], maxParallel: 2 })
})

test('feature-diff parses its own flags', () => {
  const { args } = cover('--since=7', '--no-select', '--run-affected', '--base=origin/main', '--head=feature/x')
  assert.deepEqual(args, { since: 7, select: false, runAffected: true, baseRef: 'origin/main', headRef: 'feature/x' })
})

test('the change flows reject flags that belong to other workflows and bad values', () => {
  for (const flag of ['--commit', '--push', '--pr', '--heal', '--level=smoke', '--minutes=5', '--read-only']) {
    assert.throws(() => select(flag), /not a valid flag for feature-select/, flag)
    assert.throws(() => cover(flag), /not a valid flag for feature-diff/, flag)
  }
  assert.throws(() => select('--plan=yes'), /not a valid flag/)
  assert.throws(() => cover('--plan'), /not a valid flag for feature-diff/)
  assert.throws(() => select('--no-select'), /not a valid flag for feature-select/)
  assert.throws(() => select('--since=0'), /positive integer/)
  assert.throws(() => select('--since=400'), /at most 365 days/)
  assert.throws(() => select('--threshold=101'), /1 to 100/)
  assert.throws(() => select('--repo=not-a-repo'), /org\/app/)
  assert.throws(() => select('--repo=a/b;rm'), /org\/app/)
  assert.throws(() => select('--base='), /needs a value/)
})

test('both change flows are known workflows of the command line', () => {
  for (const name of ['feature-diff', 'feature-select']) {
    const parsed = parseCli([name, '42', '--agent', 'claude'])
    assert.equal(parsed.workflow, name)
    assert.deepEqual(parsed.items, ['42'])
  }
})

// ---- inputs ----------------------------------------------------------------------------------

test('items become pull requests and ranges, and nothing at all means the current branch', t => {
  const cwd = makeDir(t)
  const resolve = (items, args = {}) => resolveInputs({ workflow: 'feature-select', args, items, cwd })
  assert.deepEqual(resolve([]), {})
  assert.deepEqual(resolve(['123', 'https://github.com/org/app/pull/45', 'origin/main..HEAD']), {
    prs: ['123', 'org/app#45'],
    ranges: ['origin/main..HEAD'],
  })
  assert.deepEqual(resolve(['9'], { repos: ['org/app'] }), { repos: ['org/app'], prs: ['org/app#9'] })
  assert.deepEqual(resolve([], { repos: ['org/app'], since: 3 }), { repos: ['org/app'], since: 3 })
})

test('free text, shell characters and two sources at once are refused', t => {
  const cwd = makeDir(t)
  for (const workflow of ['feature-diff', 'feature-select']) {
    const resolve = (items, args = {}) => resolveInputs({ workflow, args, items, cwd })
    assert.throws(() => resolve(['checkout page']), /not a pull request number/)
    assert.throws(() => resolve(['123; rm -rf /']), /not a pull request number/)
    assert.throws(() => resolve(['https://example.com/org/app/pull/1']), /not a pull request number/)
    assert.throws(() => resolve([], { baseRef: '--output=x' }), /--base is not a plain git ref/)
    assert.throws(() => resolve([], { headRef: 'a..b' }), /--head is not a plain git ref/)
    assert.throws(() => resolve(['5'], { since: 7 }), /one source/)
    assert.throws(() => resolve([], { since: 7, baseRef: 'main' }), /one source/)
    assert.throws(() => resolve(['a..b'], { baseRef: 'main' }), /one source/)
    assert.throws(() => resolve([], { repos: ['org/app'] }), /--repo needs pull requests or --since/)
    assert.throws(() => resolve([], { repos: ['org/app'], baseRef: 'main' }), /--repo needs pull requests or --since/)
  }
})

test('the schema check understands numbers, which the change workflows return', () => {
  assert.deepEqual(validate({ n: 3 }, { type: 'object', properties: { n: { type: 'number' } } }), [])
  assert.deepEqual(validate({ n: '3' }, { type: 'object', properties: { n: { type: 'number' } } }), ['$.n must be number'])
})

// ---- the safety check ------------------------------------------------------------------------

test('a change analysis is never authorized to commit, push or open a pull request', () => {
  for (const workflow of ['feature-diff', 'feature-select']) {
    assert.deepEqual(authorization({ since: 7 }, workflow), { commit: false, push: false, pr: false })
  }
})

test('a change analysis may write inside qa-kit-artifacts and nowhere else', t => {
  for (const workflow of ['feature-diff', 'feature-select']) {
    const repo = makeRepo(t)
    const before = snapshot(repo)
    ensureArtifacts(repo)
    write(repo, 'qa-kit-artifacts/changes/selection.json')
    const check = () => verify({ before, cwd: repo, workflow, report: [], args: {}, warn: () => {} })
    assert.deepEqual(check(), [])
    write(repo, 'src/user.ts', 'export const edited = true\n')
    assert.match(check().join('\n'), new RegExp(`${workflow} changed files outside qa-kit-artifacts/: src/user\\.ts`))
  }
})

test('a change analysis that moves HEAD is a violation', t => {
  const repo = makeRepo(t)
  const before = snapshot(repo)
  git(repo, 'checkout', '-b', 'somewhere')
  assert.match(verify({ before, cwd: repo, workflow: 'feature-select', report: [], args: {}, warn: () => {} }).join('\n'), /feature-select moved HEAD or switched branch/)
})

// ---- several repositories --------------------------------------------------------------------

test('--repo may be repeated and collects every repository, in order, without duplicates', () => {
  const { args } = select('--repo=org/orders', '--repo=org/billing', '--since=3')
  assert.deepEqual(args, { repos: ['org/orders', 'org/billing'], since: 3 })
  assert.throws(() => select('--repo=org/a', '--repo=nope'), /org\/app/)
})

test('a value flag given twice is an error, never a silent last-one-wins', () => {
  assert.throws(() => select('--since=3', '--since=7'), /--since was given twice/)
  assert.throws(() => cover('--base=main', '--base=other'), /--base was given twice/)
  assert.throws(() => select('--threshold=10', '--threshold=20'), /--threshold was given twice/)
  assert.throws(() => parseWorkflowArgs('feature-implement', ['--level=smoke', '--level=sanity']), /--level was given twice/)
})

test('pull requests of several repositories are written org/app#number or as a URL', t => {
  const cwd = makeDir(t)
  const resolve = (items, args = {}) => resolveInputs({ workflow: 'feature-select', args, items, cwd })
  assert.deepEqual(resolve(['org/orders#456', 'org/billing#12', 'https://github.com/org/web/pull/7', 'org/orders#456']), {
    prs: ['org/orders#456', 'org/billing#12', 'org/web#7'],
  })
  assert.deepEqual(resolve(['org/orders#456', 'org/billing#12'], { repos: ['org/orders', 'ORG/ORDERS', 'org/billing'] }), {
    repos: ['org/orders', 'org/billing'],
    prs: ['org/orders#456', 'org/billing#12'],
  })
  assert.deepEqual(resolve([], { repos: ['org/orders', 'org/billing'], since: 7 }), { repos: ['org/orders', 'org/billing'], since: 7 })
})

test('a bare pull request number is refused when it could belong to several repositories', t => {
  const cwd = makeDir(t)
  assert.throws(() => resolveInputs({ workflow: 'feature-diff', args: { repos: ['org/a', 'org/b'] }, items: ['456'], cwd }), /could belong to any of org\/a, org\/b: write it as org\/app#456|write it as org\/app#456/)
  assert.throws(() => resolveInputs({ workflow: 'feature-diff', args: { repos: ['org/a', 'org/b'] }, items: ['org/a#1', '456'], cwd }), /could belong to any of/)
  assert.throws(
    () => resolveInputs({ workflow: 'feature-select', args: { repos: Array.from({ length: 11 }, (_, i) => `org/r${i}`), since: 1 }, items: [], cwd }),
    /at most 10 repositories/,
  )
})

// ---- the hardened read-only checks ---------------------------------------------------------------------------------------------

test('--min-confidence takes high or medium, and repository names cannot start with a dash or a dot', () => {
  assert.equal(select('--min-confidence=high').args.minConfidence, 'high')
  assert.equal(cover('--min-confidence=MEDIUM').args.minConfidence, 'medium')
  assert.throws(() => select('--min-confidence=low'), /needs high or medium/)
  assert.throws(() => select('--repo=-x/app'), /org\/app/)
  assert.throws(() => select('--repo=./app'), /org\/app/)
})

test('the change flows get no delivery commands, deny every git write, and fetch only when asked', () => {
  const none = { commit: false, push: false, pr: false }
  const strict = toolRules(none, { strict: true })
  assert.deepEqual(strict.allow, [])
  for (const command of ['git add', 'git commit', 'git checkout', 'git switch', 'git worktree', 'git pull', 'git push', 'git stash', 'git reset', 'git clean', 'git branch -', 'git tag', 'gh pr create', 'gh api', 'git fetch']) {
    assert.ok(strict.deny.some(rule => rule.startsWith(`Bash(${command}`)), command)
  }
  const fetching = toolRules(none, { strict: true, allowFetch: true })
  assert.deepEqual(fetching.allow, ['Bash(git fetch origin *)'])
  assert.ok(!fetching.deny.some(rule => rule.startsWith('Bash(git fetch')))
  assert.ok(toolRules(none).allow.includes('Bash(git add *)'), 'the other flows keep their rules')
  assert.deepEqual(READ_ONLY_STRICT, ['feature-diff', 'feature-select'])
})

test('a change flow that creates a branch, changes .env or edits a tracked file is a violation', t => {
  for (const workflow of READ_ONLY_STRICT) {
    const repo = makeRepo(t)
    write(repo, '.env', 'TEST_USER_PASSWORD=first\n')
    const before = snapshot(repo)
    const check = args => verify({ before, cwd: repo, workflow, report: [], args, warn: () => {} })
    assert.deepEqual(check({}), [])
    git(repo, 'branch', 'created-by-the-run')
    assert.match(check({}).join('\n'), /created, moved or deleted a local branch/)
    write(repo, '.env', 'TEST_USER_PASSWORD=second\n')
    assert.match(check({}).join('\n'), /changed the \.env file/)
  }
})

test('test output folders are tolerated only for --run-affected', t => {
  const repo = makeRepo(t)
  const before = snapshot(repo)
  write(repo, 'playwright-report/index.html')
  write(repo, 'test-results/a/trace.zip')
  const check = args => verify({ before, cwd: repo, workflow: 'feature-diff', report: [], args, warn: () => {} })
  assert.match(check({}).join('\n'), /changed files outside qa-kit-artifacts\/: .*playwright-report/)
  assert.deepEqual(check({ runAffected: true }), [])
  write(repo, 'src/user.ts', 'export const edited = true\n')
  assert.match(check({ runAffected: true }).join('\n'), /src\/user\.ts/)
})
