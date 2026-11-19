import { DEFAULT_TIMEOUT_MS, assertLaunchable, resolveExecutable, runProcess } from '../process.mjs'
import { validate } from '../schema.mjs'

export const agentPrefix = 'qa-kit-'

const PREVIOUS_REPLY_LIMIT = 4000

export function schemaInstructions(schema) {
  return (
    '\n\nWhen you are finished, end your final message with exactly one fenced json code block holding your result and nothing after it. ' +
    `The block must be a JSON object matching this JSON Schema:\n${JSON.stringify(schema, null, 2)}`
  )
}

export function extractJsonBlock(text) {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)]
  if (!blocks.length) throw new Error('the final message has no fenced json block')
  return JSON.parse(blocks.at(-1)[1])
}

export function textFromEvents(stdout) {
  const parts = []
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line)
      if (event?.type === 'text' && typeof event.part?.text === 'string') parts.push(event.part.text)
    } catch {
      // Not an event line.
    }
  }
  return parts.length ? parts.join('\n') : stdout
}

function interpret(text, schema) {
  try {
    const value = extractJsonBlock(text)
    const errors = validate(value, schema)
    return errors.length ? { error: errors.join('; ') } : { value }
  } catch (err) {
    return { error: err.message }
  }
}

function repairPrompt(previous, error, schema) {
  return (
    `Your previous reply could not be used: ${error}.\n\nPrevious reply (end):\n${previous.slice(-PREVIOUS_REPLY_LIMIT)}\n\n` +
    'Do not redo any work and do not run any tools. State the result of that reply again as the final JSON block.' +
    schemaInstructions(schema)
  )
}

function buildArgs(agentType, model) {
  return ['run', '--agent', agentType, '--format', 'json', ...(model ? ['--model', model] : [])]
}

export function createAdapter({ model, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, log = () => {}, exec = runProcess, resolve = resolveExecutable }) {
  async function ask(agentType, prompt, label, callTimeoutMs) {
    const args = buildArgs(agentType, model)
    try {
      const result = await exec({ command: 'opencode', args, input: prompt, cwd, timeoutMs: Math.min(callTimeoutMs ?? Infinity, timeoutMs) })
      if (result.timedOut) log(`${label}: timed out`)
      else if (result.code !== 0) log(`${label}: opencode exited ${result.code}: ${result.stderr.trim().slice(-300)}`)
      else return textFromEvents(result.stdout)
    } catch (err) {
      log(`${label}: ${err.message}`)
    }
    return null
  }

  return {
    agentPrefix,
    preflight() {
      assertLaunchable('opencode', buildArgs(`${agentPrefix}test-planner`, model), resolve)
    },
    async run({ prompt, agentType, schema, label, timeoutMs: callTimeoutMs }) {
      let message = prompt + schemaInstructions(schema)
      for (let attempt = 1; attempt <= 2; attempt++) {
        const text = await ask(agentType, message, label, callTimeoutMs)
        if (text === null) return null
        const { value, error } = interpret(text, schema)
        if (value) return value
        log(`${label}: unusable result (${error})${attempt === 1 ? ' - asking once more' : ''}`)
        message = repairPrompt(text, error, schema)
      }
      return null
    },
  }
}
