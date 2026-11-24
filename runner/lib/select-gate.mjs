import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tryGit } from './git.mjs'

// The deterministic half of change analysis. The agent reads the changes and returns FACTS (changes.json: what changed, what it
// thinks each change affects). Everything that decides how much to run lives here, in code that is tested, so the same facts always
// give the same answer and nothing can be narrower than the rules allow: any doubt is `full`.

export const CHANGES_DIR = 'qa-kit-artifacts/changes'
export const MODES = ['narrowed', 'full', 'none']
export const FALLBACK_REASONS = [
  'analysis-unavailable',
  'unverified-source',
  'analysis-incomplete',
  'index-unavailable',
  'global-change',
  'low-confidence',
  'no-candidates',
  'unsafe-path',
  'wide-selection',
  'stale-analysis',
  'invalid-selection',
  'bad-arguments',
  'selection-failed',
]
export const NONE_REASONS = ['no-changes', 'docs-only', 'only-deletions']

const AGENT_KINDS = new Set(['ui', 'api', 'shared-test-support', 'test-only', 'config-infra', 'ignorable', 'global'])
const SAFE_PATH = /^[A-Za-z0-9_./@-]+$/
const SAFE_PROJECT = /^[A-Za-z0-9_.@-]+$/
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/@^~-]*$/
const RANK = { low: 0, medium: 1, high: 2 }
export const DEFAULT_THRESHOLD = 60
const SPEC_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/

// ---- paths and globs ---------------------------------------------------------------------------------------------------------

const norm = value => String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')

function escapeRe(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

// One fixed dialect: `**` crosses folders, `*` and `?` stay inside one folder, `{a,b}` alternates, a glob with no `/` matches the
// file name anywhere, a glob with a `/` is anchored at the repo root.
export function globToRegExp(glob) {
  const g = norm(glob)
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++
        if (g[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{' && g.indexOf('}', i) > i) {
      const end = g.indexOf('}', i)
      re += `(?:${g.slice(i + 1, end).split(',').map(escapeRe).join('|')})`
      i = end
    } else re += escapeRe(c)
  }
  return new RegExp(`${g.includes('/') ? '^' : '(?:^|/)'}${re}$`)
}

// `org/app:src/orders/**` matches only in that repo; a glob with no prefix matches in every repo.
export function compileGlob(entry) {
  const prefixed = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+):(.+)$/.exec(entry.trim())
  return { repo: prefixed ? prefixed[1].toLowerCase() : null, re: globToRegExp(prefixed ? prefixed[2] : entry) }
}

function matchesAny(compiled, filePath, repo) {
  const p = norm(filePath)
  return compiled.some(raw => {
    const entry = typeof raw === 'string' ? compileGlob(raw) : raw
    return (!entry.repo || entry.repo === String(repo ?? '').toLowerCase()) && entry.re.test(p)
  })
}

const GLOBAL_PATHS = [
  /(^|\/)(package(-lock)?|npm-shrinkwrap|composer|tsconfig[\w.-]*|jsconfig)\.json$/,
  /(^|\/)(yarn\.lock|pnpm-lock\.yaml|pnpm-workspace\.yaml|composer\.lock|poetry\.lock|Pipfile(\.lock)?|Gemfile(\.lock)?|go\.(mod|sum)|Cargo\.(toml|lock)|pyproject\.toml|requirements[\w.-]*\.txt|pom\.xml|settings\.gradle(\.kts)?|build\.gradle(\.kts)?)$/,
  /(^|\/)(playwright|vite|vitest|webpack|rollup|next|nuxt|babel|svelte|astro|jest|eslint|prettier)\.config\.[cm]?[jt]s$/,
  /(^|\/)(\.babelrc[\w.-]*|\.eslintrc[\w.-]*|\.prettierrc[\w.-]*|\.nvmrc|\.node-version|\.tool-versions|angular\.json|nx\.json|lerna\.json|turbo\.json)$/,
  /(^|\/)(Dockerfile[\w.-]*|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml|Jenkinsfile[\w.-]*|\.gitlab-ci\.ya?ml|azure-pipelines[\w.-]*\.ya?ml|Makefile)$/,
  /(^|\/)\.(github\/workflows|circleci|buildkite)\//,
  /(^|\/)\.env([.\w-]*)$/,
  /(^|\/)(global-?(setup|teardown)|[\w.-]*\.setup)\.[cm]?[jt]s$/,
  /\.(csproj|sln|tf|tfvars)$/,
  /(^|\/)(migrations?|db\/migrate|i18n|locales?|translations?|helm|k8s|kubernetes|terraform|ingress)\//,
  /(^|\/)nginx[\w.-]*\.conf$/,
]
const SHARED_PATHS = /(^|\/)(shared|common|core|layouts?|router|middleware|interceptors?|auth|http-?client|api-?client)\//
const DOCS_ROOT = /^(README|LICENSE|LICENCE|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|AUTHORS|NOTICE|CODEOWNERS)([.\w-]*)$/i
const DOCS_PATHS = [/^docs\//, /^\.github\/(ISSUE_TEMPLATE\/|PULL_REQUEST_TEMPLATE|CODEOWNERS|dependabot\.ya?ml|FUNDING\.ya?ml)/, /^\.(vscode|idea)\//, /^\.(editorconfig|gitattributes|gitignore)$/]

// Path-only classification, independent of what the agent said. `global` always wins; `docs` is a strict allowlist; the rest is `other`.
export function classifyPath(filePath, mapping = {}) {
  const p = norm(filePath)
  if ((!SPEC_FILE.test(p) && GLOBAL_PATHS.some(re => re.test(p))) || matchesAny(mapping.global ?? [], p)) return 'global'
  if (DOCS_ROOT.test(p) || DOCS_PATHS.some(re => re.test(p)) || matchesAny(mapping.ignorable ?? [], p)) return 'docs'
  return 'other'
}

export function isSharedPath(filePath, mapping = {}) {
  const p = norm(filePath)
  return SHARED_PATHS.test(p) || matchesAny(mapping.shared ?? [], p)
}

// ---- the mapping file --------------------------------------------------------------------------------------------------------

const ticks = text => [...text.matchAll(/`([^`]+)`/g)].map(m => m[1].trim()).filter(v => v && !/^<.*>$/.test(v) && v.toLowerCase() !== 'none')

export function parseMapping(text = '') {
  const mapping = { threshold: undefined, global: [], ignorable: [], shared: [], repos: [], features: [] }
  const lists = { 'global paths': mapping.global, 'ignorable paths': mapping.ignorable, 'shared paths': mapping.shared, 'app repos': mapping.repos }
  let feature = null
  let section = null
  let fenced = false
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const heading = /^###\s+(.+?)\s*$/.exec(line)
    if (heading) {
      feature = heading[1].startsWith('<') ? null : { name: heading[1], appPaths: [], specFolders: [], unmapped: false }
      if (feature) mapping.features.push(feature)
      section = null
      continue
    }
    if (/^##\s/.test(line)) {
      feature = null
      section = null
      continue
    }
    if (feature) {
      if (/_Unmapped/i.test(line)) feature.unmapped = true
      const paths = /^\s*-\s+\*\*App paths\*\*:(.*)$/i.exec(line)
      const folders = /^\s*-\s+\*\*Spec folders\*\*:(.*)$/i.exec(line)
      if (paths) feature.appPaths.push(...ticks(paths[1]))
      if (folders) feature.specFolders.push(...ticks(folders[1]))
      continue
    }
    const setting = /^\s*-\s+\*\*(Full-run threshold|Global paths|Ignorable paths|Shared paths|App repos)\*\*:(.*)$/i.exec(line)
    if (setting) {
      const key = setting[1].toLowerCase()
      section = key
      if (key === 'full-run threshold') {
        const n = Number(ticks(setting[2])[0])
        if (Number.isInteger(n) && n >= 1 && n <= 100) mapping.threshold = n
      } else if (key === 'app repos') mapping.repos.push(...ticks(setting[2]))
      // Glob lists are indented bullets; an inline value counts only when the line holds nothing but backticked globs (no prose).
      else if (!setting[2].replace(/`[^`]+`/g, '').replace(/[,\s]/g, '')) lists[key].push(...ticks(setting[2]))
      continue
    }
    const sub = /^\s{2,}-\s+`([^`]+)`/.exec(line)
    if (sub && section && lists[section] && !/^<.*>$/.test(sub[1])) lists[section].push(sub[1].trim())
  }
  mapping.features = mapping.features.filter(f => !f.unmapped && f.appPaths.length)
  return mapping
}

// ---- the test index ----------------------------------------------------------------------------------------------------------

const tagName = value => String(value).replace(/^@/, '').toLowerCase()
const titleTags = title => [...String(title ?? '').matchAll(/@([\w-]+)/g)].map(m => m[1].toLowerCase())

// Walks the nested JSON of `playwright test --list --reporter=json` and returns git-root-relative spec files with their projects and
// tags. A tag is read from the `tags` field (newer Playwright) and from `@tag` words in titles (every version).
export function buildIndex(raw, { gitRoot }) {
  const files = new Map()
  let tagsAvailable = false
  const rootDir = raw?.config?.rootDir
  const repoPath = file => {
    const abs = path.isAbsolute(file) ? file : path.resolve(rootDir ?? gitRoot, file)
    return path.relative(gitRoot, abs).split(path.sep).join('/')
  }
  const visit = (suite, inheritedFile, inheritedTags) => {
    const file = suite.file ?? inheritedFile
    const suiteTags = [...inheritedTags, ...(suite.file ? [] : titleTags(suite.title))]
    for (const spec of suite.specs ?? []) {
      const rel = file || spec.file ? repoPath(spec.file ?? file) : null
      if (!rel || rel.startsWith('..')) continue
      const entry = files.get(rel) ?? { projects: new Set(), tags: new Set() }
      files.set(rel, entry)
      if (Array.isArray(spec.tags)) tagsAvailable = true
      for (const tag of [...suiteTags, ...(spec.tags ?? []).map(tagName), ...titleTags(spec.title)]) entry.tags.add(tag)
      for (const test of spec.tests ?? []) {
        if (test.projectName) entry.projects.add(test.projectName)
        if (Array.isArray(test.tags)) {
          tagsAvailable = true
          for (const tag of test.tags) entry.tags.add(tagName(tag))
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child, file, suiteTags)
  }
  for (const suite of raw?.suites ?? []) visit(suite, undefined, [])
  // Tags written in titles (`@smoke`) count as much as the `tags` field: only an index with no tag from any source has none.
  return { files, tagsAvailable: tagsAvailable || [...files.values()].some(entry => entry.tags.size > 0), ok: files.size > 0 }
}

// ---- units, confidence, decision ---------------------------------------------------------------------------------------------

const unique = list => [...new Set(list)]

function mappingSource(unit, mapping, index, problems) {
  const paths = [unit.path, unit.oldPath].filter(Boolean)
  const hits = mapping.features.filter(f => paths.some(p => matchesAny(f.appPaths.map(compileGlob), p, unit.repo)))
  const features = []
  const files = []
  for (const feature of hits) {
    const folders = feature.specFolders.map(norm).map(f => (f.endsWith('/') ? f : `${f}/`))
    const tag = feature.name.toLowerCase()
    const found = [...index.files].filter(([file, entry]) => folders.some(folder => file.startsWith(folder)) || entry.tags.has(tag)).map(([file]) => file)
    if (!found.length) problems.push(`mapping feature ${feature.name} matched ${unit.path} but no spec file lives in its Spec folders or carries its tag`)
    features.push(feature.name.toLowerCase())
    files.push(...found)
  }
  return { features: unique(features), files: unique(files) }
}

function inferenceSource(unit, index, warnings) {
  const given = unit.inference?.files ?? []
  const files = unique(given.map(norm).filter(f => index.files.has(f)))
  const dropped = given.length - files.length
  if (dropped > 0) warnings.push(`${unit.path}: ${dropped} inferred file(s) are not in the test index and were dropped`)
  return { features: unique((unit.inference?.features ?? []).map(f => String(f).toLowerCase())), files }
}

export function evaluateUnit(unit, { mapping, index, warnings = [], problems = [] }) {
  const paths = [unit.path, unit.oldPath].filter(Boolean)
  const classes = paths.map(p => classifyPath(p, mapping))
  const claimed = AGENT_KINDS.has(unit.kind) ? unit.kind : 'global'
  let kind
  if (classes.includes('global') || claimed === 'global') kind = 'global'
  else if (classes.every(c => c === 'docs')) kind = 'ignorable'
  else if (claimed === 'ignorable') kind = 'ignorable-claim-refused'
  else kind = claimed
  if (kind === 'ignorable-claim-refused') {
    warnings.push(`${unit.path}: marked ignorable but not on the docs allowlist, treated as a source change`)
    kind = 'config-infra'
  }
  const testSide = kind === 'test-only' || kind === 'shared-test-support'
  const shared = !testSide && kind !== 'ignorable' && kind !== 'global' && paths.some(p => isSharedPath(p, mapping))
  const mapped = kind === 'ignorable' || kind === 'global' ? { features: [], files: [] } : mappingSource(unit, mapping, index, problems)
  const inferred = kind === 'ignorable' || kind === 'global' ? { features: [], files: [] } : inferenceSource(unit, index, warnings)
  const out = { repo: unit.repo ?? null, path: unit.path, oldPath: unit.oldPath, status: unit.status, kind, mapping: mapped, inference: { ...inferred, reasons: unit.inference?.reasons ?? [] }, candidates: [], sources: [], confidence: 'low', note: undefined }
  if (kind === 'ignorable') return { ...out, confidence: 'high' }
  if (kind === 'global') return { ...out, confidence: 'high', note: 'global change' }

  const deletedSpec = unit.status === 'deleted' && SPEC_FILE.test(norm(unit.path))
  if (deletedSpec) return { ...out, confidence: 'high', note: 'deleted spec: nothing to run' }
  if (kind === 'test-only' && index.files.has(norm(unit.path))) return { ...out, confidence: 'high', candidates: [norm(unit.path)], sources: ['self'] }

  const m = new Set(mapped.files)
  const i = new Set(inferred.files)
  let confidence
  let candidates
  let sources
  if (m.size && i.size) {
    const overlap = [...m].some(f => i.has(f)) || mapped.features.some(f => inferred.features.includes(f))
    confidence = overlap ? 'high' : 'low'
    candidates = unique([...m, ...i])
    sources = ['mapping', 'inference']
    if (!overlap) out.note = 'mapping and inference point at different tests'
  } else if (m.size || i.size) {
    confidence = 'medium'
    candidates = [...(m.size ? m : i)]
    sources = [m.size ? 'mapping' : 'inference']
  } else {
    confidence = 'low'
    candidates = []
    sources = []
    out.note = 'no test found by either source'
  }
  if (testSide && kind === 'test-only' && !i.size && !m.size) out.note = 'support or data file with no known reader'
  if (kind === 'shared-test-support') sources = sources.map(s => (s === 'inference' ? 'importer' : s))
  if (unit.wide) {
    confidence = 'low'
    out.note = 'the change reaches most of the suite'
  }
  if (shared) {
    confidence = 'low'
    out.note = 'shared application code: it can affect any feature'
  }
  return { ...out, confidence, candidates, sources }
}

const sha1 = text => createHash('sha1').update(text).digest('hex')

// A test run writes these; they are not a change of the code under analysis.
const OUTPUT_DIRS = /(^|\/)(test-results|playwright-report|blob-report|allure-results|allure-report)\//

export function treeId(cwd) {
  const head = tryGit(cwd, ['rev-parse', 'HEAD']) ?? 'no-head'
  const status = (tryGit(cwd, ['status', '--porcelain=v1', '-uall']) ?? '')
    .split('\n')
    .filter(line => !OUTPUT_DIRS.test(line.slice(3)))
    .join('\n')
  const diff = tryGit(cwd, ['diff', 'HEAD', '--no-ext-diff', '--binary']) ?? ''
  return sha1(`${head}\n${status}\n${sha1(diff)}`)
}

// The agent can say "nothing changed" wrongly (a shallow clone, a wrong base). For a local source the gate asks git itself.
export function verifyEmpty(source, cwd) {
  if (source?.kind === 'branch') {
    if (!source.base || !SAFE_REF.test(source.base) || (source.head && !SAFE_REF.test(source.head))) return { ok: false, code: 'unverified-source', why: 'the base or head ref is missing or unsafe' }
    if (tryGit(cwd, ['rev-parse', '--is-shallow-repository']) === 'true') return { ok: false, code: 'unverified-source', why: 'the repository is a shallow clone' }
    const head = source.head || 'HEAD'
    const base = tryGit(cwd, ['merge-base', source.base, head])
    if (!base) return { ok: false, code: 'unverified-source', why: `no merge base between ${source.base} and ${head}` }
    const changed = source.head ? tryGit(cwd, ['diff', '--name-only', base, head]) : tryGit(cwd, ['diff', '--name-only', base])
    const untracked = source.head ? '' : tryGit(cwd, ['ls-files', '--others', '--exclude-standard'])
    if (changed === null || untracked === null) return { ok: false, code: 'unverified-source', why: 'git could not list the changes' }
    if (changed || untracked) return { ok: false, code: 'analysis-incomplete', why: 'git shows changed files that the analysis did not list' }
    return { ok: true }
  }
  if (source?.kind === 'since' && Number.isInteger(source.since) && source.since > 0) {
    if (tryGit(cwd, ['rev-parse', '--is-shallow-repository']) === 'true') return { ok: false, code: 'unverified-source', why: 'the repository is a shallow clone' }
    const commits = tryGit(cwd, ['rev-list', '--first-parent', `--since=${source.since + 1} days ago`, '-n', '1', 'HEAD'])
    if (commits === null) return { ok: false, code: 'unverified-source', why: 'git could not read the history' }
    return commits ? { ok: false, code: 'analysis-incomplete', why: 'git shows commits in the window that the analysis did not list' } : { ok: true }
  }
  return { ok: false, code: 'unverified-source', why: 'an empty change set cannot be verified for this source' }
}

function lowestConfidence(units) {
  return units.reduce((low, u) => (RANK[u.confidence] < RANK[low] ? u.confidence : low), 'high')
}

export function decide({ facts, index, mapping, options = {}, cwd }) {
  const minConfidence = options.minConfidence ?? 'medium'
  const threshold = options.threshold ?? mapping.threshold ?? DEFAULT_THRESHOLD
  const smokeTag = tagName(options.smokeTag ?? 'smoke')
  const warnings = []
  const problems = []
  const base = { minConfidence, threshold, warnings, mappingProblems: problems, disagreements: [], mappingGaps: [], units: [], files: [], projects: [], playwrightArgs: [], perFile: [], totals: { selected: 0, suite: index?.files?.size ?? 0 } }
  const full = (fallbackReason, reason) => ({ ...base, mode: 'full', fallbackReason, reason })
  const none = (noneReason, reason) => ({ ...base, mode: 'none', noneReason, reason })

  if (!facts || facts.blocked) return full('analysis-unavailable', facts?.blockReason ?? 'no analysis was written')
  if (!Array.isArray(facts.units)) return full('analysis-unavailable', 'the analysis has no units list')
  if (!index?.ok) return full('index-unavailable', 'the test index is empty or could not be read')

  const units = facts.units.map(u => evaluateUnit(u, { mapping, index, warnings, problems }))
  base.units = units
  base.disagreements = units.filter(u => u.mapping.files.length && u.inference.files.length && u.note?.startsWith('mapping and inference')).map(u => u.path)
  base.mappingGaps = units.filter(u => !u.mapping.files.length && u.inference.files.length && u.kind !== 'ignorable' && u.kind !== 'global').map(u => u.path)

  if (!units.length) {
    const check = verifyEmpty(facts.source, cwd)
    return check.ok ? none('no-changes', 'no changed files: no scope identified, nothing to run') : full(check.code, `empty change set not accepted: ${check.why}`)
  }
  const global = units.filter(u => u.kind === 'global')
  if (global.length) return full('global-change', `global change: ${global.slice(0, 3).map(u => u.path).join(', ')}${global.length > 3 ? ', ...' : ''}`)
  const live = units.filter(u => u.kind !== 'ignorable')
  if (!live.length) return none('docs-only', 'only documentation-like files changed: nothing to run')

  const needed = RANK[minConfidence] ?? RANK.medium
  const weak = live.filter(u => RANK[u.confidence] < needed)
  if (weak.length) {
    const noCandidate = weak.every(u => !u.candidates.length && !u.note?.startsWith('deleted'))
    return full(noCandidate ? 'no-candidates' : 'low-confidence', `${weak.length} change(s) below ${minConfidence} confidence: ${weak.slice(0, 3).map(u => `${u.path} (${u.confidence}${u.note ? `: ${u.note}` : ''})`).join('; ')}`)
  }

  const selected = new Map()
  const add = (file, why, confidence, source) => {
    const entry = selected.get(file) ?? { file, why, confidence, sources: [] }
    if (RANK[confidence] < RANK[entry.confidence]) entry.confidence = confidence
    if (!entry.sources.includes(source)) entry.sources.push(source)
    selected.set(file, entry)
  }
  for (const unit of live) for (const file of unit.candidates) for (const source of unit.sources.length ? unit.sources : ['inference']) add(file, `${unit.path} changed (${unit.kind})`, unit.confidence, source)
  const onlyDeletions = live.every(u => u.note?.startsWith('deleted'))
  if (options.smoke !== false && selected.size) {
    const features = new Set(live.flatMap(u => [...u.mapping.features, ...u.inference.features]))
    for (const [file, entry] of index.files) {
      if (entry.tags.has(smokeTag) && [...features].some(f => entry.tags.has(f)) && !selected.has(file)) add(file, 'smoke spec of an affected feature', 'medium', 'smoke')
    }
    if (!index.tagsAvailable) warnings.push('the test index carries no tags, so smoke specs were not added')
  }
  if (!selected.size) return onlyDeletions ? none('only-deletions', 'only spec files were deleted: nothing to run') : full('no-candidates', 'no test was found for the changes')

  const files = [...selected.keys()].sort()
  const projects = unique(files.flatMap(f => [...index.files.get(f).projects])).filter(Boolean).sort()
  if (files.some(f => !SAFE_PATH.test(f)) || projects.some(p => !SAFE_PROJECT.test(p))) return full('unsafe-path', 'a selected spec path or project name has characters that are not safe to pass on a command line')
  const share = Math.round((files.length / Math.max(index.files.size, 1)) * 100)
  if (share > threshold) return full('wide-selection', `${files.length} of ${index.files.size} spec files (${share}%) is above the ${threshold}% threshold`)

  const playwrightArgs = [...projects.map(p => `--project=${p}`), ...files]
  return {
    ...base,
    mode: 'narrowed',
    reason: `${files.length} of ${index.files.size} spec files (${share}%) for ${live.length} changed file(s)`,
    files,
    projects,
    playwrightArgs,
    perFile: files.map(f => selected.get(f)),
    totals: { selected: files.length, suite: index.files.size },
    confidence: lowestConfidence(live),
  }
}

// ---- output files ------------------------------------------------------------------------------------------------------------

export function renderScreen(result, extra = {}) {
  const lines = []
  const scope = result.mode === 'narrowed' ? `${result.totals.selected} of ${result.totals.suite} spec files   projects: ${result.projects.join(', ') || '(none)'}` : result.mode === 'full' ? 'the full suite (no narrowing)' : 'no scope identified'
  lines.push(`Selection: ${result.mode}${result.confidence ? ` (${result.confidence})` : ''}   ${scope}`)
  lines.push(`Why:     ${result.reason}`)
  if (result.mode === 'narrowed') lines.push(`Run:     npx playwright test ${result.playwrightArgs.join(' ')}`)
  else lines.push(result.mode === 'none' ? 'Run:     nothing' : 'Run:     the full suite (no narrowing)')
  if (result.fallbackReason) lines.push(`Doubt:   ${result.fallbackReason}`)
  const doubts = [...result.warnings, ...result.mappingProblems, ...result.disagreements.map(d => `mapping and inference disagree about ${d}`)]
  if (doubts.length) lines.push(`Notes:   ${doubts.slice(0, 5).join(' | ')}${doubts.length > 5 ? ` (+${doubts.length - 5} more in selection.md)` : ''}`)
  lines.push(`Files:   ${CHANGES_DIR}/selection.md  selection.json  selection.args${extra.suffix ?? ''}`)
  return lines.join('\n')
}

export function renderMarkdown(result, meta) {
  const out = [`# Test selection: ${result.mode}`, '', '```', renderScreen(result), '```', '', `Generated ${meta.generatedAt} (run ${meta.runId}). Confidence floor: ${result.minConfidence}; full-run threshold: ${result.threshold}%.`, '']
  if (result.perFile.length) {
    out.push('## Selected spec files', '', '| File | Why | Confidence | Sources |', '|---|---|---|---|')
    for (const f of result.perFile) out.push(`| ${f.file} | ${f.why} | ${f.confidence} | ${f.sources.join(', ')} |`)
    out.push('')
  }
  if (result.units.length) {
    out.push('## Changed files', '', '| Repo | File | Kind | Confidence | Mapping | Inference | Note |', '|---|---|---|---|---|---|---|')
    for (const u of result.units) out.push(`| ${u.repo ?? '(this repo)'} | ${u.path} | ${u.kind} | ${u.confidence} | ${u.mapping.features.join(', ') || '-'} | ${u.inference.features.join(', ') || '-'} | ${u.note ?? ''} |`)
    out.push('')
  }
  for (const [title, list] of [['Disagreements (mapping vs inference)', result.disagreements], ['Mapping gaps (inference found tests, the mapping file has no entry)', result.mappingGaps], ['Mapping problems', result.mappingProblems], ['Warnings', result.warnings]]) {
    if (list.length) out.push(`## ${title}`, '', ...list.map(item => `- ${item}`), '')
  }
  out.push('The JSON file is the contract for scripts; this file is for people and is never parsed.', '')
  return out.join('\n')
}

export function writeSelection(cwd, result, meta) {
  const dir = path.join(cwd, CHANGES_DIR)
  mkdirSync(dir, { recursive: true })
  const full = { schemaVersion: 1, ...meta, ...result, blocked: false }
  writeFileSync(path.join(dir, 'selection.json'), `${JSON.stringify(full, null, 2)}\n`)
  writeFileSync(path.join(dir, 'selection.md'), renderMarkdown(result, meta))
  writeFileSync(path.join(dir, 'selection.args'), result.mode === 'narrowed' ? `${result.playwrightArgs.join(' ')}\n` : '\n')
  return full
}

// ---- commands ----------------------------------------------------------------------------------------------------------------

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function gitRootOf(cwd) {
  return tryGit(cwd, ['rev-parse', '--show-toplevel']) ?? cwd
}

// Starts a run: removes whatever an earlier run left (a stale selection is worse than none) and records the state of the tree.
export function begin(cwd) {
  const dir = path.join(cwd, CHANGES_DIR)
  mkdirSync(path.join(cwd, 'qa-kit-artifacts'), { recursive: true })
  if (!existsSync(path.join(cwd, 'qa-kit-artifacts', '.gitignore'))) writeFileSync(path.join(cwd, 'qa-kit-artifacts', '.gitignore'), '*\n')
  if (existsSync(dir)) for (const name of readdirSync(dir)) rmSync(path.join(dir, name), { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const run = { runId: randomBytes(4).toString('hex'), treeId: treeId(cwd), startedAt: new Date().toISOString() }
  writeFileSync(path.join(dir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`)
  return run
}

const DEFAULT_INDEX_COMMAND = 'npx playwright test --list --reporter=json'

function loadIndex(cwd, indexFile) {
  const file = indexFile ?? path.join(cwd, CHANGES_DIR, 'test-index.json')
  let raw = readJson(file)
  if (!raw && !indexFile) {
    try {
      const stdout = execFileSync(DEFAULT_INDEX_COMMAND, { cwd, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28, timeout: 300_000, windowsHide: true })
      raw = JSON.parse(stdout)
    } catch {
      raw = null
    }
  }
  return buildIndex(raw ?? {}, { gitRoot: gitRootOf(cwd) })
}

export function finalize(cwd, options = {}) {
  const dir = path.join(cwd, CHANGES_DIR)
  const run = readJson(path.join(dir, 'run.json'))
  const facts = readJson(path.join(dir, 'changes.json'))
  const meta = { generatedAt: new Date().toISOString(), runId: run?.runId ?? 'none', treeId: run?.treeId ?? 'none', source: facts?.source }
  let result
  if (!run) result = decide({ facts: { blocked: true, blockReason: 'no run was started (run.json is missing)' }, index: { ok: true, files: new Map() }, mapping: {}, options, cwd })
  else if (run.treeId !== treeId(cwd)) result = { ...decide({ facts: { blocked: true }, index: { ok: true, files: new Map() }, mapping: {}, options, cwd }), fallbackReason: 'stale-analysis', reason: 'the working tree changed while the analysis ran' }
  else {
    const mappingFile = path.join(cwd, '.qa-kit', 'project', 'change-mapping.md')
    const mapping = parseMapping(existsSync(mappingFile) ? readFileSync(mappingFile, 'utf8') : '')
    const index = loadIndex(cwd, options.indexFile)
    result = decide({ facts, index, mapping, options, cwd })
  }
  const written = writeSelection(cwd, result, meta)
  return { result: written, screen: renderScreen(result) }
}

// Re-checks what is on disk after a run; anything missing, unreadable or stale becomes a full-suite selection.
export function check(cwd, { fallbackReason: hint } = {}) {
  const dir = path.join(cwd, CHANGES_DIR)
  const problems = []
  const run = readJson(path.join(dir, 'run.json'))
  const selection = readJson(path.join(dir, 'selection.json'))
  if (!selection) problems.push('selection.json is missing or unreadable')
  else {
    if (!MODES.includes(selection.mode)) problems.push(`mode "${selection.mode}" is not one of ${MODES.join(', ')}`)
    if (run && selection.runId !== run.runId) problems.push('selection.json belongs to another run')
    if (run && run.treeId !== treeId(cwd)) problems.push('the working tree changed after the analysis started')
    if (selection.mode === 'narrowed') {
      const args = Array.isArray(selection.playwrightArgs) ? selection.playwrightArgs : []
      const files = Array.isArray(selection.files) ? selection.files : []
      if (!files.length) problems.push('a narrowed selection has no files')
      if (files.some(f => !SAFE_PATH.test(f) || !existsSync(path.join(gitRootOf(cwd), f)))) problems.push('a selected file does not exist or has unsafe characters')
      if ((selection.projects ?? []).some(p => !SAFE_PROJECT.test(p))) problems.push('a project name has unsafe characters')
      if (args.some(a => !/^--project=[A-Za-z0-9_.@-]+$/.test(a) && !files.includes(a))) problems.push('playwrightArgs holds something that is not a project flag or a selected file')
      let line = null
      try {
        line = readFileSync(path.join(dir, 'selection.args'), 'utf8').trim()
      } catch {
        problems.push('selection.args is missing')
      }
      if (line !== null && line !== args.join(' ')) problems.push('selection.args does not match playwrightArgs')
    }
  }
  if (!problems.length) return { ok: true, problems, selection }
  const meta = { generatedAt: new Date().toISOString(), runId: run?.runId ?? 'none', treeId: run?.treeId ?? 'none', source: selection?.source }
  const fallbackReason = problems.some(p => /another run|working tree changed/.test(p)) ? 'stale-analysis' : !selection && FALLBACK_REASONS.includes(hint) ? hint : 'invalid-selection'
  const result = { ...decide({ facts: { blocked: true }, index: { ok: true, files: new Map() }, mapping: {}, options: {}, cwd }), fallbackReason, reason: problems.join('; ') }
  writeSelection(cwd, result, meta)
  return { ok: false, problems, selection: result }
}
