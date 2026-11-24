import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { main } from '../../runner/select-gate.mjs'
import { begin, buildIndex, check, classifyPath, finalize, globToRegExp, parseMapping } from '../../runner/lib/select-gate.mjs'
import { finishChangeRun, startChangeRun } from '../../runner/lib/state.mjs'
import { commit, makeRepo, write } from './helpers.mjs'

// ---- fixtures ----------------------------------------------------------------------------------------------------------------

const SPECS = {
  'tests/orders/list.spec.ts': { project: 'chromium', tags: ['orders', 'smoke'] },
  'tests/orders/export.spec.ts': { project: 'chromium', tags: ['orders'] },
  'tests/billing/invoice.spec.ts': { project: 'chromium', tags: ['billing', 'smoke'] },
  'tests/auth/login.spec.ts': { project: 'chromium', tags: ['auth'] },
  'tests/misc/a.spec.ts': { project: 'chromium', tags: [] },
}

function rawIndex(repo, specs = SPECS) {
  const rootDir = realpathSync.native(repo)
  return {
    config: { rootDir },
    suites: Object.entries(specs).map(([file, { project, tags }]) => ({
      title: file,
      file,
      suites: [],
      specs: [{ title: `works ${tags.map(t => `@${t}`).join(' ')}`, file, tags, tests: [{ projectName: project }] }],
    })),
  }
}

function setup(t, { specs = SPECS, mapping, dirty } = {}) {
  const repo = makeRepo(t)
  for (const file of Object.keys(specs)) commit(repo, file, 'test\n')
  dirty?.(repo)
  if (mapping) {
    commit(repo, '.qa-kit/project/change-mapping.md', mapping)
  }
  const run = begin(repo)
  const indexFile = path.join(repo, 'qa-kit-artifacts', 'changes', 'test-index.json')
  writeFileSync(indexFile, JSON.stringify(rawIndex(repo, specs)))
  return { repo, run, indexFile }
}

const unit = (file, extra = {}) => ({ path: file, status: 'modified', kind: 'ui', inference: { features: [], files: [] }, ...extra })
const facts = (units, source = { kind: 'branch', base: 'main', head: null, verified: true }) => ({ source, units, blocked: false })

function decideWith(env, factsObject, options = {}) {
  write(env.repo, 'qa-kit-artifacts/changes/changes.json', JSON.stringify(factsObject))
  return finalize(env.repo, { indexFile: env.indexFile, ...options }).result
}

const inferred = (files, features = []) => ({ inference: { files, features, reasons: ['test'] } })

// ---- globs, paths, mapping, index ---------------------------------------------------------------------------------------------

test('globs use one fixed dialect', () => {
  assert.ok(globToRegExp('src/orders/**').test('src/orders/a/b.ts'))
  assert.ok(!globToRegExp('src/orders/*').test('src/orders/a/b.ts'))
  assert.ok(globToRegExp('src/orders/*.ts').test('src/orders/a.ts'))
  assert.ok(globToRegExp('**/*.json').test('a/b/c.json'))
  assert.ok(globToRegExp('*.json').test('deep/er/x.json'), 'no slash: matches the file name anywhere')
  assert.ok(!globToRegExp('src/*.json').test('other/src/x.json'), 'a slash anchors it at the root')
  assert.ok(globToRegExp('src/{a,b}/x.ts').test('src/b/x.ts'))
  assert.ok(!globToRegExp('src/orders/x.ts').test('src/ordersXx.ts'))
})

test('paths are classified by rule, not by what the agent said, and a spec is never global', () => {
  for (const file of ['package.json', 'yarn.lock', 'playwright.config.ts', 'tsconfig.build.json', '.github/workflows/ci.yml', 'pom.xml', 'go.mod', 'requirements.txt', 'Dockerfile', 'db/migrations/001.sql', 'src/i18n/en.json', '.env.staging', 'tests/auth.setup.ts', 'infra/main.tf']) {
    assert.equal(classifyPath(file), 'global', file)
  }
  for (const file of ['README.md', 'docs/guide/a.md', 'LICENSE', '.github/ISSUE_TEMPLATE/bug.md', 'CHANGELOG.md']) assert.equal(classifyPath(file), 'docs', file)
  for (const file of ['src/notes.md', 'content/terms.txt', 'src/orders/List.tsx', 'tests/i18n/locale.spec.ts']) assert.equal(classifyPath(file), 'other', file)
  const mapping = parseMapping('- **Global paths**:\n  - `config/flags.yaml`\n- **Ignorable paths**:\n  - `**/*.snap`\n')
  assert.equal(classifyPath('config/flags.yaml', mapping), 'global')
  assert.equal(classifyPath('src/a.snap', mapping), 'docs')
})

test('the mapping file is parsed without its schema examples or placeholders', () => {
  const text = readFileSync(new URL('../../templates/project/change-mapping.md', import.meta.url), 'utf8')
  const empty = parseMapping(text)
  assert.deepEqual(empty.features, [])
  assert.deepEqual(empty.global, [])
  assert.equal(empty.threshold, 60)
  const mapping = parseMapping(
    [
      '- **Full-run threshold**: `40` - percent',
      '- **App repos**: `org/orders`, `org/billing`',
      '- **Shared paths**: `src/platform/**`',
      '',
      '## Feature Mappings',
      '### ORDERS',
      '- **App paths**: `org/orders:src/orders/**`, `src/shared-orders/**` (notes)',
      '- **Spec folders**: `tests/orders`',
      '### BILLING',
      '_Unmapped - nothing yet._',
    ].join('\n'),
  )
  assert.equal(mapping.threshold, 40)
  assert.deepEqual(mapping.repos, ['org/orders', 'org/billing'])
  assert.deepEqual(mapping.shared, ['src/platform/**'])
  assert.deepEqual(mapping.features, [{ name: 'ORDERS', appPaths: ['org/orders:src/orders/**', 'src/shared-orders/**'], specFolders: ['tests/orders'], unmapped: false }])
})

test('the test index is normalized to git-root paths, with projects and tags from the field and from titles', t => {
  const repo = makeRepo(t)
  const rootDir = path.join(realpathSync.native(repo), 'automation', 'tests')
  const raw = {
    config: { rootDir },
    suites: [
      { title: 'orders/list.spec.ts', file: 'orders/list.spec.ts', specs: [], suites: [{ title: 'List @orders', specs: [{ title: 'rows @smoke', tags: ['@regression'], tests: [{ projectName: 'chromium' }, { projectName: 'api' }] }] }] },
    ],
  }
  const index = buildIndex(raw, { gitRoot: realpathSync.native(repo) })
  assert.ok(index.ok)
  assert.ok(index.tagsAvailable)
  const entry = index.files.get('automation/tests/orders/list.spec.ts')
  assert.deepEqual([...entry.projects].sort(), ['api', 'chromium'])
  assert.deepEqual([...entry.tags].sort(), ['orders', 'regression', 'smoke'])
})

test('tags written only in titles still count as an index with tags, and an index with none does not', t => {
  const gitRoot = realpathSync.native(makeRepo(t))
  const titled = { config: { rootDir: gitRoot }, suites: [{ file: 'a.spec.ts', specs: [{ title: 'rows @smoke', tests: [{ projectName: 'chromium' }] }] }] }
  const bare = { config: { rootDir: gitRoot }, suites: [{ file: 'a.spec.ts', specs: [{ title: 'rows', tests: [{ projectName: 'chromium' }] }] }] }
  assert.equal(buildIndex(titled, { gitRoot }).tagsAvailable, true)
  assert.equal(buildIndex(bare, { gitRoot }).tagsAvailable, false)
})

// ---- the decision ------------------------------------------------------------------------------------------------------------

test('a verified empty change set runs nothing and says no scope was identified', t => {
  const env = setup(t)
  const result = decideWith(env, facts([]))
  assert.equal(result.mode, 'none')
  assert.equal(result.noneReason, 'no-changes')
  assert.match(readFileSync(path.join(env.repo, 'qa-kit-artifacts/changes/selection.md'), 'utf8'), /no scope identified/)
  assert.equal(readFileSync(path.join(env.repo, 'qa-kit-artifacts/changes/selection.args'), 'utf8').trim(), '')
})

test('an empty change set that git does not confirm is not "nothing changed"', t => {
  const env = setup(t, { dirty: repo => write(repo, 'src/new.ts', 'x\n') })
  const missed = decideWith(env, facts([]))
  assert.equal(missed.mode, 'full')
  assert.equal(missed.fallbackReason, 'analysis-incomplete')

  const pr = setup(t)
  const unverifiable = decideWith(pr, facts([], { kind: 'pr', prs: ['org/app#5'] }))
  assert.equal(unverifiable.mode, 'full')
  assert.equal(unverifiable.fallbackReason, 'unverified-source')

  const badBase = setup(t)
  assert.equal(decideWith(badBase, facts([], { kind: 'branch', base: 'no-such-branch', head: null })).fallbackReason, 'unverified-source')
  assert.equal(decideWith(badBase, facts([], { kind: 'branch', base: '--output=x', head: null })).fallbackReason, 'unverified-source')
})

test('a global change, whatever the agent called it, is the full suite', t => {
  const env = setup(t)
  for (const [file, kind] of [['package.json', 'config-infra'], ['playwright.config.ts', 'ui'], ['Dockerfile', 'ignorable'], ['src/x.ts', 'weird-new-kind']]) {
    const result = decideWith(env, facts([unit(file, { kind, ...inferred(['tests/orders/list.spec.ts']) })]))
    assert.equal(result.mode, 'full', file)
    assert.equal(result.fallbackReason, 'global-change', file)
  }
})

test('only documentation-like files give none, and a source file called ignorable by the agent does not', t => {
  const env = setup(t)
  const docs = decideWith(env, facts([unit('README.md', { kind: 'ignorable' }), unit('docs/a.md', { kind: 'ignorable' })]))
  assert.equal(docs.mode, 'none')
  assert.equal(docs.noneReason, 'docs-only')
  const refused = decideWith(env, facts([unit('src/content/terms.md', { kind: 'ignorable' })]))
  assert.equal(refused.mode, 'full')
  assert.match(refused.warnings.join(' '), /not on the docs allowlist/)
})

test('two sources that agree narrow the run, add the smoke specs of the affected features, and write the args line', t => {
  const mapping = ['## Feature Mappings', '### ORDERS', '- **App paths**: `src/orders/**`', '- **Spec folders**: `tests/orders`'].join('\n')
  const env = setup(t, { mapping })
  const result = decideWith(env, facts([unit('src/orders/List.tsx', inferred(['tests/orders/list.spec.ts'], ['orders']))]))
  assert.equal(result.mode, 'narrowed')
  assert.equal(result.confidence, 'high')
  assert.deepEqual(result.files, ['tests/orders/export.spec.ts', 'tests/orders/list.spec.ts'])
  assert.deepEqual(result.playwrightArgs, ['--project=chromium', 'tests/orders/export.spec.ts', 'tests/orders/list.spec.ts'])
  assert.equal(readFileSync(path.join(env.repo, 'qa-kit-artifacts/changes/selection.args'), 'utf8').trim(), result.playwrightArgs.join(' '))
  assert.deepEqual(result.perFile.find(f => f.file === 'tests/orders/list.spec.ts').sources.sort(), ['inference', 'mapping'])
  assert.deepEqual(check(env.repo).ok, true)
})

test('smoke specs of an affected feature are added unless --no-smoke, and only from the same feature', t => {
  const env = setup(t)
  const single = unit('src/billing/Invoice.tsx', inferred(['tests/billing/invoice.spec.ts'], ['billing']))
  assert.deepEqual(decideWith(env, facts([single])).files, ['tests/billing/invoice.spec.ts'])
  const orders = unit('src/orders/Export.tsx', inferred(['tests/orders/export.spec.ts'], ['orders']))
  assert.deepEqual(decideWith(env, facts([orders])).files, ['tests/orders/export.spec.ts', 'tests/orders/list.spec.ts'])
  assert.deepEqual(decideWith(env, facts([orders]), { smoke: false }).files, ['tests/orders/export.spec.ts'])
})

test('one source is medium and still narrows, and --min-confidence=high makes it the full suite', t => {
  const env = setup(t)
  const one = facts([unit('src/billing/Invoice.tsx', inferred(['tests/billing/invoice.spec.ts'], ['billing']))])
  assert.equal(decideWith(env, one).mode, 'narrowed')
  assert.equal(decideWith(env, one).confidence, 'medium')
  const strict = decideWith(env, one, { minConfidence: 'high' })
  assert.equal(strict.mode, 'full')
  assert.equal(strict.fallbackReason, 'low-confidence')
})

test('no test found, disagreement, shared code and a support file nobody reads are all the full suite', t => {
  const mapping = ['## Feature Mappings', '### ORDERS', '- **App paths**: `src/orders/**`', '- **Spec folders**: `tests/orders`'].join('\n')
  const env = setup(t, { mapping })
  const cases = [
    ['nothing found', unit('src/unknown/Thing.tsx'), 'no-candidates'],
    ['disagreement', unit('src/orders/List.tsx', inferred(['tests/billing/invoice.spec.ts'], ['billing'])), 'low-confidence'],
    ['shared code', unit('src/shared/Button.tsx', inferred(['tests/orders/list.spec.ts'], ['orders'])), 'low-confidence'],
    ['wide support change', unit('tests/support/page.ts', { kind: 'shared-test-support', wide: true, ...inferred(['tests/orders/list.spec.ts']) }), 'low-confidence'],
    ['data file with no reader', unit('tests/data/users.json', { kind: 'test-only' }), 'no-candidates'],
  ]
  for (const [name, u, reason] of cases) {
    const result = decideWith(env, facts([u]))
    assert.equal(result.mode, 'full', name)
    assert.equal(result.fallbackReason, reason, name)
  }
})

test('one weak change makes the whole run the full suite', t => {
  const env = setup(t)
  const result = decideWith(env, facts([unit('src/billing/Invoice.tsx', inferred(['tests/billing/invoice.spec.ts'], ['billing'])), unit('src/unknown/Thing.tsx')]))
  assert.equal(result.mode, 'full')
})

test('a changed spec runs itself, and deleting only specs runs nothing', t => {
  const env = setup(t)
  const own = decideWith(env, facts([unit('tests/auth/login.spec.ts', { kind: 'test-only' })]))
  assert.equal(own.mode, 'narrowed')
  assert.deepEqual(own.files, ['tests/auth/login.spec.ts'])
  const gone = decideWith(env, facts([unit('tests/old/removed.spec.ts', { kind: 'test-only', status: 'deleted' })]))
  assert.equal(gone.mode, 'none')
  assert.equal(gone.noneReason, 'only-deletions')
})

test('project names are checked, an empty one is left out, and a wide selection is the full suite', t => {
  const spaced = { 'tests/a.spec.ts': { project: 'Mobile Chrome', tags: [] }, 'tests/b.spec.ts': { project: 'chromium', tags: [] }, 'tests/c.spec.ts': { project: 'chromium', tags: [] }, 'tests/d.spec.ts': { project: 'chromium', tags: [] } }
  const env = setup(t, { specs: spaced })
  const unsafe = decideWith(env, facts([unit('src/a.ts', inferred(['tests/a.spec.ts']))]))
  assert.equal(unsafe.mode, 'full')
  assert.equal(unsafe.fallbackReason, 'unsafe-path')

  const noProject = { 'tests/a.spec.ts': { project: '', tags: [] }, 'tests/b.spec.ts': { project: '', tags: [] }, 'tests/c.spec.ts': { project: '', tags: [] }, 'tests/d.spec.ts': { project: '', tags: [] }, 'tests/e.spec.ts': { project: '', tags: [] } }
  const bare = setup(t, { specs: noProject })
  assert.deepEqual(decideWith(bare, facts([unit('src/a.ts', inferred(['tests/a.spec.ts']))])).playwrightArgs, ['tests/a.spec.ts'])

  const wide = setup(t, { specs: spaced })
  const many = decideWith(wide, facts([unit('src/b.ts', inferred(['tests/b.spec.ts', 'tests/c.spec.ts', 'tests/d.spec.ts']))]))
  assert.equal(many.fallbackReason, 'wide-selection')
  assert.equal(decideWith(wide, facts([unit('src/b.ts', inferred(['tests/b.spec.ts', 'tests/c.spec.ts', 'tests/d.spec.ts']))]), { threshold: 90 }).mode, 'narrowed')
})

test('files the index does not know are dropped from the inference, with a warning', t => {
  const env = setup(t)
  const result = decideWith(env, facts([unit('src/billing/Invoice.tsx', inferred(['tests/billing/invoice.spec.ts', 'tests/ghost.spec.ts'], ['billing']))]))
  assert.deepEqual(result.files, ['tests/billing/invoice.spec.ts'])
  assert.match(result.warnings.join(' '), /not in the test index/)
})

test('a blocked or missing analysis, an unreadable index and a changed tree are the full suite', t => {
  const env = setup(t)
  assert.equal(decideWith(env, { blocked: true, blockReason: 'gh is not authenticated' }).fallbackReason, 'analysis-unavailable')
  assert.equal(decideWith(env, { units: 'nope' }).fallbackReason, 'analysis-unavailable')

  const broken = setup(t)
  writeFileSync(broken.indexFile, '{"suites": []}')
  write(broken.repo, 'qa-kit-artifacts/changes/changes.json', JSON.stringify(facts([unit('src/a.ts')])))
  assert.equal(finalize(broken.repo, { indexFile: broken.indexFile }).result.fallbackReason, 'index-unavailable')

  const moved = setup(t)
  write(moved.repo, 'qa-kit-artifacts/changes/changes.json', JSON.stringify(facts([unit('src/billing/Invoice.tsx', inferred(['tests/billing/invoice.spec.ts'], ['billing']))])))
  write(moved.repo, 'src/edited-while-running.ts', 'x\n')
  const result = finalize(moved.repo, { indexFile: moved.indexFile }).result
  assert.equal(result.mode, 'full')
  assert.equal(result.fallbackReason, 'stale-analysis')

  const noRun = makeRepo(t)
  write(noRun, 'qa-kit-artifacts/changes/changes.json', JSON.stringify(facts([])))
  assert.equal(finalize(noRun, {}).result.fallbackReason, 'analysis-unavailable')
})

// ---- begin, check, command line ----------------------------------------------------------------------------------------------

test('begin removes what an earlier run left, so a stale selection can never be read', t => {
  const env = setup(t)
  decideWith(env, facts([unit('src/billing/Invoice.tsx', inferred(['tests/billing/invoice.spec.ts'], ['billing']))]))
  assert.ok(existsSync(path.join(env.repo, 'qa-kit-artifacts/changes/selection.json')))
  const next = begin(env.repo)
  assert.notEqual(next.runId, env.run.runId)
  for (const name of ['selection.json', 'selection.md', 'selection.args', 'changes.json']) assert.ok(!existsSync(path.join(env.repo, 'qa-kit-artifacts/changes', name)), name)
  assert.ok(existsSync(path.join(env.repo, 'qa-kit-artifacts/changes/run.json')))
})

test('check accepts a valid selection and rewrites a missing, tampered, foreign or stale one as the full suite', t => {
  const env = setup(t)
  const valid = facts([unit('src/billing/Invoice.tsx', inferred(['tests/billing/invoice.spec.ts'], ['billing']))])
  decideWith(env, valid)
  assert.equal(check(env.repo).ok, true)

  const selectionFile = path.join(env.repo, 'qa-kit-artifacts/changes/selection.json')
  const original = readFileSync(selectionFile, 'utf8')

  const tamper = (change, expectReason) => {
    writeFileSync(selectionFile, JSON.stringify(change(JSON.parse(original))))
    const outcome = check(env.repo)
    assert.equal(outcome.ok, false)
    const after = JSON.parse(readFileSync(selectionFile, 'utf8'))
    assert.equal(after.mode, 'full')
    assert.equal(after.fallbackReason, expectReason)
    assert.equal(readFileSync(path.join(env.repo, 'qa-kit-artifacts/changes/selection.args'), 'utf8').trim(), '')
  }
  tamper(s => ({ ...s, playwrightArgs: ['--project=chromium', 'tests/billing/invoice.spec.ts', '; rm -rf /'] }), 'invalid-selection')
  tamper(s => ({ ...s, files: ['tests/does-not-exist.spec.ts'], playwrightArgs: ['tests/does-not-exist.spec.ts'] }), 'invalid-selection')
  tamper(s => ({ ...s, mode: 'everything' }), 'invalid-selection')
  tamper(s => ({ ...s, runId: 'someone-elses' }), 'stale-analysis')

  rmFile(selectionFile)
  const missing = check(env.repo)
  assert.equal(missing.ok, false)
  assert.equal(JSON.parse(readFileSync(selectionFile, 'utf8')).mode, 'full')
})

function rmFile(file) {
  writeFileSync(file, '')
  assert.equal(readFileSync(file, 'utf8'), '')
  import('node:fs').then(fs => fs.rmSync(file, { force: true }))
}

test('the command line prints one JSON line and fails on bad arguments', t => {
  const env = setup(t)
  write(env.repo, 'qa-kit-artifacts/changes/changes.json', JSON.stringify(facts([unit('src/billing/Invoice.tsx', inferred(['tests/billing/invoice.spec.ts'], ['billing']))])))
  const lines = []
  assert.equal(main(['finalize', '--cwd', env.repo, '--index-file', env.indexFile, '--min-confidence=high'], line => lines.push(line)), 0)
  const out = JSON.parse(lines[0])
  assert.equal(out.mode, 'full')
  assert.equal(out.fallbackReason, 'low-confidence')
  assert.match(out.screen, /^Selection: full/)
  assert.equal(out.selectionFile, 'qa-kit-artifacts/changes/selection.json')

  const quiet = []
  assert.equal(main(['check', '--cwd', env.repo], line => quiet.push(line)), 0)
  assert.equal(JSON.parse(quiet[0]).ok, true)
  const realError = console.error
  console.error = () => {}
  try {
    assert.equal(main(['finalize', '--threshold=0'], () => {}), 1)
    assert.equal(main(['finalize', '--min-confidence=low'], () => {}), 1)
    assert.equal(main(['explode'], () => {}), 1)
  } finally {
    console.error = realError
  }
})

// ---- the runner hooks --------------------------------------------------------------------------------------------------------

test('the runner starts a change run clean and makes the report say what the selection file says', t => {
  const env = setup(t)
  decideWith(env, facts([unit('src/billing/Invoice.tsx', inferred(['tests/billing/invoice.spec.ts'], ['billing']))]))
  startChangeRun({ workflow: 'feature-select', cwd: env.repo })
  assert.ok(!existsSync(path.join(env.repo, 'qa-kit-artifacts/changes/selection.json')), 'the earlier run is gone')

  const report = [{ task: 'x', mode: 'narrowed', selectedFiles: 99, blocked: false }]
  const warnings = []
  finishChangeRun({ workflow: 'feature-select', args: {}, report, cwd: env.repo, warn: m => warnings.push(m) })
  assert.equal(report[0].mode, 'full', 'no selection was written: the entry cannot claim a narrowed one')
  assert.equal(report[0].fallbackReason, 'invalid-selection')
  assert.equal(report[0].blocked, true)
  assert.equal(report[0].selectedFiles, 0, 'the file is the truth')
  assert.match(warnings.join(' '), /replaced by the full suite/)
})

test('a valid selection is copied into the report entry, and an entry that was already blocked keeps its own reason', t => {
  const env = setup(t)
  startChangeRun({ workflow: 'feature-select', cwd: env.repo })
  write(env.repo, 'qa-kit-artifacts/changes/test-index.json', JSON.stringify(rawIndex(env.repo)))
  write(env.repo, 'qa-kit-artifacts/changes/changes.json', JSON.stringify(facts([unit('src/billing/Invoice.tsx', inferred(['tests/billing/invoice.spec.ts'], ['billing']))])))
  finalize(env.repo, { smoke: false })
  const report = [{ task: 'x', mode: 'full', fallbackReason: 'wrong', blocked: false }]
  finishChangeRun({ workflow: 'feature-select', args: {}, report, cwd: env.repo })
  assert.equal(report[0].mode, 'narrowed')
  assert.equal(report[0].selectedFiles, 1)
  assert.equal(report[0].fallbackReason, undefined)
  assert.equal(report[0].blocked, false)

  const blocked = setup(t)
  startChangeRun({ workflow: 'feature-diff', cwd: blocked.repo })
  const entry = [{ task: 'y', mode: 'full', fallbackReason: 'analysis-unavailable', blocked: true, blockReason: 'gh is not authenticated' }]
  finishChangeRun({ workflow: 'feature-diff', args: {}, report: entry, cwd: blocked.repo })
  assert.equal(entry[0].blockReason, 'gh is not authenticated')
  assert.equal(entry[0].fallbackReason, 'analysis-unavailable')
  assert.equal(JSON.parse(readFileSync(path.join(blocked.repo, 'qa-kit-artifacts/changes/selection.json'), 'utf8')).fallbackReason, 'analysis-unavailable')
})

test('other flows, and feature-diff with --no-select, are left alone', t => {
  const env = setup(t)
  decideWith(env, facts([unit('src/billing/Invoice.tsx', inferred(['tests/billing/invoice.spec.ts'], ['billing']))]))
  startChangeRun({ workflow: 'feature-plan', cwd: env.repo })
  assert.ok(existsSync(path.join(env.repo, 'qa-kit-artifacts/changes/selection.json')))
  const report = [{ task: 'z', blocked: false }]
  finishChangeRun({ workflow: 'feature-diff', args: { select: false }, report, cwd: env.repo })
  assert.deepEqual(report, [{ task: 'z', blocked: false }])
})
