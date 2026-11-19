// Works out where `init` installs: the git root, the project folder (the repo root, or the folder given
// with --path), and whether qa-kit is already installed somewhere in the repo. Pure decisions live here so
// they are tested; the init skill only reads the result.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const MANIFEST = join('.qa-kit', 'manifest.json')
const SKIP_DIRS = new Set(['node_modules', '.git', 'qa-kit-artifacts', 'dist', 'build', 'playwright-report', 'allure-results', 'test-results'])
const MAX_DEPTH = 6

const posix = (p) => p.split(sep).join('/')
// Every path in the JSON uses forward slashes: Node accepts them on Windows, and an unquoted backslash path is
// mangled by Git Bash when the skill passes it on as --repo.
const fwd = (p) => (p == null ? p : String(p).replaceAll('\\', '/'))

// realpath of the nearest existing ancestor + the not-yet-existing rest, so a folder that init may create
// still gets the canonical spelling (case and 8.3 short names on Windows, symlinks).
function canonical(p) {
  const rest = []
  let cur = resolve(p)
  while (!existsSync(cur)) {
    rest.unshift(basename(cur))
    const up = dirname(cur)
    if (up === cur) break
    cur = up
  }
  return join(realpathSync.native(cur), ...rest)
}

function gitRootOf(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return out ? canonical(out) : null
  } catch {
    return null
  }
}

const inside = (root, p) => {
  const rel = relative(root, p)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

// Git Bash on Windows rewrites an argument that starts with "/" into a path under its own install folder, so
// `--path=/automation` reaches us as "C:/Program Files/Git/automation". Nobody means that (an absolute path is
// refused anyway), so strip the install folder and say what happened instead of failing.
function undoGitBashRewrite(raw) {
  const text = String(raw ?? '').trim()
  const slash = text.replaceAll('\\', '/')
  const roots = [process.env.EXEPATH, 'C:/Program Files/Git', 'C:/Program Files (x86)/Git'].filter(Boolean).map((r) => r.replaceAll('\\', '/').replace(/\/+$/, ''))
  for (const root of roots) {
    if (slash.toLowerCase().startsWith(root.toLowerCase() + '/')) {
      const rest = slash.slice(root.length)
      return { text: rest, note: `"${text}" is what Git Bash makes of "${rest}"; using ".${rest}" relative to the folder you run from` }
    }
  }
  return { text }
}

// Turns what the user typed after --path into a folder under `base`. A leading "/" or "\" means "relative to
// where I run it" (so /myfolder/test works the same on every shell); a drive letter or "~" is refused.
export function resolvePath(base, raw) {
  const { text } = undoGitBashRewrite(raw)
  if (!text) throw new Error('--path needs a folder, for example --path=automation')
  if (/^[a-zA-Z]:/.test(text) || text.startsWith('~')) {
    throw new Error(`--path is relative to the folder you run from; "${text}" looks like an absolute path`)
  }
  const parts = text.replaceAll('\\', '/').split('/').filter((s) => s && s !== '.')
  if (parts.includes('.git')) throw new Error('--path cannot point inside .git')
  return canonical(join(base, ...parts))
}

function hasInstall(dir) {
  return existsSync(join(dir, MANIFEST))
}

// Folders under `root` (not above it) that already hold a qa-kit install.
function installsBelow(root) {
  const found = []
  const walk = (dir, depth) => {
    if (depth > 0 && existsSync(join(dir, '.git'))) return // a nested repository or submodule is not part of this repo
    if (hasInstall(dir)) found.push(dir)
    if (depth >= MAX_DEPTH) return
    let names
    try { names = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const d of names) {
      if (d.isDirectory() && !d.isSymbolicLink() && !SKIP_DIRS.has(d.name)) walk(join(dir, d.name), depth + 1)
    }
  }
  walk(root, 0)
  return found
}

// Installs at `from` or in any folder above it up to `root`.
function installsAbove(from, root) {
  const found = []
  for (let dir = from; inside(root, dir); dir = dirname(dir)) {
    if (hasInstall(dir)) found.push(dir)
    if (dir === root || dirname(dir) === dir) break
  }
  return found
}

// reason:
//   path-flag              --path given
//   existing-install       no --path; an install is at or above the folder you are in
//   repo-root              no --path; you are at the git root (or not in a repo) and nothing is installed yet
// needsDecision (the skill must ask, or stop, before writing anything):
//   install-elsewhere      no --path; qa-kit is installed in another folder of this repo
//   ask-location           no --path; you are in a subfolder and nothing is installed: here or the repo root?
export function locate({ cwd = process.cwd(), path: rawPath } = {}) {
  const here = canonical(cwd)
  const gitRoot = gitRootOf(here)
  const boundary = gitRoot ?? here
  const rel = (p) => posix(relative(boundary, p)) || '.'
  const out = { cwd: here, gitRoot, boundary, warnings: [] }

  let projectDir
  if (rawPath !== undefined && rawPath !== null) {
    projectDir = resolvePath(here, rawPath)
    if (!inside(boundary, projectDir)) {
      throw new Error(`--path "${rawPath}" resolves outside ${gitRoot ? 'the git repository' : 'the current folder'} (${boundary})`)
    }
    if (existsSync(projectDir) && !statSync(projectDir).isDirectory()) throw new Error(`--path "${rawPath}" is a file, not a folder`)
    if (gitRoot) {
      let near = projectDir
      while (!existsSync(near) && dirname(near) !== near) near = dirname(near)
      const there = gitRootOf(near)
      if (there && there !== gitRoot) throw new Error(`--path "${rawPath}" is inside another git repository (${fwd(there)}); run init from that repository instead`)
    }
    out.reason = 'path-flag'
    const rewritten = undoGitBashRewrite(rawPath).note
    if (rewritten) out.warnings.push(rewritten)
    const other = [...installsBelow(boundary), ...installsAbove(dirname(projectDir), boundary)]
      .filter((d, i, a) => a.indexOf(d) === i && d !== projectDir)
    for (const d of other) {
      if (inside(d, projectDir)) out.warnings.push(`qa-kit is already installed in ${rel(d)}, which contains ${rel(projectDir)}; the new install would be nested inside it`)
      else out.warnings.push(`qa-kit is also installed in ${rel(d)}`)
    }
  } else {
    const above = installsAbove(here, boundary)
    const below = installsBelow(boundary)
    if (above.length) {
      projectDir = above[0]
      out.reason = 'existing-install'
    } else if (below.length) {
      projectDir = boundary
      out.reason = 'install-elsewhere'
      out.needsDecision = 'install-elsewhere'
      out.installs = below.map(rel)
    } else if (here !== boundary) {
      projectDir = boundary
      out.reason = 'ask-location'
      out.needsDecision = 'ask-location'
      const folders = []
      for (let d = here; d !== boundary && inside(boundary, d); d = dirname(d)) folders.push(rel(d))
      out.options = { here: rel(here), root: '.', folders }
    } else {
      projectDir = boundary
      out.reason = 'repo-root'
    }
  }

  out.cwd = fwd(out.cwd)
  out.gitRoot = fwd(out.gitRoot)
  out.boundary = fwd(out.boundary)
  out.projectDir = fwd(projectDir)
  out.exists = existsSync(projectDir)
  out.installed = hasInstall(projectDir)
  out.offset = posix(relative(boundary, projectDir))
  return out
}
