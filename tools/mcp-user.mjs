// Registers qa-kit's MCP servers at user level so skills work outside any repo (for example a plan-only run).
// The server list is templates/mcp.json, the same one `init` writes into repos. Existing entries are never changed.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toOpenCodeConfig } from './lib/mcp-convert.mjs'
import { defaultConfigDir } from './lib/paths.mjs'

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function loadServers(only, kitRoot = KIT_ROOT) {
  const all = JSON.parse(readFileSync(join(kitRoot, 'templates', 'mcp.json'), 'utf8')).mcpServers
  const names = only ?? Object.keys(all)
  const unknown = names.filter((n) => !(n in all))
  if (unknown.length) throw new Error(`unknown server(s): ${unknown.join(', ')} (available: ${Object.keys(all).join(', ')})`)
  return Object.fromEntries(names.map((n) => [n, all[n]]))
}

// Variable names a server reads from the environment, e.g. ${FIGMA_API_KEY} -> FIGMA_API_KEY.
export const envNames = (server) =>
  [...Object.values(server.env ?? {}), server.url ?? ''].flatMap((v) => [...v.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]))

function run(args) {
  return spawnSync('claude', args, { encoding: 'utf8' })
}

// Claude Code on native Windows cannot start .cmd shims such as npx directly. User scope is per machine, so wrapping
// here does not leak into repos shared with other operating systems.
export function forPlatform(server, platform = process.platform) {
  if (platform !== 'win32' || server.command !== 'npx') return server
  return { ...server, command: 'cmd', args: ['/c', 'npx', ...(server.args ?? [])] }
}

const manualCommand = (name, server) => `claude mcp add-json --scope user ${name} '${JSON.stringify(server)}'`

// `claude mcp add-json --scope user` keeps the ${VAR} placeholders, so no secret is stored.
export function setupClaude({ servers, dryRun = false, exec = run, platform = process.platform }) {
  const wanted = Object.fromEntries(Object.entries(servers).map(([n, s]) => [n, forPlatform(s, platform)]))
  const result = { added: [], kept: [], failed: [] }
  const probe = exec(['--version'])
  if (probe.status !== 0) {
    result.unavailable = probe.error?.code === 'EINVAL'
      ? 'claude resolves to an npm .cmd shim that cannot be started safely from here; install the native claude.exe and put it first on PATH'
      : 'the claude CLI was not found on PATH'
    for (const [name, server] of Object.entries(wanted)) result.failed.push({ name, command: manualCommand(name, server) })
    return result
  }
  for (const [name, server] of Object.entries(wanted)) {
    if (exec(['mcp', 'get', name]).status === 0) { result.kept.push(name); continue }
    const add = ['mcp', 'add-json', '--scope', 'user', name, JSON.stringify(server)]
    if (dryRun || exec(add).status === 0) result.added.push(name)
    else result.failed.push({ name, command: manualCommand(name, server) })
  }
  return result
}

export function setupOpenCode({ servers, configDir, dryRun = false }) {
  const file = join(configDir, 'opencode.json')
  if (existsSync(join(configDir, 'opencode.jsonc'))) {
    throw new Error(`${join(configDir, 'opencode.jsonc')} exists and may contain comments; add the servers by hand (see docs/MCP-SETUP-GUIDE.md)`)
  }
  let config = { $schema: 'https://opencode.ai/config.json' }
  if (existsSync(file)) {
    try { config = JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
      throw new Error(`${file} is not plain JSON (${e.message}); add the servers by hand (see docs/MCP-SETUP-GUIDE.md)`)
    }
  }
  const existing = config.mcp
  if (existing && typeof existing === 'object' && !('servers' in existing) && Object.keys(existing).length) {
    throw new Error(`${file} lists MCP servers directly under "mcp" (the V1 schema); this kit writes the V2 shape "mcp.servers" - add the servers by hand`)
  }
  const wanted = toOpenCodeConfig({ mcpServers: servers }).mcp.servers
  const current = existing?.servers ?? {}
  const result = { added: [], kept: [], failed: [], file }
  for (const [name, server] of Object.entries(wanted)) {
    if (name in current) result.kept.push(name)
    else { current[name] = server; result.added.push(name) }
  }
  if (result.added.length && !dryRun) {
    config.mcp = { ...existing, servers: current }
    mkdirSync(configDir, { recursive: true })
    writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
  }
  return result
}

const USAGE = `usage: mcp-user.mjs --agent claude|opencode [--servers a,b] [--dir <opencode config dir>] [--dry-run]

  Registers qa-kit's MCP servers (atlassian, glean_default, figma, testrail, playwright) at user level,
  so skills work outside any repo. Servers that already exist are left untouched.`

export function parseArgs(argv) {
  const o = { dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--agent') o.agent = argv[++i]
    else if (a === '--servers') o.servers = argv[++i].split(',')
    else if (a === '--dir') o.dir = argv[++i]
    else if (a === '--dry-run') o.dryRun = true
    else throw new Error(`unknown argument: ${a}
${USAGE}`)
  }
  if (o.agent !== 'claude' && o.agent !== 'opencode') throw new Error(USAGE)
  return o
}

export function main(argv, { exec } = {}) {
  const o = parseArgs(argv)
  const servers = loadServers(o.servers)
  const r = o.agent === 'claude'
    ? setupClaude({ servers, dryRun: o.dryRun, exec })
    : setupOpenCode({ servers, configDir: o.dir ?? defaultConfigDir(), dryRun: o.dryRun })
  const verb = o.dryRun ? 'would add' : 'added'
  if (r.unavailable) console.log(`${r.unavailable}.\nRun these yourself (bash/zsh quoting; in PowerShell put the JSON in a here-string):`)
  if (r.added.length) console.log(`${verb}: ${r.added.join(', ')}`)
  if (r.kept.length) console.log(`already configured (left as is): ${r.kept.join(', ')}`)
  for (const f of r.failed) console.log(r.unavailable ? `  ${f.command}` : `failed: ${f.name} - run it yourself:\n  ${f.command}`)
  if (r.file && r.added.length) console.log(`config file: ${r.file}`)
  const needed = [...new Set([...r.added, ...r.kept].flatMap((n) => envNames(servers[n])))]
  if (needed.length) console.log(`Export before use (values are never stored): ${needed.join(', ')}`)
  const oauth = [...r.added, ...r.kept].filter((n) => servers[n].url)
  if (oauth.length) console.log(`Sign in on first use (OAuth): ${oauth.join(', ')}`)
  if (r.failed.length) process.exitCode = 1
  return r
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)) } catch (e) { console.error(e.message); process.exit(1) }
}
