// What qa-kit owns in a repo and what git thinks of each file, so `init` can say exactly what to commit and
// which files the repo's ignore rules swallow (on purpose or by mistake). Read-only. The list is built from
// the manifest and the state folder, not from what a run happened to write, so nothing is forgotten:
// `.qa-kit/manifest.json`, hand-resolved files and an optional extra file (the CI workflow) are all included,
// on every run, also when nothing changed. `legacy` lists leftover 0.3.x copies under `.qa-kit/base/`: unused
// by this kit version, reported so they can be removed, never part of `toStage` or `ignored`.
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, posix, relative } from 'node:path'

const STATE_DIR = '.qa-kit'
const ARTIFACTS_IGNORE = 'qa-kit-artifacts/.gitignore' // ignores itself on purpose: never committed

const fwd = (p) => String(p).replaceAll('\\', '/')

function git(cwd, args, input) {
  try {
    return execFileSync('git', args, { cwd, input, encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'], maxBuffer: 1 << 26 })
  } catch (e) {
    return e.status === 1 ? '' : null // check-ignore exits 1 when nothing matches
  }
}

function parseIgnore(out) {
  const parts = (out ?? '').split('\0')
  const found = new Map()
  for (let i = 0; i + 3 < parts.length; i += 4) {
    found.set(parts[i + 3], { source: parts[i], line: Number(parts[i + 1]), pattern: parts[i + 2] })
  }
  return found
}

function owned(repo, kitRoot, agents) {
  const manifest = JSON.parse(readFileSync(join(kitRoot, 'templates', 'manifest.json'), 'utf8'))
  const statePath = join(repo, STATE_DIR, 'manifest.json')
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { agents: [] }
  const use = agents ?? (state.agents.length ? state.agents : ['claude', 'opencode'])
  const targets = manifest.files.filter((e) => e.agents.some((a) => use.includes(a))).map((e) => e.target).filter((t) => t !== ARTIFACTS_IGNORE)
  const list = targets.map((path) => ({ path, role: path.startsWith(`${STATE_DIR}/project/`) ? 'project' : 'config' }))
  list.push({ path: `${STATE_DIR}/manifest.json`, role: 'state' })
  return list
}

function legacyBase(repo) {
  const out = []
  const walk = (dir, prefix) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = lstatSync(p)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) walk(p, `${prefix}${name}/`)
      else out.push(`${prefix}${name}`)
    }
  }
  walk(join(repo, STATE_DIR, 'base'), `${STATE_DIR}/base/`)
  return out.sort()
}

// Where the matching rule lives decides whether the repo can fix it.
function sourceKind(source, gitRoot, repo) {
  const abs = [join(gitRoot, source), join(repo, source), source].find((p) => existsSync(p)) ?? source
  const a = fwd(abs)
  if (a.endsWith('/info/exclude')) return { kind: 'local-exclude', abs }
  if (basename(a) === '.gitignore' && !relative(gitRoot, abs).startsWith('..') && !isAbsolute(relative(gitRoot, abs))) return { kind: 'repo', abs }
  return { kind: 'global', abs }
}

function fixFor(rule, kind, abs, gitRoot, rootPath, viaDirectory) {
  if (kind !== 'repo') return null
  const base = dirname(abs)
  const rel = (p) => fwd(relative(base, join(gitRoot, p)))
  if (viaDirectory) {
    const dir = rel(viaDirectory)
    const file = rel(rootPath)
    const inside = posix.relative(dir, file)
    if (inside.includes('/')) {
      return `a folder rule (${rule.pattern}, ${fwd(relative(gitRoot, abs))} line ${rule.line}) hides it; git cannot re-include a file below an ignored folder, so narrow or remove that rule, or use git add -f`
    }
    return `in ${fwd(relative(gitRoot, abs))} replace "${rule.pattern}" (line ${rule.line}) with "/${dir}/*" and add "!/${file}" (a plain "!/${file}" does not work while the folder itself is ignored)`
  }
  return `in ${fwd(relative(gitRoot, abs))} add the line "!/${rel(rootPath)}" after "${rule.pattern}" (line ${rule.line})`
}

export function status({ repo, kitRoot, agents, extra = [] }) {
  const top = git(repo, ['rev-parse', '--show-toplevel'])
  const list = owned(repo, kitRoot, agents)
  for (const x of extra) {
    const abs = isAbsolute(x) ? x : join(repo, x)
    list.push({ path: fwd(relative(repo, abs)), role: 'extra' })
  }

  if (top === null) {
    const files = list.filter((f) => existsSync(join(repo, f.path))).map((f) => ({ ...f, state: 'not-a-repo' }))
    return { git: false, project: fwd(repo), files, toStage: [], ignored: [], missing: [], legacy: legacyBase(repo) }
  }

  const gitRoot = top.trim()
  const offset = (git(repo, ['rev-parse', '--show-prefix']) ?? '').trim()
  const present = list.filter((f) => existsSync(join(repo, f.path)))
  const missing = list.filter((f) => f.role === 'config' && !existsSync(join(repo, f.path))).map((f) => f.path)
  for (const f of present) f.rootPath = posix.normalize(posix.join(offset, fwd(f.path)))

  const paths = present.map((f) => f.path)
  const tracked = new Set((git(repo, ['ls-files', '-z', '--full-name', '--', ...paths]) ?? '').split('\0').filter(Boolean))
  const changes = new Map()
  const entries = (git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...paths]) ?? '').split('\0')
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.length < 4) continue
    changes.set(e.slice(3), e.slice(0, 2))
    if (e[0] === 'R' || e[0] === 'C') i++
  }

  const untracked = present.filter((f) => !tracked.has(f.rootPath) && !changes.has(f.rootPath))
  const rules = parseIgnore(untracked.length ? git(repo, ['check-ignore', '-z', '-v', '--stdin'], untracked.map((f) => f.path).join('\0')) : '')

  for (const f of present) {
    const xy = changes.get(f.rootPath)
    if (tracked.has(f.rootPath)) f.state = !xy ? 'clean' : xy[1] === ' ' ? 'staged' : 'modified'
    else if (xy === '??') f.state = 'untracked'
    else if (rules.has(f.path)) {
      const rule = rules.get(f.path)
      f.state = 'ignored'
      // The rule may belong to a parent folder: that decides what a rule edit can do.
      const segments = f.rootPath.split('/').slice(0, -1)
      let viaDirectory = null
      let ruleOfDirectory = rule
      for (let n = 1; n <= segments.length && !viaDirectory; n++) {
        const dir = segments.slice(0, n).join('/')
        const hit = parseIgnore(git(gitRoot, ['check-ignore', '-z', '-v', '--stdin'], dir)).get(dir)
        if (hit) { viaDirectory = dir; ruleOfDirectory = hit }
      }
      const { kind, abs } = sourceKind(ruleOfDirectory.source, gitRoot, repo)
      f.rule = { ...ruleOfDirectory, source: fwd(ruleOfDirectory.source), kind, viaDirectory }
      f.forceAdd = `git add -f -- ':/${f.rootPath}'`
      f.fix = fixFor(ruleOfDirectory, kind, abs, gitRoot, f.rootPath, viaDirectory)
      f.critical = f.path.startsWith(`${STATE_DIR}/`)
    } else f.state = 'unknown'
  }

  return {
    git: true,
    project: fwd(repo),
    gitRoot: fwd(gitRoot),
    offset: fwd(offset),
    files: present.map((f) => ({ path: fwd(f.path), rootPath: f.rootPath, role: f.role, state: f.state, rule: f.rule, forceAdd: f.forceAdd, fix: f.fix, critical: f.critical })),
    toStage: present.filter((f) => ['untracked', 'modified', 'staged'].includes(f.state)).map((f) => fwd(f.path)),
    ignored: present.filter((f) => f.state === 'ignored').map((f) => fwd(f.path)),
    missing,
    legacy: legacyBase(repo),
  }
}
