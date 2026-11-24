import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tryGit } from './git.mjs'
import { begin as beginChanges, check as checkChanges } from './select-gate.mjs'
import { isPlanFile } from './parse.mjs'

const ARTIFACTS = 'qa-kit-artifacts'

export function ensureArtifacts(cwd) {
  const dir = path.join(cwd, ARTIFACTS)
  mkdirSync(dir, { recursive: true })
  const ignoreFile = path.join(dir, '.gitignore')
  if (!existsSync(ignoreFile)) writeFileSync(ignoreFile, '*\n')
  return dir
}

export function saveRun({ cwd, workflow, startedAt, args, report, violations, warnings }) {
  const dir = ensureArtifacts(cwd)
  const stamp = startedAt.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '')
  const runDir = path.join(dir, 'runs', `${stamp}-${workflow}`)
  const latestDir = path.join(dir, 'latest')
  mkdirSync(runDir, { recursive: true })
  mkdirSync(latestDir, { recursive: true })
  const envelope = JSON.stringify({ workflow, startedAt: startedAt.toISOString(), args, report, violations, warnings }, null, 2)
  writeFileSync(path.join(runDir, 'report.json'), envelope)
  writeFileSync(path.join(latestDir, `${workflow}.json`), envelope)
  return runDir
}

function loadReport(cwd, workflow) {
  const file = path.join(cwd, ARTIFACTS, 'latest', `${workflow}.json`)
  if (!existsSync(file)) return []
  try {
    return JSON.parse(readFileSync(file, 'utf8')).report
  } catch {
    throw new Error(`${ARTIFACTS}/latest/${workflow}.json is not a valid qa-kit report: delete it or name the inputs explicitly`)
  }
}

export function baselineChangesOf(entry) {
  return entry.baselineChanges ?? entry.history?.find(step => step.stage === 'write')?.baselineChanges ?? []
}

export function readTestType(planText) {
  const declared = /^\*\*Test Type\*\*:\s*(ui|api|both)\b/im.exec(planText)
  if (declared) return declared[1].toLowerCase()
  const types = [...planText.matchAll(/^Type:\s*(.+)$/gim)].map(match => match[1])
  const hasApi = types.some(line => /\bAPI\b/.test(line))
  const hasUi = types.some(line => /\bUI\b/.test(line))
  if (hasApi && hasUi) return 'both'
  if (hasApi) return 'api'
  if (hasUi) return 'ui'
  throw new Error('cannot tell the plan test type: add a "**Test Type**: ui | api | both" line to it')
}

function planFromFile(item, cwd) {
  const file = path.resolve(cwd, item)
  if (!existsSync(file)) throw new Error(`plan file not found: ${item}`)
  return { task: path.basename(item), planPath: item, testType: readTestType(readFileSync(file, 'utf8')) }
}

function resolvePlan(item, known, cwd) {
  if (isPlanFile(item)) {
    const entry = known.find(plan => path.basename(plan.planPath) === path.basename(item))
    return entry ?? planFromFile(item, cwd)
  }
  const matches = known.filter(plan => plan.task?.includes(item))
  if (matches.length !== 1) throw new Error(`'${item}' matches ${matches.length} planned features: name the plan file instead`)
  return matches[0]
}

export function ownedFilesOf(entry) {
  return Array.isArray(entry?.ownedFiles) ? entry.ownedFiles : []
}

// A run that does not commit leaves its files uncommitted. The latest feature-implement entry for the same plan says which
// files the pipeline itself produced, so the next run does not take them for the user's own changes.
function withPriorOwned(plans, cwd) {
  const previous = loadReport(cwd, 'feature-implement')
  return plans.map(plan => {
    const entry = previous.find(item => (item.planPath ? path.basename(item.planPath) === path.basename(plan.planPath) : item.task === plan.task))
    const priorOwned = ownedFilesOf(entry)
    return priorOwned.length ? { ...plan, priorOwned } : plan
  })
}

function resolvePlans(items, cwd) {
  const known = loadReport(cwd, 'feature-plan')
    .filter(entry => !entry.blocked && entry.planPath)
    .map(({ task, planPath, testType }) => ({ task, planPath, testType }))
  if (items.length) return withPriorOwned(items.map(item => resolvePlan(item, known, cwd)), cwd)
  if (!known.length) throw new Error(`no approved plans: run feature-plan first or name a plan file (${ARTIFACTS}/<name>-test-plan.md)`)
  return withPriorOwned(known, cwd)
}

function currentTarget(cwd) {
  const branch = tryGit(cwd, ['branch', '--show-current'])
  if (!branch) throw new Error('no targets to deliver: run feature-implement first, name a target, or check out the branch to deliver')
  return { branch, worktreePath: cwd }
}

function resolveTarget(item, known) {
  const matches = known.filter(target => target.branch === item || target.task?.includes(item))
  if (matches.length !== 1) throw new Error(`'${item}' matches ${matches.length} implemented features: name its branch instead`)
  return matches[0]
}

function resolveTargets(items, cwd) {
  const known = loadReport(cwd, 'feature-implement')
    .filter(entry => !entry.blocked && entry.branch && entry.worktreePath)
    .map(entry => ({
      task: entry.task,
      branch: entry.branch,
      worktreePath: entry.worktreePath,
      baselineChanges: baselineChangesOf(entry),
      ...(ownedFilesOf(entry).length ? { ownedFiles: ownedFilesOf(entry) } : {}),
    }))
  if (items.length) return items.map(item => resolveTarget(item, known))
  return known.length ? known : [currentTarget(cwd)]
}

const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/@^~-]*$/
const PR_BARE = /^\d+$/
const PR_QUALIFIED = /^([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)#(\d+)$/
const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)\/pull\/(\d+)\/?$/
export const MAX_REPOS = 10

function isRef(value) {
  return GIT_REF.test(value) && !value.includes('..')
}

// A pull request item becomes `N` (this repo's own GitHub remote) or `org/app#N`. A bare number belongs to the one --repo when
// exactly one was given and is refused when several were (it would be a guess which repo it is meant for).
function normalizePr(item, repos) {
  const url = PR_URL.exec(item)
  if (url) return `${url[1]}#${url[2]}`
  if (PR_QUALIFIED.test(item)) return item
  if (!PR_BARE.test(item)) return null
  if (repos.length > 1) throw new Error(`'${item}' could belong to any of ${repos.join(', ')}: write it as org/app#${item}`)
  return repos.length === 1 ? `${repos[0]}#${item}` : item
}

// The items of feature-diff and feature-select are pull requests (a number, org/app#number or a github.com URL) or `base..head`
// ranges. Everything that later reaches an agent prompt is checked here, so free text can never turn into an instruction.
function resolveChangeSource(workflow, args, items) {
  const seen = new Set()
  const repos = (args.repos ?? []).filter(repo => !seen.has(repo.toLowerCase()) && seen.add(repo.toLowerCase()))
  if (repos.length > MAX_REPOS) throw new Error(`${workflow}: at most ${MAX_REPOS} repositories per run`)
  const prs = []
  const ranges = []
  for (const item of items) {
    const range = /^(.+?)\.{2,3}(.+)$/.exec(item)
    const pr = normalizePr(item, repos)
    if (pr) prs.push(pr)
    else if (range && isRef(range[1]) && isRef(range[2])) ranges.push(item)
    else throw new Error(`${workflow}: '${item}' is not a pull request number, org/app#number, a github.com pull request URL or a base..head range`)
  }
  for (const [flag, value] of [['--base', args.baseRef], ['--head', args.headRef]]) {
    if (value !== undefined && !isRef(value)) throw new Error(`${workflow}: ${flag} is not a plain git ref`)
  }
  const sources = [prs.length + ranges.length > 0, args.since !== undefined, args.baseRef !== undefined || args.headRef !== undefined].filter(Boolean).length
  if (sources > 1) throw new Error(`${workflow}: give one source: pull requests or ranges, --since, or --base/--head`)
  if (repos.length && !prs.length && args.since === undefined) throw new Error(`${workflow}: --repo needs pull requests or --since (it is GitHub only)`)
  const { repos: _given, ...rest } = args
  return { ...rest, ...(repos.length ? { repos } : {}), ...(prs.length ? { prs: [...new Set(prs)] } : {}), ...(ranges.length ? { ranges } : {}) }
}

const CHANGE_FLOWS = ['feature-diff', 'feature-select']

// A run of a change flow starts from a clean qa-kit-artifacts/changes/, so a selection that is present was written by this run.
export function startChangeRun({ workflow, cwd }) {
  if (CHANGE_FLOWS.includes(workflow)) beginChanges(cwd)
}

// After the run the selection on disk is re-checked by code, and the report entry is made to say what the file says (the file is the
// truth, not the agent's summary of it). Anything missing, stale or invalid becomes a full-suite selection and a blocked entry.
export function finishChangeRun({ workflow, args, report, cwd, warn = () => {} }) {
  if (!CHANGE_FLOWS.includes(workflow) || (workflow === 'feature-diff' && args.select === false)) return
  const main = report?.[0]
  const outcome = checkChanges(cwd, { fallbackReason: main?.fallbackReason })
  if (!main) return
  const selection = outcome.selection
  const fields = { mode: selection.mode, fallbackReason: selection.fallbackReason, selectedFiles: selection.totals?.selected, suiteFiles: selection.totals?.suite, confidence: selection.confidence }
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete main[key]
    else main[key] = value
  }
  if (outcome.ok) return
  warn(`the selection was not accepted (${outcome.problems.join('; ')}): it was replaced by the full suite`)
  main.blocked = true
  main.blockReason ??= `selection check failed: ${outcome.problems.join('; ')}`
}

export function resolveInputs({ workflow, args, items, cwd }) {
  if (workflow === 'feature-diff' || workflow === 'feature-select') return resolveChangeSource(workflow, args, items)
  if (workflow === 'feature-implement') return { ...args, plans: resolvePlans(items, cwd) }
  if (workflow === 'feature-deliver') return { ...args, targets: resolveTargets(items, cwd) }
  if (workflow === 'feature-monkey') {
    if (!items.length) throw new Error('feature-monkey needs at least one area: a feature tag, test folder, plan file, route or plain words (quote words that contain spaces)')
    return { ...args, areas: items }
  }
  return args
}
