/**
 * Helpers for the Allure report archive on the gh-pages data branch (see publish-allure-report.sh and actions/allure-archive/README.md).
 *
 *   node scripts/allure-index.js summary <file>      writes a run-summary.json from the SUMMARY_* env vars
 *   node scripts/allure-index.js index <pagesDir>    rebuilds <pagesDir>/index.html from every
 *                                                    <environment>/<run>/run-summary.json
 *   node scripts/allure-index.js prune <pagesDir> <keepDays> [keepRuns]
 *                                                    removes run folders older than keepDays (0 = no age limit),
 *                                                    then trims each environment to its newest keepRuns (0 = no
 *                                                    cap); an environment left with no runs is removed entirely
 *
 * Layout it expects under <pagesDir>:  <environment>/latest/  and  <environment>/<run number>/
 */
const fs = require('fs')
const path = require('path')

const RUN_FOLDER = /^\d+$/
const LATEST_FOLDER = 'latest'
const SUMMARY_FILE = 'run-summary.json'

const COUNT_FIELDS = ['total', 'passed', 'failed', 'broken', 'skipped']

// Heading of the landing page; set INDEX_TITLE in the publishing step (default: a generic title).
const TITLE = process.env.INDEX_TITLE || 'E2E'

function writeSummary(file) {
  const env = process.env
  const count = (value) => (/^\d+$/.test(value ?? '') ? Number(value) : null)
  const summary = {
    environment: env.SUMMARY_ENVIRONMENT ?? '',
    run: Number(env.SUMMARY_RUN),
    attempt: Number(env.SUMMARY_ATTEMPT || 1),
    date: env.SUMMARY_DATE || new Date().toISOString(), // SUMMARY_DATE is only for fabricating old runs in tests
    branch: env.SUMMARY_BRANCH ?? '',
    trigger: env.SUMMARY_TRIGGER ?? '',
    scope: env.SUMMARY_SCOPE ?? '',
    successRate: env.SUMMARY_SUCCESS_RATE ?? 'N/A',
    runUrl: env.SUMMARY_RUN_URL ?? '',
  }
  for (const field of COUNT_FIELDS) {
    summary[field] = count(env[`SUMMARY_${field.toUpperCase()}`])
  }
  fs.writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`)
}

function readSummary(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function listDirs(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
}

function collect(pagesDir) {
  const runs = []
  const latest = []
  for (const environment of listDirs(pagesDir)) {
    const envDir = path.join(pagesDir, environment)
    for (const folder of listDirs(envDir)) {
      const summary = readSummary(path.join(envDir, folder, SUMMARY_FILE))
      if (!summary) continue
      if (folder === LATEST_FOLDER) latest.push({ environment, summary })
      else if (RUN_FOLDER.test(folder)) runs.push({ environment, folder, summary })
    }
  }
  runs.sort((a, b) => String(b.summary.date).localeCompare(String(a.summary.date)))
  latest.sort((a, b) => a.environment.localeCompare(b.environment))
  return { runs, latest }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

function isHttps(url) {
  return typeof url === 'string' && url.startsWith('https://')
}

function link(href, text) {
  return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
}

function count(value) {
  return value === null || value === undefined ? '–' : String(value)
}

function rowClass(summary) {
  if (summary.failed > 0 || summary.broken > 0) return 'bad'
  return summary.total === null ? 'unknown' : 'good'
}

function runRow({ environment, folder, summary }) {
  const ci = isHttps(summary.runUrl) ? link(summary.runUrl, 'logs') : ''
  return `<tr class="${rowClass(summary)}">
  <td>${link(`${encodeURIComponent(environment)}/${folder}/`, `#${folder}`)}</td>
  <td>${escapeHtml(environment)}</td>
  <td>${escapeHtml(String(summary.date).replace('T', ' ').slice(0, 16))}</td>
  <td>${escapeHtml(summary.branch)}</td>
  <td>${escapeHtml(summary.trigger)}</td>
  <td>${escapeHtml(summary.scope)}</td>
  <td class="num">${count(summary.passed)}</td>
  <td class="num">${count(summary.failed)}</td>
  <td class="num">${count(summary.broken)}</td>
  <td class="num">${count(summary.skipped)}</td>
  <td class="num">${escapeHtml(summary.successRate)}</td>
  <td>${ci}</td>
</tr>`
}

function renderIndex({ runs, latest }) {
  const latestLinks = latest
    .map(
      ({ environment, summary }) =>
        `<li>${link(`${encodeURIComponent(environment)}/${LATEST_FOLDER}/`, environment)} <span>(run #${escapeHtml(summary.run)}, ${escapeHtml(String(summary.date).slice(0, 10))})</span></li>`
    )
    .join('\n')
  const body = runs.length
    ? runs.map(runRow).join('\n')
    : '<tr><td colspan="12">No archived runs yet.</td></tr>'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(TITLE)} - Allure reports</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 2rem auto; max-width: 78rem; padding: 0 1rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: .35rem .6rem; text-align: left; border-bottom: 1px solid #8884; white-space: nowrap; }
  td:nth-child(6) { white-space: normal; }
  .num { text-align: right; }
  tr.bad td:nth-child(8), tr.bad td:nth-child(9) { font-weight: 600; color: #d92121; }
  tr.good td:nth-child(11) { color: #2a8a46; }
  li span { opacity: .65; }
</style>
</head>
<body>
<h1>${escapeHtml(TITLE)} - Allure reports</h1>
<h2>Latest per environment</h2>
<ul>
${latestLinks || '<li>None yet.</li>'}
</ul>
<h2>All runs (newest first)</h2>
<table>
<thead><tr><th>Run</th><th>Environment</th><th>Date (UTC)</th><th>Branch</th><th>Trigger</th><th>Scope</th><th class="num">Passed</th><th class="num">Failed</th><th class="num">Broken</th><th class="num">Skipped</th><th class="num">Pass rate</th><th>CI</th></tr></thead>
<tbody>
${body}
</tbody>
</table>
</body>
</html>
`
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Applies retention across ALL environments, so one that stopped running still ages out.
 * The run date comes from run-summary.json (file times mean nothing in git); a run folder without a
 * readable summary is never removed. An environment with no run folders left loses its latest/ as well.
 */
function prune(pagesDir, keepDays, keepRuns) {
  const cutoff = keepDays > 0 ? Date.now() - keepDays * MS_PER_DAY : null
  const remove = (dir, reason) => {
    console.log(`Pruning ${path.relative(pagesDir, dir)} (${reason})`)
    fs.rmSync(dir, { recursive: true, force: true })
  }

  for (const environment of listDirs(pagesDir)) {
    const envDir = path.join(pagesDir, environment)
    // Only a folder holding latest/ or numeric run folders is an environment; leave anything else alone.
    const entries = listDirs(envDir)
    if (!entries.includes(LATEST_FOLDER) && !entries.some((name) => RUN_FOLDER.test(name))) continue
    const dated = []
    for (const folder of listDirs(envDir).filter((name) => RUN_FOLDER.test(name))) {
      const time = Date.parse(readSummary(path.join(envDir, folder, SUMMARY_FILE))?.date)
      if (Number.isNaN(time)) continue
      if (cutoff !== null && time < cutoff) remove(path.join(envDir, folder), `older than ${keepDays} days`)
      else dated.push({ folder, time })
    }
    if (keepRuns > 0) {
      dated.sort((a, b) => b.time - a.time)
      for (const { folder } of dated.slice(keepRuns)) {
        remove(path.join(envDir, folder), `beyond the newest ${keepRuns} runs`)
      }
    }

    const remaining = listDirs(envDir)
    if (!remaining.some((name) => RUN_FOLDER.test(name)) && remaining.every((name) => name === LATEST_FOLDER)) {
      remove(envDir, 'no runs left')
    }
  }
}

function main() {
  const [command, target, ...rest] = process.argv.slice(2)
  if (command === 'summary' && target) return writeSummary(target)
  if (command === 'index' && target) {
    return fs.writeFileSync(path.join(target, 'index.html'), renderIndex(collect(target)))
  }
  if (command === 'prune' && target && /^\d+$/.test(rest[0] ?? '') && /^\d*$/.test(rest[1] ?? '')) {
    return prune(target, Number(rest[0]), Number(rest[1] || 0))
  }
  console.error('Usage: allure-index.js summary <file> | index <pagesDir> | prune <pagesDir> <keepDays> [keepRuns]')
  process.exit(2)
}

main()
