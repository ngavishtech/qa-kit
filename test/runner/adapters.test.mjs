import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import * as claude from '../../runner/lib/adapters/claude.mjs'
import * as opencode from '../../runner/lib/adapters/opencode.mjs'
import { assertLaunchable, resolveExecutable, runProcess } from '../../runner/lib/process.mjs'
import { validate } from '../../runner/lib/schema.mjs'

const SCHEMA = {
  type: 'object',
  properties: {
    planPath: { type: 'string' },
    testType: { type: 'string', enum: ['ui', 'api', 'both'] },
    specFiles: { type: 'array', items: { type: 'string' } },
    blocked: { type: 'boolean' },
  },
  required: ['blocked'],
}

const fence = value => `done.\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`
const events = (...texts) => texts.map(text => JSON.stringify({ type: 'text', part: { text } })).join('\n')

function fakeExec(...replies) {
  const calls = []
  const exec = async call => {
    calls.push(call)
    return { code: 0, stderr: '', timedOut: false, ...replies[Math.min(calls.length, replies.length) - 1] }
  }
  return { exec, calls }
}

test('validate checks types, enums, required keys and array items', () => {
  assert.deepEqual(validate({ blocked: false, testType: 'ui', specFiles: ['a'] }, SCHEMA), [])
  assert.deepEqual(validate({ testType: 'ui' }, SCHEMA), ['$.blocked is required'])
  assert.deepEqual(validate({ blocked: 'no' }, SCHEMA), ['$.blocked must be boolean'])
  assert.deepEqual(validate({ blocked: false, testType: 'x' }, SCHEMA), ['$.testType must be one of ui, api, both'])
  assert.deepEqual(validate({ blocked: false, specFiles: ['a', 2] }, SCHEMA), ['$.specFiles[1] must be string'])
  assert.deepEqual(validate([], SCHEMA), ['$ must be object'])
  assert.deepEqual(validate(null, SCHEMA), ['$ must be object'])
})

test('claude runs headless print mode with the schema, agent and prompt on stdin', async () => {
  const { exec, calls } = fakeExec({ stdout: JSON.stringify({ is_error: false, structured_output: { blocked: false, planPath: 'p.md' } }) })
  const adapter = claude.createAdapter({ model: 'opus', cwd: '/repo', policy: { commit: false, push: false, pr: false }, exec })
  const result = await adapter.run({ prompt: 'plan it', agentType: 'qa-kit:agent-planner', schema: SCHEMA, label: 'plan:x' })
  assert.deepEqual(result, { blocked: false, planPath: 'p.md' })
  const [call] = calls
  assert.equal(call.command, 'claude')
  assert.equal(call.input, 'plan it')
  assert.equal(call.cwd, '/repo')
  const { args } = call
  const valueOf = flag => args[args.indexOf(flag) + 1]
  assert.ok(args.includes('-p'))
  assert.equal(valueOf('--output-format'), 'json')
  assert.equal(valueOf('--agent'), 'qa-kit:agent-planner')
  assert.deepEqual(JSON.parse(valueOf('--json-schema')), SCHEMA)
  assert.equal(valueOf('--model'), 'opus')
  assert.ok(!args.includes('plan it'))
})

test('claude denies commit, push and pull requests unless the run authorized them', () => {
  const none = claude.toolRules({ commit: false, push: false, pr: false })
  for (const rule of ['Bash(git commit*)', 'Bash(git push*)', 'Bash(gh pr create*)', 'Bash(git add -A*)', 'Bash(git add .*)', 'Bash(git commit*--no-verify*)', 'Bash(git push*--force*)']) {
    assert.ok(none.deny.includes(rule), rule)
  }
  assert.ok(!none.allow.includes('Bash(git push*)'))
  assert.ok(!none.allow.includes('Bash(git commit *)'))

  const commitOnly = claude.toolRules({ commit: true, push: false, pr: false })
  assert.ok(!commitOnly.deny.includes('Bash(git commit*)'))
  assert.ok(commitOnly.deny.includes('Bash(git commit*--no-verify*)'))
  assert.ok(commitOnly.allow.includes('Bash(git commit *)'))
  assert.ok(commitOnly.deny.includes('Bash(git push*)'))

  const pushOnly = claude.toolRules({ commit: true, push: true, pr: false })
  assert.ok(!pushOnly.deny.includes('Bash(git push*)'))
  assert.ok(pushOnly.deny.includes('Bash(gh pr create*)'))
  assert.ok(pushOnly.deny.includes('Bash(git push*--force*)'))
  assert.ok(pushOnly.allow.includes('Bash(git push*)'))

  const both = claude.toolRules({ commit: true, push: true, pr: true })
  assert.ok(!both.deny.includes('Bash(gh pr create*)'))
  assert.ok(both.allow.includes('Bash(gh pr create*)'))
})

test('claude returns null when there is no structured result, on timeout, or when the process cannot start', async () => {
  const messages = []
  const make = exec => claude.createAdapter({ cwd: '.', policy: { commit: false, push: false, pr: false }, exec, log: message => messages.push(message) })
  const job = { prompt: 'p', agentType: 'a', schema: SCHEMA, label: 'l' }
  assert.equal(await make(fakeExec({ stdout: JSON.stringify({ is_error: true, subtype: 'error_max_turns' }) }).exec).run(job), null)
  assert.equal(await make(fakeExec({ stdout: 'not json', code: 1 }).exec).run(job), null)
  assert.equal(await make(fakeExec({ stdout: '', timedOut: true }).exec).run(job), null)
  assert.equal(await make(async () => { throw new Error("'claude' was not found on PATH") }).run(job), null)
  assert.equal(messages.length, 4)
})

test('opencode extracts and validates the last fenced json block', async () => {
  const { exec, calls } = fakeExec({ stdout: events('thinking', fence({ blocked: true, blockReason: 'x' })) })
  const adapter = opencode.createAdapter({ model: 'anthropic/sonnet', cwd: '/repo', exec })
  const result = await adapter.run({ prompt: 'plan it', agentType: 'qa-kit-agent-planner', schema: SCHEMA, label: 'l' })
  assert.deepEqual(result, { blocked: true, blockReason: 'x' })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, ['run', '--agent', 'qa-kit-agent-planner', '--format', 'json', '--model', 'anthropic/sonnet'])
  assert.ok(calls[0].input.startsWith('plan it'))
  assert.ok(calls[0].input.includes('"testType"'))
  assert.ok(calls[0].input.includes('fenced json code block'))
})

test('opencode falls back to raw stdout and prefers the last block', async () => {
  const stdout = `${fence({ blocked: true })}\nrevised\n${fence({ blocked: false })}`
  const { exec } = fakeExec({ stdout })
  const result = await opencode.createAdapter({ cwd: '.', exec }).run({ prompt: 'p', agentType: 'a', schema: SCHEMA, label: 'l' })
  assert.deepEqual(result, { blocked: false })
})

test('opencode asks once more when the block is missing or invalid, then gives up', async () => {
  const messages = []
  const repaired = fakeExec({ stdout: events('I did the work') }, { stdout: events(fence({ blocked: false })) })
  const adapter = opencode.createAdapter({ cwd: '.', exec: repaired.exec, log: message => messages.push(message) })
  assert.deepEqual(await adapter.run({ prompt: 'p', agentType: 'a', schema: SCHEMA, label: 'l' }), { blocked: false })
  assert.equal(repaired.calls.length, 2)
  assert.match(repaired.calls[1].input, /could not be used: the final message has no fenced json block/)
  assert.match(repaired.calls[1].input, /I did the work/)
  assert.match(repaired.calls[1].input, /do not run any tools/)

  const hopeless = fakeExec({ stdout: events(fence({ planPath: 1 })) })
  const result = await opencode.createAdapter({ cwd: '.', exec: hopeless.exec }).run({ prompt: 'p', agentType: 'a', schema: SCHEMA, label: 'l' })
  assert.equal(result, null)
  assert.equal(hopeless.calls.length, 2)
  assert.match(hopeless.calls[1].input, /\$\.blocked is required/)
})

test('opencode returns null without retrying when the process fails', async () => {
  const failed = fakeExec({ code: 1, stderr: 'no such agent' })
  assert.equal(await opencode.createAdapter({ cwd: '.', exec: failed.exec }).run({ prompt: 'p', agentType: 'a', schema: SCHEMA, label: 'l' }), null)
  assert.equal(failed.calls.length, 1)
  const timedOut = fakeExec({ timedOut: true, code: null })
  assert.equal(await opencode.createAdapter({ cwd: '.', exec: timedOut.exec }).run({ prompt: 'p', agentType: 'a', schema: SCHEMA, label: 'l' }), null)
})

test('resolveExecutable finds .exe and .cmd through PATHEXT and only shells out for scripts', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qa-kit-path-'))
  try {
    writeFileSync(path.join(dir, 'native.exe'), '')
    writeFileSync(path.join(dir, 'shim.cmd'), '')
    mkdirSync(path.join(dir, 'folder.exe'))
    const env = { PATH: `C:\\nowhere;${dir}`, PATHEXT: '.com;.exe;.bat;.cmd' }
    assert.deepEqual(resolveExecutable('native', { env, platform: 'win32' }), { file: path.join(dir, 'native.exe'), shell: false })
    assert.deepEqual(resolveExecutable('shim', { env, platform: 'win32' }), { file: path.join(dir, 'shim.cmd'), shell: true })
    assert.throws(() => resolveExecutable('folder', { env, platform: 'win32' }), /not found on PATH/)
    assert.throws(() => resolveExecutable('missing', { env, platform: 'win32' }), /'missing' was not found on PATH/)
    assert.deepEqual(resolveExecutable('claude', { env, platform: 'linux' }), { file: 'claude', shell: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runProcess feeds stdin, captures output and kills a process that exceeds its timeout', async () => {
  const echoed = await runProcess({ command: 'node', args: ['-e', 'process.stdin.pipe(process.stdout)'], input: 'hello "quoted" & more' })
  assert.equal(echoed.code, 0)
  assert.equal(echoed.stdout, 'hello "quoted" & more')

  const started = Date.now()
  const hung = await runProcess({ command: 'node', args: ['-e', 'setTimeout(() => {}, 60000)'], input: '', timeoutMs: 300 })
  assert.equal(hung.timedOut, true)
  assert.ok(Date.now() - started < 10_000)

  await assert.rejects(runProcess({ command: 'qa-kit-no-such-binary', args: [], input: '' }), /qa-kit-no-such-binary/)
})

const shim = file => () => ({ file, shell: true })
const native = file => () => ({ file, shell: false })
const POLICY = { commit: false, push: false, pr: false }

test('claude preflight rejects an npm .cmd shim once, naming the argument it cannot take', () => {
  const shimmed = claude.createAdapter({ cwd: '.', policy: POLICY, resolve: shim('C:/npm/claude.cmd') })
  assert.throws(
    () => shimmed.preflight(),
    new Error('claude resolves to C:/npm/claude.cmd (an npm .cmd shim) which cannot take the --json-schema argument safely; install the native claude.exe and put it first on PATH'),
  )
})

test('claude preflight passes for a native executable and fails when claude is not on PATH', () => {
  claude.createAdapter({ cwd: '.', policy: POLICY, resolve: native('C:/bin/claude.exe') }).preflight()
  const missing = () => {
    throw new Error("'claude' was not found on PATH")
  }
  assert.throws(() => claude.createAdapter({ cwd: '.', policy: POLICY, resolve: missing }).preflight(), /'claude' was not found on PATH/)
})

test('opencode preflight accepts a .cmd shim with plain arguments and rejects an unsafe model or path', () => {
  opencode.createAdapter({ model: 'anthropic/claude-sonnet-4', cwd: '.', resolve: shim('C:/npm/opencode.cmd') }).preflight()
  opencode.createAdapter({ cwd: '.', resolve: native('C:/bin/opencode.exe') }).preflight()
  assert.throws(
    () => opencode.createAdapter({ model: 'a b', cwd: '.', resolve: shim('C:/npm/opencode.cmd') }).preflight(),
    /opencode resolves to .*opencode\.cmd \(an npm \.cmd shim\) which cannot take the --model argument safely/,
  )
  assert.throws(() => opencode.createAdapter({ cwd: '.', resolve: shim('C:/a&b/opencode.cmd') }).preflight(), /unsafe characters in the path/)
})

test('assertLaunchable only inspects the arguments when the launcher is a shell script', () => {
  assertLaunchable('tool', ['--json', '{"a": 1}'], native('/bin/tool'))
  assertLaunchable('tool', ['run', '--format', 'json'], shim('C:/npm/tool.cmd'))
  assert.throws(() => assertLaunchable('tool', ['{"a": 1}'], shim('C:/npm/tool.cmd')), /cannot take the \{"a": 1\} argument safely/)
})
