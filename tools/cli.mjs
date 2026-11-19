#!/usr/bin/env node
// qa-kit install | uninstall | status  - manages the OpenCode user-level install (Claude Code uses /plugin).
import { install, installedVersion, pluginVersion, uninstall } from './install.mjs'
import { defaultConfigDir } from './lib/paths.mjs'
import { main as mcpMain } from './mcp-user.mjs'

const USAGE = `usage: qa-kit <install|uninstall|status|mcp> [--dir <opencode config dir>] [--dry-run] [--force]

  install     copy skills, agents, commands and support files into the OpenCode config dir
              (default ${defaultConfigDir()}); run again after pulling a new kit version to update
  uninstall   remove what install wrote (files you edited are kept unless --force)
  status      show the installed and the available kit version
  mcp         register the MCP servers at user level for use outside a repo
              (qa-kit mcp --agent claude|opencode [--servers a,b] [--dry-run])`

function parse(argv) {
  const o = { cmd: argv[0], dryRun: false, force: false }
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--dir') o.configDir = argv[++i]
    else if (argv[i] === '--dry-run') o.dryRun = true
    else if (argv[i] === '--force') o.force = true
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  return o
}

function list(title, items) {
  if (items.length) console.log(`${title} (${items.length}):\n  ${items.join('\n  ')}`)
}

function main() {
  if (process.argv[2] === 'mcp') { mcpMain(process.argv.slice(3)); return }
  const { cmd, ...opts } = parse(process.argv.slice(2))
  if (cmd === 'install') {
    const r = install(opts)
    console.log(`${opts.dryRun ? 'Would install' : 'Installed'} qa-kit ${r.version} into ${r.configDir}`)
    console.log(`${r.written.length} written, ${r.unchanged.length} unchanged, ${r.removed.length} removed, ${r.skipped.length} skipped`)
    list('Skipped (edited locally or not ours; use --force to replace)', r.skipped)
  } else if (cmd === 'uninstall') {
    const r = uninstall(opts)
    console.log(`${opts.dryRun ? 'Would remove' : 'Removed'} ${r.removed.length} file(s) from ${r.configDir}`)
    list('Kept (edited locally; use --force to remove)', r.skipped)
  } else if (cmd === 'status') {
    const dir = opts.configDir ?? defaultConfigDir()
    console.log(`installed in ${dir}: ${installedVersion(dir) ?? 'not installed'}`)
    console.log(`this checkout: ${pluginVersion()}`)
  } else {
    console.error(USAGE)
    process.exitCode = cmd ? 1 : 0
  }
}

try { main() } catch (e) { console.error(e.message); process.exit(1) }
