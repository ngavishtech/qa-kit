import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { locate, resolvePath } from '../../tools/lib/locate.mjs'

describe('locate', () => {
  let tmp, repo
  const dir = (rel) => { const p = join(repo, rel); mkdirSync(p, { recursive: true }); return p }
  const install = (rel) => writeFileSync(join(dir(join(rel, '.qa-kit')), 'manifest.json'), '{}')
  const canon = (p) => realpathSync.native(p).replaceAll('\\', '/') // locate prints forward slashes only

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'qa-kit-locate-'))
    repo = join(tmp, 'repo')
    mkdirSync(repo)
    execFileSync('git', ['init', '-q'], { cwd: repo })
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('at the repo root with nothing installed: installs at the root, no questions', () => {
    const r = locate({ cwd: repo })
    assert.equal(r.projectDir, canon(repo))
    assert.equal(r.gitRoot, canon(repo))
    assert.equal(r.offset, '')
    assert.equal(r.reason, 'repo-root')
    assert.equal(r.needsDecision, undefined)
  })

  it('--path is relative to the folder you run from and reports the offset inside the repo', () => {
    const r = locate({ cwd: repo, path: 'automation' })
    assert.equal(r.projectDir, `${canon(repo)}/automation`)
    assert.ok(![r.cwd, r.gitRoot, r.boundary, r.projectDir].some((p) => p.includes('\\')), 'every path uses forward slashes')
    assert.equal(r.offset, 'automation')
    assert.equal(r.exists, false)
    assert.equal(r.reason, 'path-flag')

    dir('apps')
    assert.equal(locate({ cwd: join(repo, 'apps'), path: 'sub/x' }).offset, 'apps/sub/x')
  })

  it('treats a leading slash or backslash as relative, not absolute (/myfolder/test)', () => {
    assert.equal(locate({ cwd: repo, path: '/myfolder/test' }).offset, 'myfolder/test')
    assert.equal(locate({ cwd: repo, path: '\\myfolder\\test' }).offset, 'myfolder/test')
    assert.equal(locate({ cwd: repo, path: './myfolder//test/' }).offset, 'myfolder/test')
  })

  it('refuses paths that escape the repository, drive letters, home, files and .git', () => {
    assert.throws(() => locate({ cwd: repo, path: '../elsewhere' }), /outside the git repository/)
    assert.throws(() => locate({ cwd: repo, path: 'a/../../x' }), /outside the git repository/)
    assert.throws(() => resolvePath(repo, 'C:\\temp\\x'), /absolute/)
    assert.throws(() => resolvePath(repo, '~/x'), /absolute/)
    assert.throws(() => resolvePath(repo, '  '), /needs a folder/)
    assert.throws(() => resolvePath(repo, 'a/.git/b'), /\.git/)
    writeFileSync(join(repo, 'afile'), 'x')
    assert.throws(() => locate({ cwd: repo, path: 'afile' }), /is a file/)
  })

  it('with --path=. the project folder is the folder you are in', () => {
    dir('automation')
    const r = locate({ cwd: join(repo, 'automation'), path: '.' })
    assert.equal(r.offset, 'automation')
  })

  it('in a subfolder with no flag and nothing installed: asks here or the repo root', () => {
    dir('automation')
    const r = locate({ cwd: join(repo, 'automation') })
    assert.equal(r.needsDecision, 'ask-location')
    assert.deepEqual(r.options, { here: 'automation', root: '.', folders: ['automation'] })
    assert.equal(r.offset, '')
  })

  it('from a deep folder the question offers every folder up to the root, nearest first', () => {
    dir('automation/tests/api')
    const r = locate({ cwd: join(repo, 'automation', 'tests', 'api') })
    assert.deepEqual(r.options.folders, ['automation/tests/api', 'automation/tests', 'automation'])
  })

  it('finds an install six levels down and refuses a path inside another repository', () => {
    install('a/b/c/d/e/f')
    assert.equal(locate({ cwd: repo }).needsDecision, 'install-elsewhere')
    const inner = dir('vendor/lib')
    execFileSync('git', ['init', '-q'], { cwd: inner })
    assert.throws(() => locate({ cwd: repo, path: 'vendor/lib/qa' }), /inside another git repository/)
  })

  it('finds an existing install at or above the folder you are in and uses it, with no flag', () => {
    install('automation')
    dir('automation/tests')
    for (const sub of ['automation', 'automation/tests']) {
      const r = locate({ cwd: join(repo, sub) })
      assert.equal(r.reason, 'existing-install')
      assert.equal(r.offset, 'automation')
      assert.equal(r.installed, true)
      assert.equal(r.needsDecision, undefined)
    }
  })

  it('at the root with an install in a subfolder and no flag: stops and names it (no second install)', () => {
    install('automation')
    const r = locate({ cwd: repo })
    assert.equal(r.needsDecision, 'install-elsewhere')
    assert.deepEqual(r.installs, ['automation'])
  })

  it('warns when --path would nest inside, or sit beside, another install', () => {
    install('automation')
    assert.match(locate({ cwd: repo, path: 'automation/e2e' }).warnings[0], /nested inside/)
    assert.match(locate({ cwd: repo, path: 'other' }).warnings[0], /also installed in automation/)
    assert.deepEqual(locate({ cwd: repo, path: 'automation' }).warnings, [])
    assert.equal(locate({ cwd: repo, path: 'automation' }).installed, true)
  })

  it('ignores installs inside node_modules and nested repositories', () => {
    install('node_modules/pkg')
    install('vendor/lib')
    execFileSync('git', ['init', '-q'], { cwd: join(repo, 'vendor', 'lib') })
    assert.equal(locate({ cwd: repo }).needsDecision, undefined)
  })

  it('outside a git repository the current folder is the boundary', () => {
    const plain = join(tmp, 'plain')
    mkdirSync(join(plain, 'sub'), { recursive: true })
    const r = locate({ cwd: plain, path: 'sub' })
    assert.equal(r.gitRoot, null)
    assert.equal(r.offset, 'sub')
    assert.throws(() => locate({ cwd: plain, path: '../x' }), /outside the current folder/)
  })
})

describe('merge.mjs locate (command line)', () => {
  let tmp
  const MERGE = new URL('../../tools/merge.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const cli = (cwd, ...args) => JSON.parse(execFileSync('node', [MERGE, 'locate', ...args], { cwd, encoding: 'utf8' }))

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'qa-kit-locate-cli-'))
    execFileSync('git', ['init', '-q'], { cwd: tmp })
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('accepts --path=<folder> as well as --path <folder>', () => {
    assert.equal(cli(tmp, '--path=/myfolder/test').offset, 'myfolder/test')
    assert.equal(cli(tmp, '--path', 'myfolder/test').offset, 'myfolder/test')
  })

  it('exits with the reason on a path that escapes the repository', () => {
    assert.throws(() => execFileSync('node', [MERGE, 'locate', '--path=../x'], { cwd: tmp, stdio: 'pipe' }), /outside the git repository/)
  })
})

describe('Git Bash path rewriting', () => {
  it('turns "C:/Program Files/Git/myfolder/test" back into ./myfolder/test and says so', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'qa-kit-locate-gb-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: tmp })
      for (const raw of ['C:/Program Files/Git/myfolder/test', String.raw`C:\Program Files\Git\myfolder\test`]) {
        const r = locate({ cwd: tmp, path: raw })
        assert.equal(r.offset, 'myfolder/test')
        assert.match(r.warnings[0], /what Git Bash makes of "\/myfolder\/test"/)
      }
      // A real absolute path elsewhere is still refused.
      assert.throws(() => locate({ cwd: tmp, path: 'C:/Users/someone/x' }), /absolute/)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
