#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHANGES_DIR, begin, check, finalize } from './lib/select-gate.mjs'

const USAGE = `usage: node runner/select-gate.mjs <begin|finalize|check> [--cwd DIR] [--min-confidence=high|medium] [--threshold=PERCENT] [--no-smoke] [--smoke-tag=TAG] [--index-file PATH]
  begin     start a run: removes ${CHANGES_DIR}/ left by an earlier run and records the state of the tree
  finalize  read ${CHANGES_DIR}/changes.json (the analysis), decide, write selection.json, selection.md and selection.args
  check     re-check what is on disk; a missing, stale or invalid selection is rewritten as the full suite`

function parse(argv) {
  const [command, ...rest] = argv
  const options = { smoke: true }
  let cwd = process.cwd()
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    const eq = token.indexOf('=')
    const name = eq === -1 ? token : token.slice(0, eq)
    const value = eq === -1 ? undefined : token.slice(eq + 1)
    if (name === '--cwd') cwd = path.resolve(value ?? rest[++i] ?? '')
    else if (name === '--index-file') options.indexFile = path.resolve(value ?? rest[++i] ?? '')
    else if (name === '--no-smoke' && value === undefined) options.smoke = false
    else if (name === '--smoke-tag' && value) options.smokeTag = value
    else if (name === '--min-confidence' && ['high', 'medium'].includes(value)) options.minConfidence = value
    else if (name === '--threshold' && /^([1-9]\d?|100)$/.test(value ?? '')) options.threshold = Number(value)
    else throw new Error(`${token} is not a valid argument`)
  }
  return { command, cwd, options }
}

export function main(argv, out = console.log) {
  try {
    const { command, cwd, options } = parse(argv)
    if (command === 'begin') {
      out(JSON.stringify(begin(cwd)))
    } else if (command === 'finalize') {
      const { result, screen } = finalize(cwd, options)
      out(
        JSON.stringify({
          mode: result.mode,
          fallbackReason: result.fallbackReason,
          noneReason: result.noneReason,
          reason: result.reason,
          selectedFiles: result.totals.selected,
          suiteFiles: result.totals.suite,
          confidence: result.confidence,
          selectionFile: `${CHANGES_DIR}/selection.json`,
          argsFile: `${CHANGES_DIR}/selection.args`,
          screen,
        }),
      )
    } else if (command === 'check') {
      const { ok, problems } = check(cwd)
      out(JSON.stringify({ ok, problems }))
    } else {
      console.error(USAGE)
      return 1
    }
    return 0
  } catch (err) {
    console.error(`select-gate: ${err.message}`)
    return 1
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) process.exitCode = main(process.argv.slice(2))
