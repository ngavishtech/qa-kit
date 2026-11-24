#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as claude from './lib/adapters/claude.mjs'
import * as opencode from './lib/adapters/opencode.mjs'
import { READ_ONLY_STRICT, authorization, snapshot, verify } from './lib/guard.mjs'
import { parseCli, splitArgs } from './lib/parse.mjs'
import { killAll } from './lib/process.mjs'
import { makeRuntime } from './lib/shims.mjs'
import { ensureArtifacts, finishChangeRun, resolveInputs, saveRun, startChangeRun } from './lib/state.mjs'

export { parseCli } from './lib/parse.mjs'

const ADAPTERS = { claude, opencode }
const USAGE = `usage: node runner/qa-kit.mjs <feature-plan|feature-implement|feature-deliver|feature-monkey|feature-diff|feature-select> [items and flags] --agent claude|opencode
  run options: --agent NAME (required)  --model ID  --cwd DIR  --timeout MINUTES  --dry-run
  argument text: --args-stdin (read the items and flags from stdin)  --args-file PATH (read them from a file)
    the text is split like a shell would, without expanding anything, and appended to the other arguments; use at most one of the two
  see commands/<workflow>.md for the workflow flags (value flags are written --name=value)`
const SUMMARY_FIELDS = ['planPath', 'testType', 'level', 'branch', 'worktreePath', 'stage', 'coverageGaps', 'handChanges', 'skippedPaths', 'committed', 'pushed', 'prUrl', 'reportPath', 'findingsPlanPath', 'findingsSummary', 'cleanup', 'leftBehind', 'coverage', 'planFailures', 'mode', 'fallbackReason', 'confidence', 'selectedFiles', 'suiteFiles', 'selectionFile', 'argsFile', 'handoffFile', 'gaps', 'plans', 'implementCommand', 'affectedRun', 'blockReason']

function readMeta(source) {
  const match = /^export const meta = (\{[\s\S]*?\n\})/m.exec(source)
  return match ? new Function(`return ${match[1]}`)() : null
}

export async function runWorkflow({ name, args, adapter, log }) {
  const source = await readFile(new URL(`../workflows/${name}.js`, import.meta.url), 'utf8')
  const meta = readMeta(source)
  if (meta) log(`${name}: ${meta.phases.map(phase => phase.title).join(' > ')}`)
  const runtime = makeRuntime({ adapter, log })
  const body = new Function('args', 'agent', 'log', 'pipeline', 'parallel', `return (async()=>{${source.replace(/^export const meta/m, 'const meta')}})()`)
  return body(args, runtime.agent, runtime.log, runtime.pipeline, runtime.parallel)
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const stderrLog = message => console.error(`[${new Date().toTimeString().slice(0, 8)}] ${message}`)

function summarize(report) {
  return report.map(entry => {
    const shown = key => entry[key] !== undefined && !(Array.isArray(entry[key]) && !entry[key].length)
    const fields = SUMMARY_FIELDS.filter(shown).map(key => `${key}=${Array.isArray(entry[key]) ? entry[key].join('; ') : entry[key]}`)
    return `- ${entry.task ?? entry.branch}${entry.blocked ? ' [BLOCKED]' : ''}: ${fields.join(' ')}`
  })
}

export async function expandArgs(argv, { readStdin: stdin = readStdin } = {}) {
  const rest = []
  const sources = []
  for (let i = 0; i < argv.length; i++) {
    const match = /^--args-(stdin|file)(?:=(.*))?$/.exec(argv[i])
    if (!match) {
      rest.push(argv[i])
    } else if (match[1] === 'stdin' && match[2] === undefined) {
      sources.push({ stdin: true })
    } else if (match[1] === 'file') {
      const file = match[2] ?? argv[++i]
      if (!file) throw new Error('--args-file needs a path')
      sources.push({ file })
    } else {
      throw new Error(`${argv[i]} is not a valid flag (--args-stdin takes no value)`)
    }
  }
  if (sources.length > 1) throw new Error('--args-stdin and --args-file are mutually exclusive: use only one of them, once')
  if (!sources.length) return rest
  const [source] = sources
  let text
  if (source.stdin) {
    text = await stdin()
  } else {
    try {
      text = await readFile(source.file, 'utf8')
    } catch (err) {
      throw new Error(`--args-file: cannot read ${source.file}: ${err.code === 'ENOENT' ? 'no such file' : err.message}`)
    }
  }
  return [...rest, ...splitArgs(text.replace(/^\uFEFF/, ''))]
}

async function execute({ workflow, args, options, cwd, agent }) {
  const adapter = agent.createAdapter({
    model: options.model,
    cwd,
    policy: authorization(args, workflow),
    readOnly: READ_ONLY_STRICT.includes(workflow) ? { strict: true, allowFetch: args.fetch === true } : undefined,
    timeoutMs: options.timeoutMs,
    log: stderrLog,
  })
  adapter.preflight()
  ensureArtifacts(cwd)
  startChangeRun({ workflow, cwd })
  const before = snapshot(cwd)
  const startedAt = new Date()
  let report = []
  let failure
  try {
    report = await runWorkflow({ name: workflow, args, adapter, log: stderrLog })
  } catch (err) {
    failure = err
  }
  const warnings = []
  if (!failure) finishChangeRun({ workflow, args, report, cwd, warn: message => warnings.push(message) })
  const violations = verify({ before, workflow, report, args, cwd, warn: message => warnings.push(message) })
  const runDir = saveRun({ cwd, workflow, startedAt, args, report, violations, warnings })
  if (failure) throw failure

  console.log(summarize(report).join('\n'))
  for (const warning of warnings) console.error(`warning: ${warning}`)
  for (const violation of violations) console.error(`SAFETY VIOLATION: ${violation}`)
  console.log(`report: ${path.join(runDir, 'report.json')}`)
  if (violations.length) return 3
  return report.some(entry => entry.blocked) ? 2 : 0
}

export async function main(argv, adapters = ADAPTERS, io = {}) {
  try {
    if (!argv.length || argv.includes('--help')) {
      console.log(USAGE)
      return argv.length ? 0 : 1
    }
    const { workflow, options, items, args: parsed } = parseCli(await expandArgs(argv, io))
    const cwd = path.resolve(options.cwd ?? process.cwd())
    const agent = adapters[options.agent]
    const args = resolveInputs({ workflow, items, cwd, args: { agentPrefix: agent.agentPrefix, ...parsed } })
    if (options.dryRun) {
      console.log(JSON.stringify({ workflow, agent: options.agent, model: options.model, cwd, args }, null, 2))
      return 0
    }
    process.once('SIGINT', () => {
      killAll()
      process.exit(130)
    })
    return await execute({ workflow, args, options, cwd, agent })
  } catch (err) {
    console.error(`qa-kit: ${err.message}`)
    return 1
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  process.exitCode = await main(process.argv.slice(2))
}
