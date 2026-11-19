// Installs qa-kit for OpenCode into the user-level config directory (default ~/.config/opencode).
// Files are rendered from the repo root at install time; .managed.json records what was written so
// update/uninstall touch only unmodified kit-owned files.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultConfigDir } from './lib/paths.mjs'
import { renderAgent, renderCommand, renderSkill, convertText, skillCommand } from './lib/render.mjs'

export const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SUPPORT_DIRS = ['patterns', 'docs', 'templates', 'workflows', 'runner']
const RENDERED_SUPPORT = new Set(['patterns', 'docs'])
// init needs the merge tool at runtime; the installer and renderer only run from a kit checkout.
const BUNDLED_TOOLS = ['merge.mjs', 'mcp-user.mjs', 'lib/json3.mjs', 'lib/text3.mjs', 'lib/mcp-convert.mjs', 'lib/paths.mjs', 'lib/locate.mjs', 'lib/status.mjs', 'lib/render-helper.mjs']
const MANAGED = 'qa-kit/.managed.json'

const sha = (s) => createHash('sha256').update(s).digest('hex')
const posix = (p) => p.split('\\').join('/')

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const full = join(dir, n)
      return statSync(full).isDirectory() ? walk(full) : [full]
    })
}

export function pluginVersion(sourceRoot = SOURCE_ROOT) {
  return JSON.parse(readFileSync(join(sourceRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version
}

// Returns Map<path relative to configDir, file content>.
export function buildBundle(sourceRoot, configDir) {
  const ctx = { configDir, rootDir: join(configDir, 'qa-kit') }
  const out = new Map()
  const read = (p) => readFileSync(p, 'utf8').replaceAll('\r\n', '\n')

  for (const file of walk(join(sourceRoot, 'skills'))) {
    const rel = posix(relative(join(sourceRoot, 'skills'), file))
    const [name, ...rest] = rel.split('/')
    const text = read(file)
    if (rest.join('/') === 'SKILL.md') {
      out.set(`skills/qa-kit-${name}/SKILL.md`, renderSkill(text, name, ctx))
      out.set(`commands/qa-kit-${name}.md`, skillCommand(text, name, ctx))
    } else {
      out.set(`skills/qa-kit-${rel}`, text)
    }
  }
  for (const file of walk(join(sourceRoot, 'agents'))) {
    out.set(`agents/qa-kit-${basename(file)}`, renderAgent(read(file), ctx))
  }
  for (const file of walk(join(sourceRoot, 'opencode', 'commands'))) {
    out.set(`commands/qa-kit-${basename(file)}`, renderCommand(read(file), ctx))
  }
  for (const dir of SUPPORT_DIRS) {
    for (const file of walk(join(sourceRoot, dir))) {
      const text = read(file)
      const rendered = RENDERED_SUPPORT.has(dir) && file.endsWith('.md') ? convertText(text, ctx) : text
      out.set(`qa-kit/${dir}/${posix(relative(join(sourceRoot, dir), file))}`, rendered)
    }
  }
  // Mirror the plugin-root layout so tools/ and runner/ find their siblings the same way in both installs.
  out.set('qa-kit/.claude-plugin/plugin.json', read(join(sourceRoot, '.claude-plugin', 'plugin.json')))
  for (const rel of BUNDLED_TOOLS) {
    out.set(`qa-kit/tools/${rel}`, read(join(sourceRoot, 'tools', rel)))
  }
  return out
}

function loadManaged(configDir) {
  const p = join(configDir, MANAGED)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { version: null, files: {} }
}

function pruneEmptyDirs(configDir, file) {
  let dir = dirname(file)
  while (dir !== configDir && dir.startsWith(configDir) && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir)
    dir = dirname(dir)
  }
}

// A file may be replaced or removed only if it is still exactly what the kit wrote.
function isUntouched(path, recordedHash) {
  return recordedHash !== undefined && existsSync(path) && sha(readFileSync(path, 'utf8')) === recordedHash
}

export function install({ sourceRoot = SOURCE_ROOT, configDir = defaultConfigDir(), dryRun = false, force = false } = {}) {
  const bundle = buildBundle(sourceRoot, configDir)
  const previous = loadManaged(configDir)
  const result = { version: pluginVersion(sourceRoot), configDir, written: [], unchanged: [], skipped: [], removed: [] }
  const files = {}

  for (const [rel, content] of bundle) {
    const abs = join(configDir, rel)
    const hash = sha(content)
    files[rel] = hash
    if (existsSync(abs)) {
      if (sha(readFileSync(abs, 'utf8')) === hash) { result.unchanged.push(rel); continue }
      if (!force && !isUntouched(abs, previous.files[rel])) {
        files[rel] = previous.files[rel]
        if (files[rel] === undefined) delete files[rel]
        result.skipped.push(rel)
        continue
      }
    }
    result.written.push(rel)
    if (!dryRun) {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content)
    }
  }

  for (const [rel, hash] of Object.entries(previous.files)) {
    if (bundle.has(rel)) continue
    const abs = join(configDir, rel)
    if (!existsSync(abs)) continue
    if (force || isUntouched(abs, hash)) {
      result.removed.push(rel)
      if (!dryRun) { rmSync(abs); pruneEmptyDirs(configDir, abs) }
    } else {
      files[rel] = hash
      result.skipped.push(rel)
    }
  }

  if (!dryRun) {
    mkdirSync(join(configDir, 'qa-kit'), { recursive: true })
    writeFileSync(join(configDir, MANAGED), JSON.stringify({ version: result.version, files }, null, 2) + '\n')
  }
  return result
}

export function uninstall({ configDir = defaultConfigDir(), dryRun = false, force = false } = {}) {
  const previous = loadManaged(configDir)
  const result = { configDir, removed: [], skipped: [] }
  for (const [rel, hash] of Object.entries(previous.files)) {
    const abs = join(configDir, rel)
    if (!existsSync(abs)) continue
    if (force || isUntouched(abs, hash)) {
      result.removed.push(rel)
      if (!dryRun) { rmSync(abs); pruneEmptyDirs(configDir, abs) }
    } else result.skipped.push(rel)
  }
  if (!dryRun && !result.skipped.length) {
    rmSync(join(configDir, MANAGED), { force: true })
    pruneEmptyDirs(configDir, join(configDir, MANAGED))
  }
  return result
}

export function installedVersion(configDir = defaultConfigDir()) {
  return loadManaged(configDir).version
}
