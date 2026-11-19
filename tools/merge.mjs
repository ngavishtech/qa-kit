#!/usr/bin/env node
// Writes and updates the per-repo layer that `init` manages. Updates are a reviewed three-way merge:
//   base   = what the kit wrote last time, rebuilt from the kit tag that wrote it (see resolveBase)
//   theirs = what the installed kit renders now
//   ours   = the file in the repo
//
//   node merge.mjs plan   --repo . [--agents claude,opencode] [--var KEY=VAL ...] [--base-renderer current|tag]   read-only, prints the plan
//   node merge.mjs apply  --repo . --accept all|<target>,<target> [--base-renderer current|tag]                    writes accepted files
//   node merge.mjs record --repo . --paths <target>,<target>                         marks hand-resolved files as merged
//   node merge.mjs status --repo . [--extra <file>,<file>]                            every file qa-kit owns here and what git thinks of it (to commit / ignored)
//   node merge.mjs locate [--cwd .] [--path <folder>]                                 where init installs (git root, project folder, existing installs)
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deepEqual, merge3 } from './lib/json3.mjs'
import { toOpenCodeConfig } from './lib/mcp-convert.mjs'
import { locate } from './lib/locate.mjs'
import { status } from './lib/status.mjs'
import { merge3Text, normalizeEol, unifiedDiff } from './lib/text3.mjs'

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_DIR = '.qa-kit'
const STATE_FILE = `${STATE_DIR}/manifest.json`
const MERGE_DIR = 'qa-kit-artifacts/merge'
const CONFLICT_MARKER = /^<{7} /m

const sha = (s) => createHash('sha256').update(s).digest('hex')
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)
const readIf = (p) => (existsSync(p) ? normalizeEol(stripBom(readFileSync(p, 'utf8'))) : null)
const usesCrlf = (p) => existsSync(p) && readFileSync(p, 'utf8').includes('\r\n')
const writeFile = (p, text) => {
  const eol = usesCrlf(p) ? '\r\n' : '\n'
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, eol === '\n' ? text : text.replaceAll('\n', eol))
}
const json = (v) => JSON.stringify(v, null, 2) + '\n'

export function kitVersion(kitRoot = KIT_ROOT) {
  return JSON.parse(readFileSync(join(kitRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version
}

function loadState(repo) {
  const text = readIf(join(repo, STATE_FILE))
  return text ? JSON.parse(text) : { kitVersion: null, agents: [], vars: {}, files: {} }
}

function renderTemplate(entry, manifest, vars, kitRoot) {
  let text = readFileSync(join(kitRoot, 'templates', entry.source), 'utf8')
  for (const name of manifest.vars) {
    if (!text.includes(`<${name}>`)) continue
    if (vars[name] === undefined || vars[name] === '') throw new Error(`missing value for <${name}> (pass --var ${name}=...)`)
    text = text.replaceAll(`<${name}>`, vars[name])
  }
  if (entry.transform === 'opencode-mcp') text = json(toOpenCodeConfig(JSON.parse(text)))
  return normalizeEol(text)
}

// Stable contract (layer 2 of resolveBase runs this export from an OLD kit tag, so keep the signature):
// renders every template of `kitRoot` for `agents` and returns { [target]: text }. Pure: reads only the kit.
export function renderAll({ kitRoot = KIT_ROOT, agents, vars }) {
  const manifest = JSON.parse(readFileSync(join(kitRoot, 'templates', 'manifest.json'), 'utf8'))
  const out = {}
  for (const entry of manifest.files) {
    if (!entry.agents.some((a) => agents.includes(a))) continue
    out[entry.target] = renderTemplate(entry, manifest, vars, kitRoot)
  }
  return out
}

function mergeLines(ours, theirs) {
  const have = new Set(ours.split('\n').map((l) => l.trim()))
  const missing = theirs.split('\n').filter((l) => l.trim() && !have.has(l.trim()))
  return missing.length ? ours.replace(/\n*$/, '\n') + missing.join('\n') + '\n' : ours
}

function mergeJson(base, ours, theirs) {
  const { value, conflicts, details } = merge3(base === null ? undefined : JSON.parse(base), JSON.parse(ours), JSON.parse(theirs))
  if (conflicts.length) {
    const review = { merged: value, conflicts: details.map((d) => ({ path: d.path, repo: d.ours, kit: d.theirs })) }
    return { status: 'conflict', result: json(review), conflicts, details }
  }
  if (deepEqual(value, JSON.parse(ours))) return { status: 'unchanged', result: ours }
  // Without a base, a conflict-free key-wise merge is still safe to offer: it only adds what is missing.
  return { status: 'merge', result: json(value) }
}

// status: create | move | fast-forward | merge -> `result` can be written as is
//         unchanged | kept                     -> nothing to write
//         unknown-base | conflict | error      -> needs a human; `result` is a review copy
function mergeEntry(entry, { base, ours, theirs, legacy }) {
  if (ours === null) return legacy === null ? { status: 'create', result: theirs } : { status: 'move', result: legacy, from: entry.legacy }
  if (entry.update === 'once') return { status: 'kept', result: ours }
  if (entry.kind === 'lines') {
    const result = mergeLines(ours, theirs)
    return { status: result === ours ? 'unchanged' : 'merge', result }
  }
  if (ours === theirs || (base !== null && theirs === base)) return { status: 'unchanged', result: ours }
  if (base !== null && ours === base) return { status: 'fast-forward', result: theirs }

  if (entry.kind === 'json') {
    try { return mergeJson(base, ours, theirs) } catch (e) { return { status: 'error', result: ours, error: e.message } }
  }
  if (base === null) return { status: 'unknown-base', result: theirs }
  const { text, conflicts } = merge3Text(base, ours, theirs)
  return conflicts
    ? { status: 'conflict', result: text, conflicts: [`${conflicts} conflicting hunk(s)`] }
    : { status: 'merge', result: text }
}

const WRITES = new Set(['create', 'move', 'fast-forward', 'merge'])
const SETTLED = new Set(['unchanged', 'kept'])

const LEGACY_BASE_TARGET = `${STATE_DIR}/base/` // the pseudo plan entry that removes the 0.3.x copies
const RENDER_HELPER = fileURLToPath(new URL('./lib/render-helper.mjs', import.meta.url))

// Manifest records: v2 is { sha, tag }, v1 (0.3.x) was just the sha string. `legacy` (optional) is the sha of
// the old .qa-kit/base copy, kept only until that folder is removed so a hand-edited copy is never deleted.
const recordOf = (v) => (v == null ? null : typeof v === 'string' ? { sha: v, tag: null } : v)
const oneLine = (e) => String(e?.stderr?.toString().trim() || e?.message || e).split('\n')[0].slice(0, 200)

// Seconds to wait for one shallow clone before treating the fetch as failed (offline, blocked, slow credential prompt).
const fetchTimeoutMs = () => (Number(process.env.QA_KIT_FETCH_TIMEOUT) > 0 ? Number(process.env.QA_KIT_FETCH_TIMEOUT) : 20) * 1000
const FAILURE_TTL_MS = 5 * 60 * 1000

// KIT_GIT_URL comes from the repo's manifest, so it is not trusted: no option-looking values, no transport helpers
// (ext::, fd::, ...), and the helpers that run commands stay off even if the user's git config would allow them.
function assertCloneUrl(url) {
  if (typeof url !== 'string' || url === '' || url.startsWith('-') || /^[a-z0-9+.-]+::/i.test(url)) throw new Error(`unusable kit URL: ${url}`)
}

function cloneTag(url, tag, dest) {
  if (!/^\w[\w.+-]*$/.test(tag)) throw new Error(`unusable tag name: ${tag}`)
  assertCloneUrl(url)
  execFileSync('git', ['-c', 'protocol.ext.allow=never', '-c', 'protocol.fd.allow=never', 'clone', '--quiet', '--depth', '1', '--branch', tag, '--', url, dest], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: fetchTimeoutMs(),
  })
  return dest
}

// A failed fetch is remembered for a few minutes (per URL and tag, in the OS temp folder) so the plan/apply/record
// calls of one init run do not each wait for the timeout again. It can only turn a fetch into a fallback.
const failureMarker = (url, tag) => join(tmpdir(), 'qa-kit-fetch-failures', sha(`${url}\n${tag}`).slice(0, 24))
function recentFailure(url, tag) {
  try {
    const m = JSON.parse(readFileSync(failureMarker(url, tag), 'utf8'))
    return Date.now() - m.at < FAILURE_TTL_MS ? m : null
  } catch { return null }
}
function rememberFailure(url, tag, reason, missing) {
  try {
    mkdirSync(dirname(failureMarker(url, tag)), { recursive: true })
    writeFileSync(failureMarker(url, tag), JSON.stringify({ at: Date.now(), reason, missing }))
  } catch { /* the marker is only an optimisation */ }
}
const forgetFailure = (url, tag) => { try { rmSync(failureMarker(url, tag), { force: true }) } catch { /* ignore */ } }
const tagNotFound = (e) => /Remote branch .* not found|not found in upstream/i.test(String(e?.stderr ?? e?.message ?? ''))

// Shallow clones of the kit tags and (layer 2) renders from them, cached for one plan; the temp folder lives
// outside the repo and is removed by close().
function baseSession({ fetchTag, renderTimeoutMs = 60000 }) {
  let work = null
  const workDir = () => (work ??= mkdtempSync(join(tmpdir(), 'qa-kit-base-')))
  const clones = new Map()
  const renders = new Map()
  return {
    clone(url, tag) {
      const key = `${url}\n${tag}`
      if (clones.has(key)) return clones.get(key)
      let result
      const recent = fetchTag ? null : (recentFailure(url, tag) ?? recentFailure(url, '*'))
      if (recent) {
        result = { error: `fetch failed recently (${recent.reason})`, missing: Boolean(recent.missing) }
      } else {
        try {
          const root = fetchTag ? fetchTag(url, tag) : cloneTag(url, tag, join(workDir(), `clone-${clones.size}`))
          if (!fetchTag) { forgetFailure(url, tag); forgetFailure(url, '*') }
          result = { root }
        } catch (e) {
          const missing = tagNotFound(e)
          result = { error: oneLine(e), missing }
          if (!fetchTag) {
            rememberFailure(url, tag, result.error, missing)
            // Not "the tag is absent" but "git could not reach the repository": the next tag will fail the same way.
            if (!missing && (e.status != null || e.signal != null || e.code === 'ETIMEDOUT')) rememberFailure(url, '*', result.error, false)
          }
        }
      }
      clones.set(key, result)
      return result
    },
    // Runs the renderer shipped in the clone, in a separate process, against an empty folder. Only called after the user agreed.
    tagRender(root, agents, vars) {
      const key = `${root}\n${JSON.stringify(vars)}`
      if (renders.has(key)) return renders.get(key)
      let r
      try {
        const dir = mkdtempSync(join(workDir(), 'render-'))
        const varsFile = join(dir, 'vars.json')
        const empty = join(dir, 'empty')
        writeFileSync(varsFile, JSON.stringify(vars))
        mkdirSync(empty)
        const res = spawnSync(process.execPath, [RENDER_HELPER, root, varsFile, agents.join(','), empty], { cwd: empty, encoding: 'utf8', timeout: renderTimeoutMs, maxBuffer: 1 << 26 })
        if (res.error?.code === 'ETIMEDOUT') throw new Error(`timed out after ${Math.round(renderTimeoutMs / 1000)}s`)
        if (res.error) throw res.error
        if (res.status !== 0) throw new Error((res.stderr || '').trim().split('\n')[0] || `exit code ${res.status}`)
        r = { map: JSON.parse(res.stdout) }
      } catch (e) {
        r = { error: oneLine(e) }
      }
      renders.set(key, r)
      return r
    },
    close() {
      if (work) rmSync(work, { recursive: true, force: true })
    },
  }
}

// One-time migration from 0.3.x, which kept a copy of every file under .qa-kit/base/. Trusted only for a v1
// record and only if the copy still hashes to the recorded sha. Remove this function, the `remove` plan
// entry and removeLegacyBase() once nobody is on 0.3.x any more.
function migrateLegacyBase(repo, target, rec) {
  if (rec.tag !== null) return null
  const text = readIf(join(repo, STATE_DIR, 'base', target))
  return text !== null && sha(text) === rec.sha ? text : null
}

// The "kit-previous" side of the merge, for a file the kit has recorded before. Every layer is accepted only if
// its text hashes to the sha recorded in the manifest, so a wrong base can never be merged against:
//   migrated       0.3.x repos only (see migrateLegacyBase)
//   tag            the templates of the recorded kit tag, rendered with the installed renderer and the stored vars
//   tag-renderer   the renderer shipped in that tag (runs fetched code: only with baseRenderer === 'tag')
//   none           fallback = the existing no-base behaviour (review copy / additive merge); never an overwrite
// `informational` is for repo-owned (`once`) files, where the base only feeds a "what the kit changed" diff: layer 1
// only, no fallback entry and never an offer to run code from the tag.
function resolveBase({ repo, entry, rec, state, useVars, useAgents, session, baseRenderer, offer, informational = false }) {
  const miss = (reason, tag) => ({ base: null, via: 'none', fallback: informational ? null : { target: entry.target, tag, reason } })
  const migrated = migrateLegacyBase(repo, entry.target, rec)
  if (migrated !== null) return { base: migrated, via: 'migrated' }

  // The variables in force when this record was written: the manifest's, with this record's own overrides.
  const recVars = { ...state.vars, ...(rec.vars ?? {}) }
  const tag = rec.tag ?? state.kitVersion
  if (!tag) return miss('no kit tag was recorded for this file', null)
  if (!useVars.KIT_GIT_URL) return miss('KIT_GIT_URL is not set', tag)
  const c = session.clone(useVars.KIT_GIT_URL, tag)
  if (c.error) return miss(`could not fetch tag ${tag}: ${c.error}`, tag)

  try {
    const oldManifest = JSON.parse(readFileSync(join(c.root, 'templates', 'manifest.json'), 'utf8'))
    const oldEntry = oldManifest.files.find((f) => f.target === entry.target)
    if (!oldEntry) return miss(`tag ${tag} has no template for this file`, tag)
    const text = renderTemplate(oldEntry, oldManifest, recVars, c.root)
    if (sha(text) === rec.sha) return { base: text, via: 'tag' }
  } catch (e) {
    return miss(`could not render tag ${tag}: ${oneLine(e)}`, tag)
  }

  if (informational) return miss('', tag)
  if (baseRenderer !== 'tag') {
    offer.push({ target: entry.target, tag })
    return miss(`rendering tag ${tag} with the installed kit does not reproduce the recorded hash (the renderer, the templates or the variables differ from when it was written; the tag's own renderer can only help if the renderer changed)`, tag)
  }
  const r = session.tagRender(c.root, useAgents, recVars)
  if (r.error) return miss(`the renderer of tag ${tag} failed: ${r.error}`, tag)
  const text = typeof r.map[entry.target] === 'string' ? normalizeEol(r.map[entry.target]) : null
  if (text !== null && sha(text) === rec.sha) return { base: text, via: 'tag-renderer' }
  return miss(`the renderer of tag ${tag} did not reproduce the recorded hash`, tag)
}

const effectOf = (entry) =>
  entry.update === 'once'
    ? 'the kit changes to this file are not shown'
    : entry.kind === 'json'
      ? 'first-time merge: missing keys are added, differing values become conflicts'
      : 'first-time merge: review copy under qa-kit-artifacts/merge, the file itself is not touched'

function listLegacyBase(repo) {
  const root = join(repo, STATE_DIR, 'base')
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
  walk(root, '')
  return out.sort()
}

export function plan({ repo, kitRoot = KIT_ROOT, agents, vars, fetchTag, baseRenderer = 'current', renderTimeoutMs }) {
  const manifest = JSON.parse(readFileSync(join(kitRoot, 'templates', 'manifest.json'), 'utf8'))
  const state = loadState(repo)
  const useAgents = agents ?? state.agents
  const useVars = { ...state.vars, ...vars }
  if (!useAgents.length) throw new Error('no agents selected (pass --agents claude,opencode)')

  const session = baseSession({ fetchTag, renderTimeoutMs })
  const baseFallbacks = []
  const offer = []
  try {
    const entries = manifest.files
      .filter((e) => e.agents.some((a) => useAgents.includes(a)))
      .map((entry) => {
        const theirs = renderTemplate(entry, manifest, useVars, kitRoot)
        const ours = readIf(join(repo, entry.target))
        const legacy = entry.legacy ? readIf(join(repo, entry.legacy)) : null
        const rec = recordOf(state.files[entry.target])
        let base = null
        let via = 'none'
        if (rec && entry.kind !== 'lines') {
          if (rec.sha === sha(theirs)) {
            // The kit renders this file exactly as when it was recorded: nothing to rebuild, no fetch.
            base = theirs
            via = 'recorded'
          } else if (ours !== null && (entry.update === 'once' || ours !== theirs)) {
            const r = resolveBase({ repo, entry, rec, state, useVars, useAgents, session, baseRenderer, offer, informational: entry.update === 'once' })
            base = r.base
            via = r.via
            if (r.fallback) baseFallbacks.push({ ...r.fallback, effect: effectOf(entry) })
          }
        }
        const m = mergeEntry(entry, { base, ours, theirs, legacy })
        const kitChange = base !== null && base !== theirs ? unifiedDiff(base, theirs, entry.target) : ''
        const diff = m.status === 'kept' ? kitChange : m.details || m.error ? '' : unifiedDiff(ours ?? '', m.result, entry.target)
        return { target: entry.target, kind: entry.kind, status: m.status, conflicts: m.conflicts, details: m.details, error: m.error, from: m.from, result: m.result, theirs, diff, base: via }
      })
    const obsolete = listLegacyBase(repo)
    if (obsolete.length) entries.push({ target: LEGACY_BASE_TARGET, status: 'remove', files: obsolete, result: '', theirs: '', diff: '' })
    const tagRendererOffer = offer.length
      ? { url: useVars.KIT_GIT_URL, tags: [...new Set(offer.map((o) => o.tag))], targets: offer.map((o) => o.target) }
      : null
    return { agents: useAgents, vars: useVars, kitVersion: kitVersion(kitRoot), entries, baseFallbacks, tagRendererOffer }
  } finally {
    session.close()
  }
}

// Records what the kit rendered for `settled` (hash + the tag that rendered it), which is what the next update
// rebuilds the base from. The recorded kit version only moves when nothing is left unresolved, so a skipped
// file is offered again on the next run.
// A file whose rendered content did not change keeps its older tag (it renders the same there), so only content
// that is new in this run depends on the newest tag; those entries are returned for verifyRecordedTag.
function saveState(repo, p, settled) {
  const state = loadState(repo)
  const changed = []

  // Variables that changed in this run: records that stay unsettled keep the values they were written with.
  const oldVars = state.vars ?? {}
  const moved = Object.keys(oldVars).filter((k) => oldVars[k] !== p.vars[k])
  if (moved.length) {
    for (const [target, raw] of Object.entries(state.files)) {
      if (settled.some((e) => e.target === target)) continue
      const rec = recordOf(raw)
      const keep = { ...(rec.vars ?? {}) }
      for (const k of moved) if (!(k in keep)) keep[k] = oldVars[k]
      state.files[target] = { ...rec, vars: keep }
    }
  }

  for (const e of settled) {
    const prev = recordOf(state.files[e.target])
    const digest = sha(e.theirs)
    const same = prev !== null && prev.sha === digest
    const next = { sha: digest, tag: same ? (prev.tag ?? state.kitVersion ?? p.kitVersion) : p.kitVersion }
    if (!same && e.kind !== 'lines') changed.push(e)
    const legacySha = prev ? (prev.tag === null ? prev.sha : prev.legacy) : undefined
    if (legacySha && existsSync(join(repo, STATE_DIR, 'base', e.target))) next.legacy = legacySha
    state.files[e.target] = next
  }
  const pending = p.entries.some((e) => e.status !== 'remove' && !settled.includes(e) && !SETTLED.has(e.status))
  writeFile(join(repo, STATE_FILE), json({
    kitVersion: pending ? state.kitVersion : p.kitVersion,
    agents: p.agents,
    vars: p.vars,
    files: state.files,
  }))
  return changed
}

// After writing, checks that the tag we just recorded really renders what the installed kit wrote. The marketplace
// and the OpenCode checkout follow the default branch, so the installed kit can be ahead of its tag (unreleased
// commits, tag pushed late). It never blocks and never changes a file; the report tells the owner what to fix.
//   ok | missing (the tag is not on the remote) | differs (tag exists, renders differently) | unverified (no network)
function verifyRecordedTag(changed, p, { fetchTag, renderTimeoutMs } = {}) {
  if (!changed.length) return null
  const tag = p.kitVersion
  const url = p.vars.KIT_GIT_URL
  const targets = changed.map((e) => e.target)
  if (!url) return { tag, status: 'unverified', targets, reason: 'KIT_GIT_URL is not set' }
  const session = baseSession({ fetchTag, renderTimeoutMs })
  try {
    const c = session.clone(url, tag)
    if (c.error) return { tag, status: c.missing ? 'missing' : 'unverified', targets, reason: c.error }
    let oldManifest
    try {
      oldManifest = JSON.parse(readFileSync(join(c.root, 'templates', 'manifest.json'), 'utf8'))
    } catch {
      return { tag, status: 'differs', targets, reason: `tag ${tag} has no readable templates/manifest.json` }
    }
    const differing = []
    for (const e of changed) {
      try {
        const oldEntry = oldManifest.files.find((f) => f.target === e.target)
        if (!oldEntry || sha(renderTemplate(oldEntry, oldManifest, p.vars, c.root)) !== sha(e.theirs)) differing.push(e.target)
      } catch {
        differing.push(e.target)
      }
    }
    return differing.length
      ? { tag, status: 'differs', targets: differing, reason: 'the installed kit renders these files differently from the tag' }
      : { tag, status: 'ok', targets, reason: null }
  } finally {
    session.close()
  }
}

// Drops records of targets the kit no longer manages (for example .gitattributes) once no legacy copy needs them.
function pruneRecords(repo, kitRoot) {
  const manifest = JSON.parse(readFileSync(join(kitRoot, 'templates', 'manifest.json'), 'utf8'))
  const known = new Set(manifest.files.map((f) => f.target))
  const state = loadState(repo)
  let dropped = false
  for (const target of Object.keys(state.files)) {
    if (!known.has(target) && !existsSync(join(repo, STATE_DIR, 'base', target))) {
      delete state.files[target]
      dropped = true
    }
  }
  if (dropped) writeFile(join(repo, STATE_FILE), json({ kitVersion: state.kitVersion, agents: state.agents, vars: state.vars, files: state.files }))
}

// Removes the obsolete 0.3.x copies once nothing depends on them any more. Deletes files and emptied folders
// only, never runs git, and never touches a copy that was edited since the kit wrote it.
function removeLegacyBase(repo, obsolete, planEntries, accept) {
  const out = { removed: [], kept: [], blockedBy: [], skipped: false }
  if (accept !== 'all' && !accept.includes(obsolete.target)) return { ...out, skipped: true }
  const state = loadState(repo)
  const inPlan = new Set(planEntries.map((e) => e.target))
  out.blockedBy = obsolete.files.filter((f) => inPlan.has(f) && recordOf(state.files[f])?.tag === null)
  if (out.blockedBy.length) return out

  const base = join(repo, STATE_DIR, 'base')
  const dirs = new Set()
  for (const f of obsolete.files) {
    const p = join(base, f)
    const rec = recordOf(state.files[f])
    const expected = rec ? (rec.tag === null ? rec.sha : rec.legacy) : undefined
    const text = readIf(p)
    if (expected && text !== null && sha(text) === expected && !lstatSync(p).isSymbolicLink()) {
      unlinkSync(p)
      out.removed.push(f)
      for (let d = posix.dirname(f); d !== '.'; d = posix.dirname(d)) dirs.add(d)
      if (rec.legacy) delete rec.legacy
    } else {
      out.kept.push(f)
    }
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    try { rmdirSync(join(base, d)) } catch { /* not empty: something was kept */ }
  }
  try { rmdirSync(base) } catch { /* not empty */ }
  writeFile(join(repo, STATE_FILE), json({ kitVersion: state.kitVersion, agents: state.agents, vars: state.vars, files: state.files }))
  return out
}

export function apply({ repo, accept, ...opts }) {
  const p = plan({ repo, ...opts })
  const obsolete = p.entries.find((e) => e.status === 'remove')
  const files = p.entries.filter((e) => e !== obsolete)
  const settled = []
  const needsManual = []
  const errors = []
  for (const e of files) {
    if (accept !== 'all' && !accept.includes(e.target)) continue
    if (WRITES.has(e.status)) {
      writeFile(join(repo, e.target), e.result)
      settled.push(e)
    } else if (SETTLED.has(e.status)) {
      settled.push(e)
    } else if (e.status === 'error') {
      errors.push(`${e.target}: ${e.error}`)
    } else {
      // The review copy goes into qa-kit-artifacts/: make sure that folder ignores itself before anything lands in it,
      // even when the user declined the .gitignore entry of this run.
      const own = join(repo, 'qa-kit-artifacts', '.gitignore')
      if (!existsSync(own)) writeFile(own, '*\n')
      writeFile(join(repo, MERGE_DIR, e.target), e.result)
      needsManual.push(`${MERGE_DIR}/${e.target}`)
    }
  }
  const changed = saveState(repo, p, settled)
  const tagCheck = verifyRecordedTag(changed, p, opts)
  const legacyBase = obsolete ? removeLegacyBase(repo, obsolete, files, accept) : null
  pruneRecords(repo, opts.kitRoot ?? KIT_ROOT)
  const written = settled.filter((e) => WRITES.has(e.status))
  return {
    applied: written.map((e) => e.target),
    leftovers: written.filter((e) => e.status === 'move').map((e) => e.from),
    needsManual,
    errors,
    baseFallbacks: p.baseFallbacks,
    tagRendererOffer: p.tagRendererOffer,
    tagCheck,
    legacyBase,
  }
}

export function record({ repo, paths, ...opts }) {
  const p = plan({ repo, ...opts })
  const chosen = p.entries.filter((e) => e.status !== 'remove' && paths.includes(e.target))
  for (const e of chosen) {
    if (CONFLICT_MARKER.test(readIf(join(repo, e.target)) ?? '')) throw new Error(`${e.target} still contains conflict markers; resolve them first`)
  }
  const changed = saveState(repo, p, chosen)
  return { recorded: chosen.map((e) => e.target), tagCheck: verifyRecordedTag(changed, p, opts) }
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv
  const o = { cmd, vars: {} }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--repo') o.repo = resolve(rest[++i])
    else if (a === '--cwd') o.cwd = resolve(rest[++i])
    else if (a === '--path') o.path = rest[++i]
    else if (a.startsWith('--cwd=')) o.cwd = resolve(a.slice(6))
    else if (a.startsWith('--path=')) o.path = a.slice(7)
    else if (a === '--agents') o.agents = rest[++i].split(',')
    else if (a === '--accept') { const v = rest[++i]; o.accept = v === 'all' ? 'all' : v.split(',') }
    else if (a === '--paths') o.paths = rest[++i].split(',')
    else if (a === '--extra') o.extra = rest[++i].split(',')
    else if (a === '--var') { const [k, ...v] = rest[++i].split('='); o.vars[k] = v.join('=') }
    else if (a === '--base-renderer') {
      o.baseRenderer = rest[++i]
      if (!['current', 'tag'].includes(o.baseRenderer)) throw new Error('--base-renderer takes current or tag')
    }
    else if (a === '--json') o.json = true
    else throw new Error(`unknown argument: ${a}`)
  }
  return o
}

function printPlan(p) {
  console.log(`kit ${p.kitVersion}, agents: ${p.agents.join(', ')}`)
  for (const e of p.entries) {
    if (e.status === 'remove') {
      console.log(`\n[remove] ${e.target} (${e.files.length} obsolete copies from kit 0.3.x, no longer used)`)
      continue
    }
    const note = e.from ? ` (from ${e.from})` : e.conflicts ? ` (${e.conflicts.join(', ')})` : ''
    console.log(`\n[${e.status}] ${e.target}${note}`)
    if (e.error) console.log(`  ${e.error}`)
    for (const d of e.details ?? []) console.log(`  ${d.path}\n    repo: ${JSON.stringify(d.ours)}\n    kit:  ${JSON.stringify(d.theirs)}`)
    if (e.diff) console.log(e.diff.trimEnd())
  }
  for (const f of p.baseFallbacks) console.log(`\nbase fallback: ${f.target} - ${f.reason}; ${f.effect}`)
  if (p.tagRendererOffer) {
    const o = p.tagRendererOffer
    console.log(`\nthe renderer of tag ${o.tags.join(', ')} (${o.url}) could rebuild ${o.targets.join(', ')}; it runs code from that repository: re-run with --base-renderer tag only if the user agrees`)
  }
}

function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.cmd === 'status') {
    console.log(json(status({ repo: o.repo ?? process.cwd(), kitRoot: KIT_ROOT, agents: o.agents, extra: o.extra })))
    return
  }
  if (o.cmd === 'locate') {
    console.log(json(locate({ cwd: o.cwd, path: o.path })))
    return
  }
  const common = { repo: o.repo ?? process.cwd(), agents: o.agents, vars: o.vars, baseRenderer: o.baseRenderer }
  if (o.cmd === 'plan') {
    const p = plan(common)
    if (o.json) console.log(json({ ...p, entries: p.entries.map(({ result, theirs, ...rest }) => rest) }))
    else printPlan(p)
  } else if (o.cmd === 'apply') {
    if (!o.accept) throw new Error('apply needs --accept all|<target>,<target>')
    const r = apply({ ...common, accept: o.accept })
    console.log(json(r))
    if (r.needsManual.length || r.errors.length) process.exitCode = 4
  } else if (o.cmd === 'record') {
    if (!o.paths) throw new Error('record needs --paths <target>,<target>')
    console.log(json(record({ ...common, paths: o.paths })))
  } else {
    throw new Error('usage: merge.mjs plan|apply|record|status --repo <dir> ... [--base-renderer current|tag] | locate [--cwd <dir>] [--path <folder>]')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (e) { console.error(e.message); process.exit(1) }
}
