import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCli } from '../../runner/qa-kit.mjs'
import { classify, parseWorkflowArgs, splitArgs } from '../../runner/lib/parse.mjs'

const plan = (...tokens) => parseWorkflowArgs('feature-plan', tokens).args
const implement = (...tokens) => parseWorkflowArgs('feature-implement', tokens)
const deliver = (...tokens) => parseWorkflowArgs('feature-deliver', tokens)

test('a bare comma-separated list makes one feature per source', () => {
  assert.deepEqual(plan('ABC-1234,', 'qa-kit-artifacts/plan.md,', 'extra text'), {
    features: [{ jiraKeys: ['ABC-1234'] }, { planFiles: ['qa-kit-artifacts/plan.md'] }, { descriptions: ['extra text'] }],
  })
})

test('a --plan block merges every source into one feature, in any order', () => {
  const args = plan('--plan', 'testrail:3/12/104,', 'ABC-1234,', 'extra text,', 'https://figma.com/file/abc,', 'ABC-1235')
  assert.deepEqual(args, {
    features: [
      {
        testrailLocations: ['testrail:3/12/104'],
        jiraKeys: ['ABC-1234', 'ABC-1235'],
        descriptions: ['extra text'],
        figmaLinks: ['https://figma.com/file/abc'],
      },
    ],
  })
})

test('leftover items before the first --plan stay separate features and come first', () => {
  assert.deepEqual(plan('ABC-9000,', '--plan', 'ABC-1234,', 'ABC-1235'), {
    features: [{ jiraKeys: ['ABC-9000'] }, { jiraKeys: ['ABC-1234', 'ABC-1235'] }],
  })
  assert.deepEqual(plan('--plan', 'ABC-1', '--plan', 'ABC-2,', 'ABC-3'), {
    features: [{ jiraKeys: ['ABC-1'] }, { jiraKeys: ['ABC-2', 'ABC-3'] }],
  })
})

test('--update takes the plan path first and classifies the rest as new sources', () => {
  assert.deepEqual(plan('--update', 'qa-kit-artifacts/ABC-1234-test-plan.md,', 'these screenshots', 'https://www.figma.com/design/x'), {
    updates: [
      {
        plan: { planPath: 'qa-kit-artifacts/ABC-1234-test-plan.md' },
        descriptions: ['these screenshots'],
        figmaLinks: ['https://www.figma.com/design/x'],
      },
    ],
  })
})

test('a fresh feature and an update can share one call', () => {
  const args = plan('ABC-9000,', '--update', 'qa-kit-artifacts/ABC-1234-test-plan.md,', 'add the empty-draft edge case')
  assert.deepEqual(args.features, [{ jiraKeys: ['ABC-9000'] }])
  assert.equal(args.updates.length, 1)
})

test('free text keeps its commas and a TestRail URL is recognised by its path', () => {
  assert.deepEqual(plan('Add CSV export, with headers'), { features: [{ descriptions: ['Add CSV export, with headers'] }] })
  assert.deepEqual(plan('--plan', 'https://tr.example.com/index.php?/suites/view/12'), {
    features: [{ testrailLocations: ['https://tr.example.com/index.php?/suites/view/12'] }],
  })
})

test('surrounding quotes that survive the shell are removed', () => {
  assert.deepEqual(plan('"Add export, fast"', "'ABC-1'"), { features: [{ descriptions: ['Add export, fast'] }, { jiraKeys: ['ABC-1'] }] })
})

test('feature-plan needs a source and no empty blocks', () => {
  assert.throws(() => plan(), /at least one source/)
  assert.throws(() => plan('--parallel=2'), /at least one source/)
  assert.throws(() => plan('ABC-1', '--plan'), /--plan needs at least one source/)
})

test('--parallel and --agent-prefix are run-level flags that never become sources', () => {
  assert.deepEqual(plan('ABC-1', '--parallel=2', '--agent-prefix='), { maxParallel: 2, agentPrefix: '', features: [{ jiraKeys: ['ABC-1'] }] })
  assert.deepEqual(plan('--plan', 'ABC-1', '--parallel=4', 'ABC-2'), { maxParallel: 4, features: [{ jiraKeys: ['ABC-1', 'ABC-2'] }] })
  assert.throws(() => plan('ABC-1', '--parallel=0'), /positive integer/)
  assert.throws(() => plan('ABC-1', '--parallel'), /not a valid flag/)
})

test('--commit is its own switch on both pipelines and does not set push or createPr', () => {
  assert.deepEqual(implement('--commit').args, { commit: true })
  assert.deepEqual(implement('--commit', '--push').args, { commit: true, push: true })
  assert.deepEqual(deliver('--commit').args, { commit: true })
  assert.throws(() => plan('ABC-1', '--commit'), /not a valid flag/)
})

test('feature-implement with no flags leaves args empty (nothing committed, heal, apply)', () => {
  assert.deepEqual(implement(), { args: {}, items: [] })
  assert.deepEqual(implement('--heal', '--apply').args, { heal: true, apply: true })
})

test('feature-implement flags map to the documented arg names', () => {
  const { args, items } = implement(
    '--push', '--parallel=2', '--no-heal', '--no-apply', '--base=origin/main', '--worktree-dir=../wt',
    '--install=yarn install --frozen-lockfile', '--agent-prefix=x:', 'qa-kit-artifacts/ABC-3702-test-plan.md', 'ABC-1234',
  )
  assert.deepEqual(args, {
    push: true,
    maxParallel: 2,
    heal: false,
    apply: false,
    baseRef: 'origin/main',
    worktreeDir: '../wt',
    installCommand: 'yarn install --frozen-lockfile',
    agentPrefix: 'x:',
  })
  assert.deepEqual(items, ['qa-kit-artifacts/ABC-3702-test-plan.md', 'ABC-1234'])
})

test('--level takes smoke, sanity or regression (any case) and nothing else', () => {
  assert.deepEqual(implement('--level=smoke').args, { level: 'smoke' })
  assert.deepEqual(implement('--level=Regression', '--push').args, { level: 'regression', push: true })
  assert.throws(() => implement('--level=critical'), /--level needs smoke, sanity or regression/)
  assert.throws(() => implement('--level='), /--level needs smoke, sanity or regression/)
  assert.throws(() => implement('--level'), /not a valid flag/)
})

test('--pr sets createPr without also setting push', () => {
  assert.deepEqual(implement('--pr').args, { createPr: true })
  assert.deepEqual(implement('--pr', '--push').args, { createPr: true, push: true })
})

test('the last of --heal/--no-heal and of --apply/--no-apply wins', () => {
  assert.equal(implement('--heal', '--no-heal').args.heal, false)
  assert.equal(implement('--no-heal', '--heal').args.heal, true)
  assert.equal(implement('--apply', '--no-apply').args.apply, false)
  assert.equal(implement('--no-apply', '--apply').args.apply, true)
  assert.equal(deliver('--no-apply', '--apply').args.apply, true)
})

test('Jira keys follow the read-ticket pattern, including digits and underscores in the project', () => {
  for (const key of ['ABC-1234', 'MY_PROJ-3', 'AB2-12']) assert.equal(classify(key), 'jiraKeys', key)
  for (const text of ['abc-1', 'A-1', '2AB-1', 'ABC-', 'ABC-1x']) assert.equal(classify(text), 'descriptions', text)
})

test('splitArgs splits on whitespace and never expands anything', () => {
  const url = 'https://www.figma.com/design/abc/X?node-id=1-2&t=x'
  assert.deepEqual(splitArgs(`ABC-1 ${url} --pr`), ['ABC-1', url, '--pr'])
  assert.deepEqual(splitArgs('a;b $(whoami) `id` #tag | x > y && z'), ['a;b', '$(whoami)', '`id`', '#tag', '|', 'x', '>', 'y', '&&', 'z'])
  assert.deepEqual(splitArgs('$HOME ~ *.md %PATH% !x'), ['$HOME', '~', '*.md', '%PATH%', '!x'])
})

test('splitArgs groups quoted text and keeps its content literal', () => {
  assert.deepEqual(splitArgs(`"Add export; fast" 'it$(x) \`y\`'`), ['Add export; fast', 'it$(x) `y`'])
  assert.deepEqual(splitArgs(`"it's" 'say "hi"'`), ["it's", 'say "hi"'])
  assert.deepEqual(splitArgs(`--agent-prefix="" --base='origin/a b'`), ['--agent-prefix=', '--base=origin/a b'])
  assert.deepEqual(splitArgs('"" x'), ['', 'x'])
  assert.deepEqual(splitArgs('pre"mid dle"post'), ['premid dlepost'])
})

test('splitArgs keeps Windows paths intact and still allows escaping quotes and spaces', () => {
  assert.deepEqual(splitArgs(String.raw`qa-kit-artifacts\ABC-1-test-plan.md C:\Users\x\plan.md`), [
    String.raw`qa-kit-artifacts\ABC-1-test-plan.md`,
    String.raw`C:\Users\x\plan.md`,
  ])
  assert.deepEqual(splitArgs(String.raw`my\ file.md \"quoted\"`), ['my file.md', '"quoted"'])
})

test('splitArgs honours escaped quotes and backslashes', () => {
  assert.deepEqual(splitArgs(String.raw`"say \"hi\" \\ \n"`), [String.raw`say "hi" \ \n`])
  assert.deepEqual(splitArgs(String.raw`it\'s a\ b \"q\"`), ["it's", 'a b', '"q"'])
  assert.deepEqual(splitArgs(String.raw`'a\' b`), ['a\\', 'b'])
})

test('splitArgs treats newlines and tabs as whitespace and empty input as no tokens', () => {
  assert.deepEqual(splitArgs('ABC-1,\r\nABC-2\n\n"two\nlines"\t--push\n'), ['ABC-1,', 'ABC-2', 'two\nlines', '--push'])
  for (const empty of ['', '   ', '\n\r\n\t']) assert.deepEqual(splitArgs(empty), [])
})

test('splitArgs rejects an unterminated quote with an actionable message', () => {
  assert.throws(() => splitArgs('Add "export'), /unterminated " quote in the arguments: close it/)
  assert.throws(() => splitArgs("it's"), /unterminated ' quote/)
  assert.throws(() => splitArgs('"a\\\\\\"'), /unterminated "/)
})

test('empty value flags are rejected except --agent-prefix', () => {
  assert.throws(() => implement('--base='), /needs a value/)
  assert.throws(() => implement('--install='), /needs a value/)
})

test('feature-deliver accepts push, pr, parallel, apply and rejects heal and plan blocks', () => {
  assert.deepEqual(deliver('--pr', '--parallel=2', '--no-apply', 'feature/0-abc-3702').args, { createPr: true, maxParallel: 2, apply: false })
  assert.deepEqual(deliver('ABC-3702,', 'feature/x').items, ['ABC-3702', 'feature/x'])
  assert.throws(() => deliver('--no-heal'), /not a valid flag/)
  assert.throws(() => deliver('--plan', 'ABC-1'), /not a valid flag/)
  assert.throws(() => deliver('--base=x'), /not a valid flag/)
  assert.throws(() => deliver('--level=smoke'), /not a valid flag/)
  assert.throws(() => plan('ABC-1', '--level=smoke'), /not a valid flag/)
})

test('parseCli separates run options from workflow input', () => {
  const parsed = parseCli(['feature-implement', '--agent', 'opencode', '--model=p/m', '--cwd', 'repo', '--timeout', '45', '--dry-run', '--pr'])
  assert.equal(parsed.workflow, 'feature-implement')
  assert.deepEqual(parsed.args, { createPr: true })
  assert.deepEqual(parsed.options, { dryRun: true, agent: 'opencode', model: 'p/m', cwd: 'repo', timeout: '45', timeoutMs: 45 * 60_000 })
})

test('parseCli requires a known workflow and agent', () => {
  assert.throws(() => parseCli(['feature-plan', 'ABC-1']), /--agent must be one of/)
  assert.throws(() => parseCli(['feature-plan', 'ABC-1', '--agent', 'gpt']), /--agent must be one of/)
  assert.throws(() => parseCli(['plan-tests', '--agent', 'claude']), /first argument must be one of/)
  assert.throws(() => parseCli(['--agent', 'claude']), /first argument must be one of/)
  assert.throws(() => parseCli(['feature-plan', 'ABC-1', '--agent']), /--agent needs a value/)
})
