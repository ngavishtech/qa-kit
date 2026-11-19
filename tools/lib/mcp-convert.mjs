// templates/mcp.json (Claude .mcp.json shape) -> opencode.json, so the server list has one source.

const toOpenCodeEnv = (value) => value.replace(/\$\{([A-Z0-9_]+)\}/g, '{env:$1}')

function convertServer(server) {
  if (server.url) return { type: 'remote', url: toOpenCodeEnv(server.url) }
  const out = { type: 'local', command: [server.command, ...(server.args ?? [])] }
  if (server.env) {
    out.environment = Object.fromEntries(
      Object.entries(server.env).map(([k, v]) => [k, toOpenCodeEnv(v)]),
    )
  }
  return out
}

export function toOpenCodeConfig(claudeMcp) {
  const servers = Object.fromEntries(
    Object.entries(claudeMcp.mcpServers).map(([name, s]) => [name, convertServer(s)]),
  )
  return { $schema: 'https://opencode.ai/config.json', mcp: { servers } }
}
