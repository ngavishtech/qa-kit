export const WORKFLOWS = {
  'feature-plan': { switches: [], values: ['parallel', 'agent-prefix'] },
  'feature-implement': {
    switches: ['commit', 'push', 'pr', 'heal', 'no-heal', 'apply', 'no-apply'],
    values: ['parallel', 'base', 'worktree-dir', 'install', 'agent-prefix', 'level'],
  },
  'feature-deliver': { switches: ['commit', 'push', 'pr', 'apply', 'no-apply'], values: ['parallel', 'agent-prefix'] },
  'feature-monkey': {
    switches: ['read-only', 'no-cache'],
    values: ['minutes', 'unit-minutes', 'guidance', 'seed', 'parallel', 'agent-prefix'],
  },
}

export const AGENTS = ['claude', 'opencode']

const SWITCH_ARGS = {
  commit: { commit: true },
  push: { push: true },
  pr: { createPr: true },
  heal: { heal: true },
  'no-heal': { heal: false },
  apply: { apply: true },
  'no-apply': { apply: false },
  'read-only': { readOnly: true },
  'no-cache': { noCache: true },
}

function nonEmpty(value, flag) {
  if (!value) throw new Error(`${flag}= needs a value`)
  return value
}

function positiveInt(value, flag) {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${flag} needs a positive integer`)
  return Number(value)
}

export const MAX_MONKEY_MINUTES = 30

function monkeyMinutes(value, flag) {
  const minutes = positiveInt(value, flag)
  if (minutes > MAX_MONKEY_MINUTES) throw new Error(`${flag} is at most ${MAX_MONKEY_MINUTES} minutes: a longer run needs a decision from the owner`)
  return minutes
}

export const LEVELS = ['smoke', 'sanity', 'regression']

function level(value, flag) {
  const lower = value.toLowerCase()
  if (!LEVELS.includes(lower)) throw new Error(`${flag} needs ${LEVELS.slice(0, -1).join(', ')} or ${LEVELS.at(-1)}`)
  return lower
}

const VALUE_ARGS = {
  level: ['level', level],
  minutes: ['minutes', monkeyMinutes],
  'unit-minutes': ['unitMinutes', monkeyMinutes],
  guidance: ['guidance', nonEmpty],
  seed: ['seed', positiveInt],
  parallel: ['maxParallel', positiveInt],
  'agent-prefix': ['agentPrefix', value => value],
  base: ['baseRef', nonEmpty],
  'worktree-dir': ['worktreeDir', nonEmpty],
  install: ['installCommand', nonEmpty],
}

const JIRA_KEY = /^[A-Z][A-Z0-9_]+-\d+$/
const PLAN_FILE = /^(\.[\\/])?qa-kit-artifacts[\\/]/

export function isPlanFile(item) {
  return PLAN_FILE.test(item) || /\.md$/i.test(item)
}

// Shell-style tokenising without any expansion: only whitespace, quotes and backslashes are special.
export function splitArgs(text) {
  const tokens = []
  let token = ''
  let started = false
  let quote = null
  const push = () => {
    if (started) tokens.push(token)
    token = ''
    started = false
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote === "'") {
      if (char === "'") quote = null
      else token += char
    } else if (quote === '"') {
      if (char === '"') quote = null
      else if (char === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) token += text[++i]
      else token += char
    } else if (/\s/.test(char)) {
      push()
    } else if (char === "'" || char === '"') {
      quote = char
      started = true
    } else {
      started = true
      // Only a quote, a space or another backslash is escapable, so Windows paths like qa-kit-artifacts\x.md survive.
      if (char === '\\' && /["'\\\s]/.test(text[i + 1] ?? '')) token += text[++i]
      else token += char
    }
  }
  if (quote) throw new Error(`unterminated ${quote} quote in the arguments: close it, or escape a literal ${quote} with a backslash`)
  push()
  return tokens
}

function unquote(text) {
  return /^(["']).*\1$/.test(text) ? text.slice(1, -1) : text
}

// The shell already grouped quoted text into one token, so a token with whitespace is free text: only a trailing separator comma is dropped.
export function itemsFromTokens(tokens) {
  return tokens
    .flatMap(token => (/\s/.test(token) ? [unquote(token.replace(/,$/, ''))] : token.split(',').map(unquote)))
    .map(item => item.trim())
    .filter(Boolean)
}

export function classify(item) {
  if (!/\s/.test(item)) {
    if (JIRA_KEY.test(item)) return 'jiraKeys'
    if (item.includes('figma.com')) return 'figmaLinks'
    if (/^testrail:/i.test(item) || item.includes('/index.php?/')) return 'testrailLocations'
    if (PLAN_FILE.test(item)) return 'planFiles'
  }
  return 'descriptions'
}

function toSources(items) {
  const sources = {}
  for (const item of items) (sources[classify(item)] ??= []).push(item)
  return sources
}

function planSources(tokens) {
  const leftover = []
  const blocks = []
  for (const token of tokens) {
    if (token === '--plan' || token === '--update') blocks.push({ kind: token, tokens: [] })
    else (blocks.at(-1)?.tokens ?? leftover).push(token)
  }
  const features = itemsFromTokens(leftover).map(item => toSources([item]))
  const updates = []
  for (const block of blocks) {
    const items = itemsFromTokens(block.tokens)
    if (!items.length) throw new Error(`${block.kind} needs at least one source`)
    if (block.kind === '--plan') {
      features.push(toSources(items))
    } else {
      const [planPath, ...sources] = items
      updates.push({ plan: { planPath }, ...toSources(sources) })
    }
  }
  if (!features.length && !updates.length) {
    throw new Error('feature-plan needs at least one source: a Jira key, Figma link, plan file or description')
  }
  return { ...(features.length ? { features } : {}), ...(updates.length ? { updates } : {}) }
}

function applyFlag(token, workflow, args) {
  const eq = token.indexOf('=')
  const name = token.slice(2, eq === -1 ? undefined : eq)
  const value = eq === -1 ? undefined : unquote(token.slice(eq + 1))
  const spec = WORKFLOWS[workflow]
  if (value === undefined && spec.switches.includes(name)) {
    Object.assign(args, SWITCH_ARGS[name])
  } else if (value !== undefined && spec.values.includes(name)) {
    const [key, convert] = VALUE_ARGS[name]
    args[key] = convert(value, `--${name}`)
  } else {
    throw new Error(`${token} is not a valid flag for ${workflow} (value flags are written --name=value)`)
  }
}

export function parseWorkflowArgs(workflow, tokens) {
  const args = {}
  const positional = []
  for (const token of tokens) {
    const isBlockMarker = workflow === 'feature-plan' && (token === '--plan' || token === '--update')
    if (token.startsWith('--') && !isBlockMarker) applyFlag(token, workflow, args)
    else positional.push(token)
  }
  if (workflow === 'feature-plan') return { args: { ...args, ...planSources(positional) }, items: [] }
  return { args, items: itemsFromTokens(positional) }
}

export function extractRunOptions(argv) {
  const options = { dryRun: false }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    const match = /^--(agent|model|cwd|timeout)(?:=(.*))?$/.exec(token)
    if (token === '--dry-run') {
      options.dryRun = true
    } else if (match) {
      const value = match[2] ?? argv[++i]
      if (!value) throw new Error(`--${match[1]} needs a value`)
      options[match[1]] = value
    } else {
      rest.push(token)
    }
  }
  if (options.timeout !== undefined) options.timeoutMs = positiveInt(options.timeout, '--timeout') * 60_000
  return { options, rest }
}

export function parseCli(argv) {
  const { options, rest } = extractRunOptions(argv)
  const [workflow, ...tokens] = rest
  if (!Object.hasOwn(WORKFLOWS, workflow ?? '')) {
    throw new Error(`first argument must be one of: ${Object.keys(WORKFLOWS).join(', ')}`)
  }
  if (!AGENTS.includes(options.agent)) throw new Error(`--agent must be one of: ${AGENTS.join(', ')}`)
  return { workflow, options, ...parseWorkflowArgs(workflow, tokens) }
}
