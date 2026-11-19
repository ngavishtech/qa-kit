// Renders the plugin's Claude-flavoured sources into the OpenCode flavour at install time.
// Nothing here is committed output: the repo root stays the single source of truth.

const PLUGIN_ROOT = '${CLAUDE_PLUGIN_ROOT}'
const PREFIX = 'qa-kit-'

export function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) throw new Error('missing frontmatter')
  const fields = new Map()
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s?(.*)$/.exec(line)
    if (kv) fields.set(kv[1], kv[2])
  }
  return { fields, body: m[2] }
}

function joinFrontmatter(entries, body) {
  const head = entries.map(([k, v]) => `${k}: ${v}`).join('\n')
  return `---\n${head}\n---\n${body}`
}

// ctx: { rootDir: where patterns/ templates/ docs/ workflows/ runner/ tools/ live, configDir: OpenCode config dir }
export function convertText(text, ctx) {
  const root = ctx.rootDir.replaceAll('\\', '/')
  const cfg = ctx.configDir.replaceAll('\\', '/')
  return text
    .replaceAll(`${PLUGIN_ROOT}/skills/`, `${cfg}/skills/${PREFIX}`)
    .replaceAll(`${PLUGIN_ROOT}/commands/`, `${cfg}/commands/${PREFIX}`)
    .replaceAll(`${PLUGIN_ROOT}/agents/`, `${cfg}/agents/${PREFIX}`)
    .replaceAll(PLUGIN_ROOT, root)
    .replaceAll('qa-kit:', PREFIX)
    .replace(/mcp__(<[^>]+>)__/g, '$1_')
    .replace(/mcp__([a-z0-9]+(?:_[a-z0-9]+)*?)__/g, '$1_')
}

export function renderSkill(text, name, ctx) {
  const { fields, body } = splitFrontmatter(text)
  const entries = [['name', PREFIX + name], ['description', fields.get('description')]]
  if (fields.has('disable-model-invocation')) {
    entries.push(['disable-model-invocation', fields.get('disable-model-invocation')])
  }
  return convertText(joinFrontmatter(entries, body), ctx)
}

// OpenCode agents carry no tool allow-list here: the Claude `tools:` grant has no equivalent
// that OpenCode documents, so the agent inherits the session's permissions.
export function renderAgent(text, ctx) {
  const { fields, body } = splitFrontmatter(text)
  const entries = [['description', fields.get('description')], ['mode', 'subagent']]
  return convertText(joinFrontmatter(entries, body), ctx)
}

// Every skill is also a slash command in Claude (/qa-kit:<name>); OpenCode exposes
// skills to the model only, so each gets a thin command wrapper to keep that surface.
export function skillCommand(text, name, ctx) {
  const { fields } = splitFrontmatter(text)
  const body = `Use the \`${PREFIX}${name}\` skill and follow it exactly.\n\nArguments: $ARGUMENTS\n`
  return convertText(joinFrontmatter([['description', fields.get('description')]], body), ctx)
}

export function renderCommand(text, ctx) {
  return convertText(text.replaceAll('@QA_KIT_ROOT@', PLUGIN_ROOT), ctx)
}
