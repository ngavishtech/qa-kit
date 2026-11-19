import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { status } from '../../tools/lib/status.mjs'
import { apply } from '../../tools/merge.mjs'

const vars = { KIT_GIT_URL: 'https://example.test/org/qa-kit.git', TEST_SOURCE_DIR: 'tests', PROJECT_NAME: 'p', PRODUCT_NAME: 'p' }
const KIT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

describe('status: everything qa-kit owns, and what git thinks of it', () => {
  let tmp
  const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const write = (rel, text) => { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), text) }
  const install = (repo, agents = ['claude', 'opencode']) => apply({ repo, agents, vars, accept: 'all' })
  const get = (s, path) => s.files.find((f) => f.path === path)

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'qa-kit-status-'))
    g(tmp, 'init', '-q')
    write('app/index.js', 'x\n')
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('lists the state file too, and no base copies: the manifest is in the to-commit list', () => {
    install(tmp)
    const s = status({ repo: tmp, kitRoot: KIT })
    for (const p of ['.qa-kit/manifest.json', 'AGENTS.md', '.qa-kit/project/conventions.md']) {
      assert.ok(s.toStage.includes(p), `${p} should be listed to commit`)
    }
    assert.ok(!s.files.some((f) => f.path.startsWith('.qa-kit/base/')), 'no base copy is owned any more')
    assert.ok(!s.files.some((f) => f.path.startsWith('qa-kit-artifacts/')), 'the self-ignoring artifacts folder is not listed')
    assert.deepEqual(s.ignored, [])
    assert.deepEqual(s.legacy, [])
  })

  it('reports leftover 0.3.x base copies as legacy, never as something to stage or an ignored file', () => {
    install(tmp)
    write('.qa-kit/base/AGENTS.md', 'old copy\n')
    write('.qa-kit/base/.claude/settings.json', '{}\n')
    write('.gitignore', '.qa-kit/base/\n')
    const s = status({ repo: tmp, kitRoot: KIT })
    assert.deepEqual(s.legacy, ['.qa-kit/base/.claude/settings.json', '.qa-kit/base/AGENTS.md'])
    assert.ok(!s.toStage.some((p) => p.startsWith('.qa-kit/base/')))
    assert.ok(!s.ignored.some((p) => p.startsWith('.qa-kit/base/')))
  })

  it('reports files the repo ignores: a folder rule (/.claude) and a file rule at any depth (.mcp.json), as in PR #40', () => {
    write('.gitignore', '/.claude\n.mcp.json\n.qa-kit/manifest.json\n')
    install(tmp)
    const s = status({ repo: tmp, kitRoot: KIT })
    assert.deepEqual(s.ignored.sort(), ['.claude/settings.json', '.mcp.json', '.qa-kit/manifest.json'])

    const folder = get(s, '.claude/settings.json')
    assert.equal(folder.state, 'ignored')
    assert.equal(folder.rule.pattern, '/.claude')
    assert.equal(folder.rule.kind, 'repo')
    assert.equal(folder.rule.viaDirectory, '.claude')
    assert.equal(folder.forceAdd, "git add -f -- ':/.claude/settings.json'")
    // A plain negation cannot work under an ignored folder: the advice must replace the folder rule.
    assert.match(folder.fix, /replace "\/\.claude" .* with "\/\.claude\/\*" and add "!\/\.claude\/settings\.json"/)

    const file = get(s, '.mcp.json')
    assert.equal(file.rule.viaDirectory, null)
    assert.match(file.fix, /add the line "!\/\.mcp\.json" after ".mcp.json"/)
    assert.equal(get(s, '.qa-kit/manifest.json').critical, true, 'a swallowed .qa-kit file is flagged as critical')
    assert.equal(get(s, '.mcp.json').critical, false)
  })

  it('applying the suggested rule edit really un-ignores the file (folder rule and file rule)', () => {
    write('.gitignore', ['/.claude', '.mcp.json', ''].join('\n'))
    install(tmp)
    // The two fixes the report prints, applied literally.
    write('.gitignore', ['/.claude/*', '!/.claude/settings.json', '.mcp.json', '!/.mcp.json', ''].join('\n'))
    const s = status({ repo: tmp, kitRoot: KIT })
    assert.equal(get(s, '.claude/settings.json').state, 'untracked')
    assert.equal(get(s, '.mcp.json').state, 'untracked')
    // ...and the plain negation the first version of the advice gave does not work under an ignored folder.
    write('.gitignore', ['/.claude', '!/.claude/settings.json', ''].join('\n'))
    assert.equal(get(status({ repo: tmp, kitRoot: KIT }), '.claude/settings.json').state, 'ignored')
  })

  it('a hand-forced ignored file counts as tracked afterwards, and later edits show as to-commit', () => {
    write('.gitignore', '/.claude\n.mcp.json\n')
    install(tmp)
    g(tmp, 'add', '-f', '--', ':/.claude/settings.json', ':/.mcp.json')
    let s = status({ repo: tmp, kitRoot: KIT })
    assert.equal(get(s, '.mcp.json').state, 'staged')
    assert.ok(!s.ignored.includes('.mcp.json') && !s.ignored.includes('.claude/settings.json'))
    g(tmp, 'add', '-A')
    g(tmp, 'commit', '-m', 'setup')
    s = status({ repo: tmp, kitRoot: KIT })
    assert.equal(get(s, '.mcp.json').state, 'clean')
    assert.deepEqual(s.ignored, [], 'nothing qa-kit owns is left ignored')
    write('.mcp.json', '{"mcpServers":{}}\n')
    s = status({ repo: tmp, kitRoot: KIT })
    assert.equal(get(s, '.mcp.json').state, 'modified')
    assert.ok(s.toStage.includes('.mcp.json'))
  })

  it('a clean, fully committed install reports nothing to do - also on a re-run after an update with no changes', () => {
    write('.gitignore', 'node_modules/\n')
    install(tmp)
    g(tmp, 'add', '-A')
    g(tmp, 'commit', '-m', 'setup')
    install(tmp)
    const s = status({ repo: tmp, kitRoot: KIT })
    assert.deepEqual(s.toStage, [])
    assert.deepEqual(s.ignored, [])
    assert.deepEqual(s.missing, [])
  })

  it('a rule in .git/info/exclude cannot be fixed in the repo: no rule edit is offered, force-add is', () => {
    write('.git/info/exclude', 'AGENTS.md\n')
    install(tmp)
    const f = get(status({ repo: tmp, kitRoot: KIT }), 'AGENTS.md')
    assert.equal(f.state, 'ignored')
    assert.equal(f.rule.kind, 'local-exclude')
    assert.equal(f.fix, null)
    assert.equal(f.forceAdd, "git add -f -- ':/AGENTS.md'")
  })

  it('in a subfolder install the git paths are root-anchored and only the subfolder is looked at', () => {
    write('.gitignore', '.mcp.json\n')
    const sub = join(tmp, 'automation')
    install(sub, ['claude'])
    write('app/new.js', 'a developer file\n')
    const s = status({ repo: sub, kitRoot: KIT })
    assert.equal(s.offset, 'automation/')
    assert.ok(s.toStage.includes('AGENTS.md'))
    assert.ok(!s.toStage.some((p) => p.includes('app/')))
    const f = get(s, '.mcp.json')
    assert.equal(f.state, 'ignored')
    assert.equal(f.forceAdd, "git add -f -- ':/automation/.mcp.json'")
    assert.match(f.fix, /add the line "!\/automation\/\.mcp\.json"/)
  })

  it('includes an extra file such as the CI workflow that sits outside the project folder', () => {
    const sub = join(tmp, 'automation')
    install(sub, ['claude'])
    write('.github/workflows/run-tests.yml', 'name: x\n')
    const s = status({ repo: sub, kitRoot: KIT, extra: ['../.github/workflows/run-tests.yml'] })
    const f = s.files.find((x) => x.role === 'extra')
    assert.equal(f.rootPath, '.github/workflows/run-tests.yml')
    assert.equal(f.state, 'untracked')
    assert.ok(s.toStage.includes('../.github/workflows/run-tests.yml'))
  })

  it('names owned config files that are missing (for example a file the user declined at the review gate)', () => {
    apply({ repo: tmp, agents: ['claude'], vars, accept: ['AGENTS.md'] })
    const s = status({ repo: tmp, kitRoot: KIT })
    assert.ok(s.missing.includes('.mcp.json'))
    assert.ok(!s.missing.includes('AGENTS.md'))
  })

  it('outside a git repository it still lists the files and says so', () => {
    const plain = mkdtempSync(join(tmpdir(), 'qa-kit-status-plain-'))
    try {
      install(plain)
      const s = status({ repo: plain, kitRoot: KIT })
      assert.equal(s.git, false)
      assert.ok(s.files.length > 5)
      assert.deepEqual(s.toStage, [])
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
})
