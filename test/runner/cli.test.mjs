import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { main } from '../../runner/qa-kit.mjs'
import { commit, git, makeDir, makeRepo } from './helpers.mjs'

function fakeAgents(answer) {
  const calls = []
  const createAdapter = options => ({
    preflight() {},
    async run(call) {
      calls.push({ ...call, policy: options.policy })
      return answer(call)
    },
  })
  return { calls, adapters: { claude: { agentPrefix: 'qa-kit:', createAdapter } } }
}

function quiet(t) {
  const output = { out: [], err: [] }
  t.mock.method(console, 'log', (...parts) => output.out.push(parts.join(' ')))
  t.mock.method(console, 'error', (...parts) => output.err.push(parts.join(' ')))
  return output
}

const planAnswer = () => ({ planPath: 'qa-kit-artifacts/ABC-1-test-plan.md', testType: 'ui', blocked: false })

test('a planning run saves its report, hands it to the next stage and exits 0', async t => {
  const repo = makeRepo(t)
  const output = quiet(t)
  const { adapters, calls } = fakeAgents(planAnswer)
  const code = await main(['feature-plan', 'ABC-1', '--agent', 'claude', '--cwd', repo], adapters)
  assert.equal(code, 0)
  assert.equal(calls[0].agentType, 'qa-kit:test-planner')
  assert.deepEqual(calls[0].policy, { commit: false, push: false, pr: false })
  const latest = JSON.parse(readFileSync(path.join(repo, 'qa-kit-artifacts', 'latest', 'feature-plan.json'), 'utf8'))
  assert.equal(latest.report[0].planPath, 'qa-kit-artifacts/ABC-1-test-plan.md')
  assert.deepEqual(latest.violations, [])
  assert.match(output.out.join('\n'), /ABC-1: planPath=qa-kit-artifacts\/ABC-1-test-plan\.md testType=ui/)
})

test('a blocked feature exits 2 and an implement run reuses the saved plans', async t => {
  const repo = makeRepo(t)
  quiet(t)
  const plans = fakeAgents(planAnswer)
  await main(['feature-plan', 'ABC-1', '--agent', 'claude', '--cwd', repo], plans.adapters)

  const implement = fakeAgents(call => (call.label.startsWith('write:') ? { blocked: true, blockReason: 'dirty tree' } : null))
  const code = await main(['feature-implement', '--pr', '--agent', 'claude', '--cwd', repo], implement.adapters)
  assert.equal(code, 2)
  assert.match(implement.calls[0].prompt, /qa-kit-artifacts\/ABC-1-test-plan\.md/)
  assert.deepEqual(implement.calls[0].policy, { commit: true, push: true, pr: true })
})

test('a commit on the default branch during the run exits 3 and is recorded in the report', async t => {
  const repo = makeRepo(t)
  const output = quiet(t)
  const { adapters } = fakeAgents(() => {
    commit(repo, 'src/sneaky.ts')
    return planAnswer()
  })
  const code = await main(['feature-plan', 'ABC-1', '--agent', 'claude', '--cwd', repo], adapters)
  assert.equal(code, 3)
  assert.match(output.err.join('\n'), /SAFETY VIOLATION: default branch main moved/)
  const latest = JSON.parse(readFileSync(path.join(repo, 'qa-kit-artifacts', 'latest', 'feature-plan.json'), 'utf8'))
  assert.ok(latest.violations.some(violation => /default branch main moved/.test(violation)))
})

test('dry run prints the resolved args and writes nothing', async t => {
  const repo = makeRepo(t)
  const output = quiet(t)
  const { adapters, calls } = fakeAgents(planAnswer)
  const code = await main(['feature-deliver', '--pr', '--agent', 'claude', '--cwd', repo, '--dry-run'], adapters)
  assert.equal(code, 0)
  assert.equal(calls.length, 0)
  assert.ok(!existsSync(path.join(repo, 'qa-kit-artifacts')))
  const printed = JSON.parse(output.out.join('\n'))
  assert.equal(printed.workflow, 'feature-deliver')
  assert.equal(printed.args.createPr, true)
  assert.equal(printed.args.agentPrefix, 'qa-kit:')
  assert.deepEqual(printed.args.targets, [{ branch: git(repo, 'branch', '--show-current'), worktreePath: repo }])
})

test('usage errors exit 1 with a one-line message', async t => {
  const output = quiet(t)
  assert.equal(await main(['feature-plan', 'ABC-1']), 1)
  assert.match(output.err.join('\n'), /qa-kit: --agent must be one of: claude, opencode/)
  assert.equal(await main([]), 1)
})

const HOSTILE = 'https://www.figma.com/design/abc/X?node-id=1-2&t=x'
const reader = text => ({ readStdin: async () => text })

async function dryRun(t, argv, io) {
  const output = quiet(t)
  const code = await main([...argv, '--agent', 'claude', '--dry-run'], undefined, io)
  return { code, printed: code === 0 ? JSON.parse(output.out.join('\n')) : null, err: output.err.join('\n') }
}

test('--args-stdin and --args-file give the same parsed args as the equivalent argv', async t => {
  const text = `ABC-1,\n${HOSTILE}; $(whoami) \`id\` #x,\n"Add export, with headers" --parallel=2`
  const direct = await dryRun(t, ['feature-plan', 'ABC-1,', `${HOSTILE};`, '$(whoami)', '`id`', '#x,', 'Add export, with headers', '--parallel=2'])
  assert.equal(direct.code, 0)
  assert.equal(direct.printed.args.features.length, 6)

  const viaStdin = await dryRun(t, ['feature-plan', '--args-stdin'], reader(text))
  assert.deepEqual(viaStdin.printed, direct.printed)

  const file = path.join(makeDir(t), 'args.txt')
  writeFileSync(file, '\uFEFF' + text)
  const viaFile = await dryRun(t, ['feature-plan', '--args-file', file])
  assert.deepEqual(viaFile.printed, direct.printed)
  const viaFileEquals = await dryRun(t, ['feature-plan', `--args-file=${file}`])
  assert.deepEqual(viaFileEquals.printed, direct.printed)
})

test('text from stdin is added to the rest of argv and flags in it behave like argv flags', async t => {
  const repo = makeRepo(t)
  const base = ['feature-deliver', '--cwd', repo, '--args-stdin', '--no-apply']
  const { printed } = await dryRun(t, base, reader('--parallel=3 --pr\n'))
  assert.equal(printed.args.apply, false)
  assert.equal(printed.args.maxParallel, 3)
  assert.equal(printed.args.createPr, true)

  const { printed: later } = await dryRun(t, base, reader('--apply'))
  assert.equal(later.args.apply, true)

  const unused = await dryRun(t, ['feature-plan', 'ABC-1'], reader('ignored'))
  assert.equal(unused.printed.args.features.length, 1)
})

test('an empty body is no arguments, and a bad body is a one-line usage error', async t => {
  const noSource = await dryRun(t, ['feature-plan', '--args-stdin'], reader('\n'))
  assert.equal(noSource.code, 1)
  assert.match(noSource.err, /feature-plan needs at least one source/)
  const unterminated = await dryRun(t, ['feature-plan', '--args-stdin'], reader('Add "export'))
  assert.equal(unterminated.code, 1)
  assert.match(unterminated.err, /qa-kit: unterminated " quote/)
})

test('--args-stdin and --args-file are mutually exclusive and --args-file must exist', async t => {
  const both = await dryRun(t, ['feature-plan', '--args-stdin', '--args-file', 'x.txt'], reader('ABC-1'))
  assert.equal(both.code, 1)
  assert.match(both.err, /--args-stdin and --args-file are mutually exclusive/)
  const twice = await dryRun(t, ['feature-plan', '--args-stdin', '--args-stdin'], reader('ABC-1'))
  assert.match(twice.err, /mutually exclusive/)

  const missing = await dryRun(t, ['feature-plan', '--args-file', path.join(makeDir(t), 'nope.txt')])
  assert.equal(missing.code, 1)
  assert.match(missing.err, /--args-file: cannot read .*nope\.txt: no such file/)
  const noPath = await dryRun(t, ['feature-plan', '--args-file='])
  assert.match(noPath.err, /--args-file needs a path/)
  const valued = await dryRun(t, ['feature-plan', '--args-stdin=x'], reader('ABC-1'))
  assert.match(valued.err, /--args-stdin=x is not a valid flag/)
})

test('the usage text names the stdin and file options, the required agent and the timeout unit', async t => {
  const output = quiet(t)
  assert.equal(await main(['--help']), 0)
  const usage = output.out.join('\n')
  assert.match(usage, /--args-stdin/)
  assert.match(usage, /--args-file PATH/)
  assert.match(usage, /--agent NAME \(required\)/)
  assert.match(usage, /--timeout MINUTES/)
})

test('a launcher that cannot take the arguments stops the run before any stage', async t => {
  const repo = makeRepo(t)
  const output = quiet(t)
  let ran = false
  const failing = {
    agentPrefix: 'qa-kit:',
    createAdapter: () => ({
      preflight() {
        throw new Error('claude resolves to C:/npm/claude.cmd (an npm .cmd shim) which cannot take the --json-schema argument safely; install the native claude.exe and put it first on PATH')
      },
      async run() {
        ran = true
        return null
      },
    }),
  }
  const code = await main(['feature-plan', 'ABC-1', '--agent', 'claude', '--cwd', repo], { claude: failing })
  assert.equal(code, 1)
  assert.equal(ran, false)
  assert.match(output.err.join('\n'), /^qa-kit: claude resolves to .*claude\.cmd.*--json-schema argument safely; install the native claude\.exe/)
  assert.ok(!existsSync(path.join(repo, 'qa-kit-artifacts')))
})

test('every OpenCode wrapper passes the arguments through a quoted heredoc and never on the command line', () => {
  for (const name of ['feature-plan', 'feature-implement', 'feature-deliver', 'feature-monkey']) {
    const text = readFileSync(new URL(`../../opencode/commands/${name}.md`, import.meta.url), 'utf8')
    const command = `node "@QA_KIT_ROOT@/runner/qa-kit.mjs" ${name} --agent opencode --args-stdin <<'QA_KIT_ARGS'\n$ARGUMENTS\nQA_KIT_ARGS\n`
    assert.ok(text.includes(command), name)
    assert.deepEqual(text.split('\n').filter(line => line.includes('$ARGUMENTS')), ['$ARGUMENTS'], name)
    assert.match(text, /--args-file/, name)
  }
})

test('the run summary names coverage gaps and the paths Deliver left out', async t => {
  const repo = makeRepo(t)
  const output = quiet(t)
  const plans = fakeAgents(planAnswer)
  await main(['feature-plan', 'ABC-1', '--agent', 'claude', '--cwd', repo], plans.adapters)
  const answers = {
    write: { specFiles: ['a.spec.ts'], filesWritten: ['a.spec.ts'], lintClean: true, worktreePath: repo, branch: 'feature/abc-1', baselineChanges: [], blocked: false },
    execute: { passed: true, blocked: false },
    review: { lintClean: true, filesChanged: [], coverageGaps: ['Export empty order list: no test'] },
    deliver: { committed: true, pushed: false, skippedPaths: ['src/user.ts'], blocked: false },
  }
  const implement = fakeAgents(call => answers[call.label.split(':')[0]])
  await main(['feature-implement', '--commit', '--agent', 'claude', '--cwd', repo], implement.adapters)
  const summary = output.out.filter(line => line.startsWith('- ABC-1')).at(-1)
  assert.match(summary, /coverageGaps=Export empty order list: no test/)
  assert.match(summary, /skippedPaths=src\/user\.ts/)
  const saved = JSON.parse(readFileSync(path.join(repo, 'qa-kit-artifacts', 'latest', 'feature-implement.json'), 'utf8')).report[0]
  assert.deepEqual(saved.ownedFiles, ['a.spec.ts'])

  // a second run of the same plan hands the ledger forward
  const again = fakeAgents(call => answers[call.label.split(':')[0]])
  await main(['feature-implement', '--agent', 'claude', '--cwd', repo], again.adapters)
  assert.match(again.calls[0].prompt, /left these files uncommitted: a\.spec\.ts/)
})
