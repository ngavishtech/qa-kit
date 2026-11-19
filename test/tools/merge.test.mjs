import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { merge3 } from '../../tools/lib/json3.mjs'
import { toOpenCodeConfig } from '../../tools/lib/mcp-convert.mjs'
import { merge3Text } from '../../tools/lib/text3.mjs'
import { apply, plan, record, renderAll } from '../../tools/merge.mjs'

describe('json3', () => {
  it('keeps local additions and takes kit additions in scalar arrays', () => {
    const { value, conflicts } = merge3({ a: ['x'] }, { a: ['x', 'mine'] }, { a: ['x', 'kit'] })
    assert.deepEqual(value, { a: ['x', 'mine', 'kit'] })
    assert.deepEqual(conflicts, [])
  })

  it('drops an entry the kit removed when the repo left it alone, keeps local ones', () => {
    const { value } = merge3({ a: ['old', 'x'] }, { a: ['old', 'x', 'mine'] }, { a: ['x'] })
    assert.deepEqual(value, { a: ['x', 'mine'] })
  })

  it('takes new keys from the kit and preserves local keys', () => {
    const { value } = merge3({ k: 1 }, { k: 1, local: true }, { k: 1, fresh: 2 })
    assert.deepEqual(value, { k: 1, local: true, fresh: 2 })
  })

  it('never fuses two versions of a command line: args and command arrays are atomic', () => {
    const none = merge3(undefined, { s: { args: ['-y', 'pkg@latest'] } }, { s: { args: ['-y', 'pkg@1.2.3'] } })
    assert.deepEqual(none.conflicts, ['/s/args'])
    assert.deepEqual(none.value.s.args, ['-y', 'pkg@latest'])
    const both = merge3({ s: { args: ['-y', 'pkg@1'] } }, { s: { args: ['-y', 'pkg@1', '--extra'] } }, { s: { args: ['-y', 'pkg@2'] } })
    assert.deepEqual(both.conflicts, ['/s/args'])
    const kitOnly = merge3({ s: { args: ['-y', 'pkg@1'] } }, { s: { args: ['-y', 'pkg@1'] } }, { s: { args: ['-y', 'pkg@2'] } })
    assert.deepEqual(kitOnly.value.s.args, ['-y', 'pkg@2'])
    assert.deepEqual(kitOnly.conflicts, [])
  })

  it('still merges permission lists as sets', () => {
    const { value } = merge3({ permissions: { allow: ['a'] } }, { permissions: { allow: ['a', 'mine'] } }, { permissions: { allow: ['a', 'kit'] } })
    assert.deepEqual(value.permissions.allow, ['a', 'mine', 'kit'])
  })

  it('reports a conflict when both sides change the same scalar', () => {
    const { value, conflicts } = merge3({ url: 'a' }, { url: 'mine' }, { url: 'kit' })
    assert.deepEqual(conflicts, ['/url'])
    assert.equal(value.url, 'mine')
  })

  it('without a base, adds what is missing and flags differing values', () => {
    const { value, conflicts } = merge3(undefined, { a: ['x'], u: 1 }, { a: ['y'], u: 2, n: 3 })
    assert.deepEqual(value.a, ['x', 'y'])
    assert.equal(value.n, 3)
    assert.deepEqual(conflicts, ['/u'])
  })
})

describe('text3', () => {
  it('merges edits in different regions cleanly', () => {
    const base = 'a\nb\nc\nd\ne\n'
    const { text, conflicts } = merge3Text(base, 'a\nb\nc\nd\nE-local\n', 'A-kit\nb\nc\nd\ne\n')
    assert.equal(conflicts, 0)
    assert.equal(text, 'A-kit\nb\nc\nd\nE-local\n')
  })

  it('reports conflict markers when both edit the same line', () => {
    const { text, conflicts } = merge3Text('a\n', 'mine\n', 'kit\n')
    assert.equal(conflicts, 1)
    assert.match(text, /<<<<<<< repo[\s\S]*mine[\s\S]*=======[\s\S]*kit[\s\S]*>>>>>>> kit-new/)
  })
})

describe('mcp-convert', () => {
  it('maps stdio and remote servers and env interpolation', () => {
    const out = toOpenCodeConfig({
      mcpServers: {
        pw: { command: 'npx', args: ['-y', 'pkg'] },
        tr: { command: 'npx', args: ['t'], env: { KEY: '${KEY}' } },
        remote: { type: 'http', url: 'https://example.test/mcp' },
        envUrl: { type: 'http', url: '${SERVER_URL}' },
      },
    })
    assert.deepEqual(out.mcp.servers.envUrl, { type: 'remote', url: '{env:SERVER_URL}' })
    assert.deepEqual(out.mcp.servers.pw, { type: 'local', command: ['npx', '-y', 'pkg'] })
    assert.deepEqual(out.mcp.servers.tr.environment, { KEY: '{env:KEY}' })
    assert.deepEqual(out.mcp.servers.remote, { type: 'remote', url: 'https://example.test/mcp' })
  })
})

describe('merge (plan / apply / record)', () => {
  let tmp, repo, kit, snaps
  const vars = { KIT_GIT_URL: 'https://example.test/org/qa-kit.git', TEST_SOURCE_DIR: 'src' }
  const manifestOf = () => JSON.parse(readFileSync(join(repo, '.qa-kit/manifest.json'), 'utf8'))
  const write = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }
  const status = (p) => Object.fromEntries(p.entries.map((e) => [e.target, e.status]))

  // A tiny kit with one text, one json and one create-once template.
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'qa-kit-test-'))
    snaps = new Map()
    repo = join(tmp, 'repo')
    kit = join(tmp, 'kit')
    mkdirSync(repo)
    execFileSync('git', ['init', '-q'], { cwd: repo })
    write(kit, '.claude-plugin/plugin.json', '{"version":"1.0.0"}')
    write(kit, 'templates/manifest.json', JSON.stringify({
      vars: ['KIT_GIT_URL', 'TEST_SOURCE_DIR'],
      files: [
        { target: 'AGENTS.md', source: 'AGENTS.md.template', kind: 'text', update: 'merge', agents: ['claude', 'opencode'] },
        { target: '.claude/settings.json', source: 'settings.json.template', kind: 'json', update: 'merge', agents: ['claude'] },
        { target: '.qa-kit/project/conventions.md', source: 'conv.md', legacy: '.claude/project/conventions.md', kind: 'text', update: 'once', agents: ['claude', 'opencode'] },
        { target: '.gitignore', source: 'gitignore.lines', kind: 'lines', update: 'merge', agents: ['claude', 'opencode'] },
      ],
    }))
    write(kit, 'templates/AGENTS.md.template', 'line1\nline2\nline3\nline4\nline5\nurl: <KIT_GIT_URL>\n')
    write(kit, 'templates/settings.json.template', JSON.stringify({ permissions: { allow: ['Read(./**)', 'Edit(./<TEST_SOURCE_DIR>/**)'] } }))
    write(kit, 'templates/conv.md', 'conventions v1\n')
    write(kit, 'templates/gitignore.lines', 'qa-kit-artifacts/\n')
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  // The fake kit stands in for the remote: the first time a version is seen its tree is frozen, like a release tag.
  const versionOf = () => JSON.parse(readFileSync(join(kit, '.claude-plugin/plugin.json'), 'utf8')).version
  const snapshot = () => {
    const version = versionOf()
    if (!snaps.has(version)) {
      const dir = join(tmp, `tag-${version}`)
      cpSync(kit, dir, { recursive: true })
      snaps.set(version, dir)
    }
  }
  const fetchTag = (url, tag) => {
    if (!snaps.has(tag)) throw new Error(`no such tag: ${tag}`)
    return snaps.get(tag)
  }
  const run = (extra = {}) => {
    snapshot()
    return { repo, kitRoot: kit, agents: ['claude'], vars, fetchTag, ...extra }
  }

  it('creates everything in an empty repo and records the hash and tag of each file, with no base folder', () => {
    const p = plan(run())
    assert.deepEqual(Object.values(status(p)), ['create', 'create', 'create', 'create'])
    const r = apply(run({ accept: 'all' }))
    assert.equal(r.needsManual.length, 0)
    assert.match(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), /url: https:\/\/example.test/)
    assert.ok(!existsSync(join(repo, '.qa-kit/base')), 'the base folder is gone')
    assert.equal(manifestOf().kitVersion, '1.0.0')
    assert.deepEqual(Object.keys(manifestOf().files[ 'AGENTS.md']).sort(), ['sha', 'tag'])
    assert.equal(manifestOf().files['AGENTS.md'].tag, '1.0.0')
  })

  it('is a no-op on re-run when nothing changed', () => {
    apply(run({ accept: 'all' }))
    const p = plan(run())
    assert.ok(p.entries.every((e) => e.status === 'unchanged' || e.status === 'kept'))
  })

  it('fast-forwards a file with no local edits to the new kit output', () => {
    apply(run({ accept: 'all' }))
    write(kit, 'templates/AGENTS.md.template', 'line1\nline2\nline3\nline4\nline5\nurl: <KIT_GIT_URL>\nnew kit line\n')
    const p = plan(run())
    assert.equal(status(p)['AGENTS.md'], 'fast-forward')
    assert.match(p.entries.find((e) => e.target === 'AGENTS.md').diff, /\+new kit line/)
  })

  it('merges the kit change under a local edit in a different region', () => {
    apply(run({ accept: 'all' }))
    write(repo, 'AGENTS.md', readFileSync(join(repo, 'AGENTS.md'), 'utf8').replace('line1', 'LOCAL line1'))
    write(kit, 'templates/AGENTS.md.template', 'line1\nline2\nline3\nline4\nline5\nurl: <KIT_GIT_URL>\nnew kit line\n')
    assert.equal(status(plan(run()))['AGENTS.md'], 'merge')
    apply(run({ accept: ['AGENTS.md'] }))
    const text = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
    assert.match(text, /LOCAL line1/)
    assert.match(text, /new kit line/)
  })

  it('does not touch a conflicting file; leaves a review copy and exits needing manual merge', () => {
    apply(run({ accept: 'all' }))
    write(repo, 'AGENTS.md', 'line1\nline2\nline3\nline4\nline5\nurl: LOCAL\n')
    write(kit, 'templates/AGENTS.md.template', 'line1\nline2\nline3\nline4\nline5\nurl: KIT <KIT_GIT_URL>\n')
    assert.equal(status(plan(run()))['AGENTS.md'], 'conflict')
    const r = apply(run({ accept: 'all' }))
    assert.deepEqual(r.needsManual, ['qa-kit-artifacts/merge/AGENTS.md'])
    assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), 'line1\nline2\nline3\nline4\nline5\nurl: LOCAL\n')
    assert.match(readFileSync(join(repo, 'qa-kit-artifacts/merge/AGENTS.md'), 'utf8'), /<<<<<<< repo/)
    assert.equal(JSON.parse(readFileSync(join(repo, '.qa-kit/manifest.json'), 'utf8')).kitVersion, '1.0.0')
  })

  it('record marks a hand-resolved file as merged so it is not offered again', () => {
    apply(run({ accept: 'all' }))
    write(repo, 'AGENTS.md', 'resolved by hand\n')
    write(kit, 'templates/AGENTS.md.template', 'line1\nline2\nline3\nline4\nline5\nurl: KIT <KIT_GIT_URL>\n')
    record(run({ paths: ['AGENTS.md'] }))
    assert.equal(status(plan(run()))['AGENTS.md'], 'unchanged')
  })

  it('leaves skipped files offered and keeps the recorded kit version', () => {
    apply(run({ accept: 'all' }))
    write(kit, '.claude-plugin/plugin.json', '{"version":"1.1.0"}')
    write(kit, 'templates/AGENTS.md.template', 'new\n')
    apply(run({ accept: ['.claude/settings.json'] }))
    assert.equal(status(plan(run()))['AGENTS.md'], 'fast-forward')
    assert.equal(JSON.parse(readFileSync(join(repo, '.qa-kit/manifest.json'), 'utf8')).kitVersion, '1.0.0')
  })

  it('merges JSON permissions: local addition and kit addition both survive', () => {
    apply(run({ accept: 'all' }))
    const f = join(repo, '.claude/settings.json')
    const local = JSON.parse(readFileSync(f, 'utf8'))
    local.permissions.allow.push('Bash(make test)')
    writeFileSync(f, JSON.stringify(local, null, 2))
    write(kit, 'templates/settings.json.template', JSON.stringify({ permissions: { allow: ['Read(./**)', 'Edit(./<TEST_SOURCE_DIR>/**)', 'Bash(git status*)'] } }))
    apply(run({ accept: ['.claude/settings.json'] }))
    assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')).permissions.allow, ['Read(./**)', 'Edit(./src/**)', 'Bash(make test)', 'Bash(git status*)'])
  })

  it('never auto-updates a repo-owned file but shows what the kit changed', () => {
    apply(run({ accept: 'all' }))
    write(repo, '.qa-kit/project/conventions.md', 'my own conventions\n')
    write(kit, 'templates/conv.md', 'conventions v2\n')
    const e = plan(run()).entries.find((x) => x.target === '.qa-kit/project/conventions.md')
    assert.equal(e.status, 'kept')
    assert.match(e.diff, /\+conventions v2/)
    apply(run({ accept: 'all' }))
    assert.equal(readFileSync(join(repo, '.qa-kit/project/conventions.md'), 'utf8'), 'my own conventions\n')
  })

  it('appends only the missing gitignore lines', () => {
    write(repo, '.gitignore', 'node_modules/\n')
    apply(run({ accept: 'all' }))
    assert.equal(readFileSync(join(repo, '.gitignore'), 'utf8'), 'node_modules/\nqa-kit-artifacts/\n')
  })

  it('treats a pre-existing file with no recorded base as needing a manual merge', () => {
    write(repo, 'AGENTS.md', 'something the repo already had\n')
    assert.equal(status(plan(run()))['AGENTS.md'], 'unknown-base')
  })

  it('normalises CRLF so line endings alone are not a local edit', () => {
    apply(run({ accept: 'all' }))
    write(repo, 'AGENTS.md', readFileSync(join(repo, 'AGENTS.md'), 'utf8').replaceAll('\n', '\r\n'))
    assert.equal(status(plan(run()))['AGENTS.md'], 'unchanged')
  })

  it('offers a legacy file as a move inside the plan: written only on accept, old file untouched and unstaged', () => {
    write(repo, '.claude/project/conventions.md', 'my 0.1.0 conventions\n')
    const p = plan(run())
    const e = p.entries.find((x) => x.target === '.qa-kit/project/conventions.md')
    assert.equal(e.status, 'move')
    assert.equal(e.from, '.claude/project/conventions.md')
    assert.ok(!existsSync(join(repo, '.qa-kit/project/conventions.md')), 'plan writes nothing')
    const r = apply(run({ accept: 'all' }))
    assert.deepEqual(r.leftovers, ['.claude/project/conventions.md'])
    assert.equal(readFileSync(join(repo, '.qa-kit/project/conventions.md'), 'utf8'), 'my 0.1.0 conventions\n')
    assert.equal(readFileSync(join(repo, '.claude/project/conventions.md'), 'utf8'), 'my 0.1.0 conventions\n')
    assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' }), '')
  })

  it('a skipped move stays offered', () => {
    write(repo, '.claude/project/conventions.md', 'legacy\n')
    apply(run({ accept: ['AGENTS.md'] }))
    assert.equal(status(plan(run()))['.qa-kit/project/conventions.md'], 'move')
  })

  it('keeps CRLF files CRLF when merging', () => {
    apply(run({ accept: 'all' }))
    const f = join(repo, 'AGENTS.md')
    writeFileSync(f, readFileSync(f, 'utf8').replace('line1', 'LOCAL line1').replaceAll('\n', '\r\n'))
    write(kit, 'templates/AGENTS.md.template', 'line1\nline2\nline3\nline4\nline5\nurl: <KIT_GIT_URL>\nnew kit line\n')
    apply(run({ accept: ['AGENTS.md'] }))
    const text = readFileSync(f, 'utf8')
    assert.match(text, /LOCAL line1\r\n/)
    assert.match(text, /new kit line\r\n/)
    assert.ok(!/[^\r]\n/.test(text), 'no bare LF left')
  })

  it('reads JSON that starts with a UTF-8 BOM', () => {
    apply(run({ accept: 'all' }))
    const f = join(repo, '.claude/settings.json')
    writeFileSync(f, String.fromCharCode(0xfeff) + readFileSync(f, 'utf8'))
    write(kit, 'templates/settings.json.template', JSON.stringify({ permissions: { allow: ['Read(./**)', 'Edit(./<TEST_SOURCE_DIR>/**)', 'Bash(git status*)'] } }))
    assert.equal(status(plan(run()))['.claude/settings.json'], 'fast-forward', 'the BOM alone is not a local edit')
  })

  it('reports unchanged when a JSON merge is semantically a no-op, whatever the formatting', () => {
    write(repo, '.claude/settings.json', '{"permissions":{"allow":["Read(./**)","Edit(./src/**)"]}}')
    assert.equal(status(plan(run()))['.claude/settings.json'], 'unchanged')
  })

  it('shows both values for a JSON conflict and writes a review copy with both', () => {
    write(kit, 'templates/settings.json.template', JSON.stringify({ theme: 'light', permissions: { allow: ['Read(./**)'] } }))
    write(repo, '.claude/settings.json', JSON.stringify({ theme: 'dark', permissions: { allow: ['Read(./**)'] } }))
    const e = plan(run()).entries.find((x) => x.target === '.claude/settings.json')
    assert.equal(e.status, 'conflict')
    assert.deepEqual(e.details, [{ path: '/theme', ours: 'dark', theirs: 'light' }])
    const r = apply(run({ accept: ['.claude/settings.json'] }))
    assert.deepEqual(r.needsManual, ['qa-kit-artifacts/merge/.claude/settings.json'])
    const review = JSON.parse(readFileSync(join(repo, 'qa-kit-artifacts/merge/.claude/settings.json'), 'utf8'))
    assert.deepEqual(review.conflicts, [{ path: '/theme', repo: 'dark', kit: 'light' }])
    assert.equal(review.merged.theme, 'dark')
    assert.equal(JSON.parse(readFileSync(join(repo, '.claude/settings.json'), 'utf8')).theme, 'dark')
  })

  it('names the file when its JSON cannot be parsed and still plans the others', () => {
    write(repo, '.claude/settings.json', '{ "a": 1, }')
    const p = plan(run())
    const e = p.entries.find((x) => x.target === '.claude/settings.json')
    assert.equal(e.status, 'error')
    assert.ok(e.error.length > 0)
    assert.equal(status(p)['AGENTS.md'], 'create')
    const r = apply(run({ accept: 'all' }))
    assert.equal(r.errors.length, 1)
    assert.match(r.errors[0], /^\.claude\/settings\.json: /)
    assert.equal(readFileSync(join(repo, '.claude/settings.json'), 'utf8'), '{ "a": 1, }')
  })

  it('refuses to record a file that still has conflict markers', () => {
    apply(run({ accept: 'all' }))
    write(repo, 'AGENTS.md', '<<<<<<< repo\nmine\n=======\nkit\n>>>>>>> kit-new\n')
    assert.throws(() => record(run({ paths: ['AGENTS.md'] })), /conflict markers/)
  })

  it('rejects an empty value for a placeholder', () => {
    assert.throws(() => plan(run({ vars: { ...vars, KIT_GIT_URL: '' } })), /KIT_GIT_URL/)
  })

  it('requires a value for every placeholder a template uses', () => {
    assert.throws(() => plan(run({ vars: { TEST_SOURCE_DIR: 'src' } })), /KIT_GIT_URL/)
  })

  // ---- the base is rebuilt from the kit tag that wrote the file (layers: tag, tag renderer, fallback) ----
  const shaOf = (text) => createHash('sha256').update(text).digest('hex')
  const release = (version, templateText) => {
    write(kit, '.claude-plugin/plugin.json', JSON.stringify({ version }))
    if (templateText !== undefined) write(kit, 'templates/AGENTS.md.template', templateText)
  }
  const entryOf = (p, target) => p.entries.find((e) => e.target === target)
  const neverFetch = () => { throw new Error('must not fetch') }

  // ---- the conventions file is the team's, but the kit improves it too: it is merged like AGENTS.md, never overwritten ----
  const CONV = '.qa-kit/project/conventions.md'
  const convV1 = 'intro\n\n## Helpers\n- waits: none\n\n## Commands\n| Run all | npm test |\n| Lint | npm run lint |\n\n## Git\n- prefix: none\n'
  const conventionsMerge = () => {
    const m = JSON.parse(readFileSync(join(kit, 'templates/manifest.json'), 'utf8'))
    m.files.find((f) => f.target === CONV).update = 'merge'
    write(kit, 'templates/manifest.json', JSON.stringify(m))
    write(kit, 'templates/conv.md', convV1)
  }

  it('merges the kit changes to the conventions into a file the team has edited and pre-filled', () => {
    conventionsMerge()
    apply(run({ accept: 'all' }))
    write(repo, CONV, convV1.replace('| Run all | npm test |', '| Run all | yarn test |') + '\n## Our rules\n- tag @owner\n')
    release('1.1.0')
    write(kit, 'templates/conv.md', convV1.replace('| Lint | npm run lint |', '| Lint | npm run lint |\n| List tests | npx playwright test --list |'))
    const p = plan(run())
    assert.equal(entryOf(p, CONV).status, 'merge')
    assert.equal(entryOf(p, CONV).base, 'tag')
    assert.deepEqual(p.baseFallbacks, [])
    const r = apply(run({ accept: 'all' }))
    assert.deepEqual(r.needsManual, [])
    const merged = readFileSync(join(repo, CONV), 'utf8')
    assert.match(merged, /yarn test/, 'the team edit survives')
    assert.match(merged, /## Our rules/, 'the team section survives')
    assert.match(merged, /List tests/, 'the kit addition arrives')
    assert.equal(manifestOf().files[CONV].tag, '1.1.0')
    assert.equal(entryOf(plan(run()), CONV).status, 'unchanged', 'settled: nothing is offered again')
  })

  it('leaves the conventions untouched and writes a review copy when the team and the kit changed the same line', () => {
    conventionsMerge()
    apply(run({ accept: 'all' }))
    const mine = convV1.replace('| Lint | npm run lint |', '| Lint | yarn eslint |')
    write(repo, CONV, mine)
    release('1.1.0')
    write(kit, 'templates/conv.md', convV1.replace('| Lint | npm run lint |', '| Lint | npm run lint:ci |'))
    assert.equal(entryOf(plan(run()), CONV).status, 'conflict')
    const r = apply(run({ accept: 'all' }))
    assert.deepEqual(r.needsManual, [`qa-kit-artifacts/merge/${CONV}`])
    assert.equal(readFileSync(join(repo, CONV), 'utf8'), mine, 'the real file is never written with conflict markers')
    assert.match(readFileSync(join(repo, 'qa-kit-artifacts/merge', CONV), 'utf8'), /<<<<<<< repo[\s\S]*yarn eslint[\s\S]*npm run lint:ci[\s\S]*>>>>>>> kit-new/)
    assert.equal(manifestOf().files[CONV].tag, '1.0.0', 'a conflicted file keeps its old record, so it is offered again')
  })

  it('fast-forwards conventions nobody edited, and leaves an edited file alone when the kit did not change it', () => {
    conventionsMerge()
    apply(run({ accept: 'all' }))
    release('1.1.0')
    write(kit, 'templates/conv.md', convV1 + '- new kit section\n')
    assert.equal(entryOf(plan(run()), CONV).status, 'fast-forward')
    apply(run({ accept: 'all' }))
    assert.match(readFileSync(join(repo, CONV), 'utf8'), /new kit section/)

    write(repo, CONV, readFileSync(join(repo, CONV), 'utf8') + '- my addition\n')
    release('1.2.0')
    assert.equal(entryOf(plan(run()), CONV).status, 'unchanged', 'the kit changed nothing: the team edit is not touched')
  })

  it('never overwrites the conventions when their previous version cannot be rebuilt: first-time review copy', () => {
    conventionsMerge()
    apply(run({ accept: 'all' }))
    const mine = convV1 + '- my addition\n'
    write(repo, CONV, mine)
    release('1.1.0')
    write(kit, 'templates/conv.md', convV1 + '- kit addition\n')
    const offline = plan(run({ fetchTag: () => { throw new Error('offline') } }))
    assert.equal(entryOf(offline, CONV).status, 'unknown-base')
    assert.ok(offline.baseFallbacks.some((f) => f.target === CONV))
    const r = apply(run({ accept: 'all', fetchTag: () => { throw new Error('offline') } }))
    assert.ok(r.needsManual.includes(`qa-kit-artifacts/merge/${CONV}`))
    assert.equal(readFileSync(join(repo, CONV), 'utf8'), mine)
  })

  it('the shipped manifest merges the conventions and keeps the TestRail mapping create-once', () => {
    const real = JSON.parse(readFileSync(new URL('../../templates/manifest.json', import.meta.url), 'utf8'))
    const updateOf = (target) => real.files.find((f) => f.target === target).update
    assert.equal(updateOf('.qa-kit/project/conventions.md'), 'merge')
    assert.equal(updateOf('.qa-kit/project/testrail-mapping.md'), 'once')
  })

  it('rebuilds the base from the tag: a kit change fast-forwards without any base folder', () => {
    apply(run({ accept: 'all' }))
    release('1.1.0', 'line1\nline2\nline3\nline4\nline5\nurl: <KIT_GIT_URL>\nnew kit line\n')
    const p = plan(run())
    assert.equal(entryOf(p, 'AGENTS.md').status, 'fast-forward')
    assert.equal(entryOf(p, 'AGENTS.md').base, 'tag')
    assert.deepEqual(p.baseFallbacks, [])
    assert.equal(p.tagRendererOffer, null)
    apply(run({ accept: 'all' }))
    assert.ok(!existsSync(join(repo, '.qa-kit/base')))
    assert.equal(manifestOf().files['AGENTS.md'].tag, '1.1.0')
  })

  it('does a real shallow clone of the tag from the kit repository (file:// URL)', () => {
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: kit, stdio: 'ignore' })
    const realVars = { ...vars, KIT_GIT_URL: pathToFileURL(kit).href }
    const real = (extra = {}) => ({ repo, kitRoot: kit, agents: ['claude'], vars: realVars, ...extra })
    git('init', '-q')
    git('add', '-A')
    git('commit', '-q', '-m', 'v1')
    git('tag', '1.0.0')
    apply(real({ accept: 'all' }))
    release('1.1.0', 'line1\nline2\nline3\nline4\nline5\nurl: <KIT_GIT_URL>\nnew kit line\n')
    git('commit', '-q', '-am', 'v1.1')
    git('tag', '1.1.0')
    write(repo, 'AGENTS.md', readFileSync(join(repo, 'AGENTS.md'), 'utf8').replace('line1', 'LOCAL line1'))
    const p = plan(real())
    assert.equal(entryOf(p, 'AGENTS.md').status, 'merge')
    assert.equal(entryOf(p, 'AGENTS.md').base, 'tag')
    assert.deepEqual(p.baseFallbacks, [])
  })

  it('does not fetch when the kit renders every file exactly as recorded', () => {
    apply(run({ accept: 'all' }))
    release('1.1.0')
    const p = plan(run({ fetchTag: neverFetch }))
    assert.ok(p.entries.every((e) => ['unchanged', 'kept'].includes(e.status)))
  })

  it('renders the old tag with the variables that were in force, not the new ones', () => {
    apply(run({ accept: 'all' }))
    release('1.1.0')
    const p = plan(run({ vars: { ...vars, TEST_SOURCE_DIR: 'lib' } }))
    assert.equal(entryOf(p, '.claude/settings.json').status, 'fast-forward')
    assert.deepEqual(p.baseFallbacks, [])
  })

  it('falls back to the first-time behaviour when the tag cannot be fetched, and never overwrites', () => {
    apply(run({ accept: 'all' }))
    write(repo, 'AGENTS.md', 'line1\nline2\nline3\nline4\nline5\nurl: LOCAL\n')
    const local = JSON.parse(readFileSync(join(repo, '.claude/settings.json'), 'utf8'))
    local.permissions.allow.push('Bash(make test)')
    write(repo, '.claude/settings.json', JSON.stringify(local, null, 2))
    release('1.1.0', 'line1\nline2\nline3\nline4\nline5\nurl: KIT <KIT_GIT_URL>\n')
    write(kit, 'templates/settings.json.template', JSON.stringify({ permissions: { allow: ['Read(./**)', 'Edit(./<TEST_SOURCE_DIR>/**)', 'Bash(git status*)'] } }))
    const down = { fetchTag: () => { throw new Error('network is down') } }
    const p = plan(run(down))
    assert.equal(entryOf(p, 'AGENTS.md').status, 'unknown-base')
    assert.equal(entryOf(p, 'AGENTS.md').base, 'none')
    assert.equal(entryOf(p, '.claude/settings.json').status, 'merge', 'JSON still merges key-wise: nothing is lost')
    assert.deepEqual(p.baseFallbacks.map((f) => f.target).sort(), ['.claude/settings.json', 'AGENTS.md'])
    assert.match(p.baseFallbacks[0].reason, /could not fetch tag 1\.0\.0: network is down/)
    assert.equal(p.baseFallbacks[0].tag, '1.0.0')
    assert.ok(p.baseFallbacks.every((f) => f.effect.length > 0))
    assert.equal(p.tagRendererOffer, null, 'nothing to offer when the fetch itself failed')
    const r = apply(run({ ...down, accept: 'all' }))
    assert.deepEqual(r.needsManual, ['qa-kit-artifacts/merge/AGENTS.md'])
    assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), 'line1\nline2\nline3\nline4\nline5\nurl: LOCAL\n')
    assert.deepEqual(JSON.parse(readFileSync(join(repo, '.claude/settings.json'), 'utf8')).permissions.allow, ['Read(./**)', 'Edit(./src/**)', 'Bash(make test)', 'Bash(git status*)'])
  })

  describe('when the renderer changed since the tag', () => {
    const OLD = 'rendered by the old renderer\n'
    const fakeRenderer = (body, header = '') => `${header}export function renderAll() { ${body} }\n`
    const setup = () => {
      apply(run({ accept: 'all' }))
      // As if the kit at 1.0.0 had a different renderer: the repo has its output and the manifest its hash.
      write(repo, 'AGENTS.md', OLD)
      const m = manifestOf()
      m.files['AGENTS.md'].sha = shaOf(OLD)
      write(repo, '.qa-kit/manifest.json', JSON.stringify(m, null, 2))
      release('1.1.0', 'brand new template\n')
    }
    const withTagRenderer = (body, header) => {
      snapshot() // freeze 1.0.0 before 1.1.0 is seen
      write(snaps.get('1.0.0'), 'tools/merge.mjs', fakeRenderer(body, header))
    }

    it('offers the tag renderer instead of running it, and leaves the file untouched', () => {
      apply(run({ accept: 'all' }))
      write(repo, 'AGENTS.md', OLD)
      const m = manifestOf()
      m.files['AGENTS.md'].sha = shaOf(OLD)
      write(repo, '.qa-kit/manifest.json', JSON.stringify(m, null, 2))
      withTagRenderer(`return { 'AGENTS.md': ${JSON.stringify(OLD)} }`)
      release('1.1.0', 'brand new template\n')
      const p = plan(run())
      assert.equal(entryOf(p, 'AGENTS.md').status, 'unknown-base')
      assert.deepEqual(p.tagRendererOffer, { url: vars.KIT_GIT_URL, tags: ['1.0.0'], targets: ['AGENTS.md'] })
      assert.match(p.baseFallbacks[0].reason, /renderer changed/)
      assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), OLD)
    })

    it("with consent, rebuilds the base with the tag's own renderer and merges normally", () => {
      apply(run({ accept: 'all' }))
      write(repo, 'AGENTS.md', OLD)
      const m = manifestOf()
      m.files['AGENTS.md'].sha = shaOf(OLD)
      write(repo, '.qa-kit/manifest.json', JSON.stringify(m, null, 2))
      withTagRenderer(`return { 'AGENTS.md': ${JSON.stringify(OLD)} }`)
      release('1.1.0', 'brand new template\n')
      const p = plan(run({ baseRenderer: 'tag' }))
      assert.equal(entryOf(p, 'AGENTS.md').status, 'fast-forward')
      assert.equal(entryOf(p, 'AGENTS.md').base, 'tag-renderer')
      assert.deepEqual(p.baseFallbacks, [])
      assert.equal(p.tagRendererOffer, null)
      apply(run({ baseRenderer: 'tag', accept: 'all' }))
      assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), 'brand new template\n')
    })

    it('falls back when the tag renderer throws or reproduces the wrong hash', () => {
      for (const body of ["throw new Error('boom')", "return { 'AGENTS.md': 'something else\\n' }", 'return {}']) {
        rmSync(join(tmp, 'tag-1.0.0'), { recursive: true, force: true })
        snaps.clear()
        rmSync(repo, { recursive: true, force: true })
        mkdirSync(repo)
        execFileSync('git', ['init', '-q'], { cwd: repo })
        release('1.0.0', 'line1\nline2\nline3\nline4\nline5\nurl: <KIT_GIT_URL>\n')
        apply(run({ accept: 'all' }))
        write(repo, 'AGENTS.md', OLD)
        const m = manifestOf()
        m.files['AGENTS.md'].sha = shaOf(OLD)
        write(repo, '.qa-kit/manifest.json', JSON.stringify(m, null, 2))
        withTagRenderer(body)
        release('1.1.0', 'brand new template\n')
        const p = plan(run({ baseRenderer: 'tag' }))
        assert.equal(entryOf(p, 'AGENTS.md').status, 'unknown-base', body)
        assert.equal(entryOf(p, 'AGENTS.md').base, 'none')
        assert.match(p.baseFallbacks[0].reason, /renderer of tag 1\.0\.0/)
        assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), OLD)
        release('1.0.0')
      }
    })

    it('runs the tag renderer against an empty folder, so it cannot see or change the repo', () => {
      apply(run({ accept: 'all' }))
      write(repo, 'AGENTS.md', OLD)
      const m = manifestOf()
      m.files['AGENTS.md'].sha = shaOf(OLD)
      write(repo, '.qa-kit/manifest.json', JSON.stringify(m, null, 2))
      withTagRenderer(`writeFileSync('probe.txt', readdirSync('.').join(',')); return { 'AGENTS.md': ${JSON.stringify(OLD)} }`, "import { readdirSync, writeFileSync } from 'node:fs'\n")
      release('1.1.0', 'brand new template\n')
      plan(run({ baseRenderer: 'tag' }))
      assert.ok(!existsSync(join(repo, 'probe.txt')), 'nothing is written into the repo')
    })
  })

  it('renderAll is the stable export the tag renderer layer relies on', () => {
    const real = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
    const out = renderAll({ kitRoot: real, agents: ['claude', 'opencode'], vars: { ...vars, PROJECT_NAME: 'p', PRODUCT_NAME: 'p' } })
    for (const target of ['AGENTS.md', '.mcp.json', 'opencode.json', '.claude/settings.json']) assert.equal(typeof out[target], 'string', target)
    assert.ok(!('.gitattributes' in out))
  })

  it('record stores the hash and tag too', () => {
    apply(run({ accept: 'all' }))
    release('1.1.0', 'line1\nline2\nline3\nline4\nline5\nurl: KIT <KIT_GIT_URL>\n')
    write(repo, 'AGENTS.md', 'resolved by hand\n')
    record(run({ paths: ['AGENTS.md'] }))
    assert.equal(manifestOf().files['AGENTS.md'].tag, '1.1.0')
    assert.equal(manifestOf().files['AGENTS.md'].sha.length, 64)
  })

  // Points the OS temp folder at an empty one, so the failure markers and clones of the default fetch can be inspected.
  const withTempDir = (fn) => {
    const dir = join(tmp, 'os-tmp')
    mkdirSync(dir, { recursive: true })
    const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }
    Object.assign(process.env, { TEMP: dir, TMP: dir, TMPDIR: dir })
    try {
      return fn(dir)
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  }
  const noDefaultFetch = (extra = {}) => ({ repo, kitRoot: kit, agents: ['claude'], vars, ...extra })

  it('stays quiet about a repo-owned file whose base cannot be rebuilt: no fallback entry, no offer to run code', () => {
    apply(run({ accept: 'all' }))
    release('1.1.0')
    write(kit, 'templates/conv.md', 'conventions v2\n')
    const offline = plan(run({ fetchTag: () => { throw new Error('offline') } }))
    const e = entryOf(offline, '.qa-kit/project/conventions.md')
    assert.equal(e.status, 'kept')
    assert.equal(e.diff, '')
    assert.deepEqual(offline.baseFallbacks, [])
    assert.equal(offline.tagRendererOffer, null)

    const m = manifestOf()
    m.files['.qa-kit/project/conventions.md'].sha = shaOf('rendered by some other renderer\n')
    write(repo, '.qa-kit/manifest.json', JSON.stringify(m, null, 2))
    const mismatch = plan(run())
    assert.equal(mismatch.tagRendererOffer, null, 'a hash mismatch on a repo-owned file never offers to run code')
    assert.deepEqual(mismatch.baseFallbacks, [])
  })

  it('refuses a transport-helper URL and an option-like tag from the repo-controlled manifest', () => {
    withTempDir(() => {
      apply(run({ accept: 'all' }))
      release('1.1.0', 'brand new template\n')
      const viaUrl = plan(noDefaultFetch({ vars: { ...vars, KIT_GIT_URL: 'ext::sh -c "exit 0"' } }))
      assert.match(viaUrl.baseFallbacks[0].reason, /unusable kit URL/)
      const m = manifestOf()
      m.files['AGENTS.md'].tag = '-evil'
      write(repo, '.qa-kit/manifest.json', JSON.stringify(m, null, 2))
      const viaTag = plan(noDefaultFetch())
      assert.match(viaTag.baseFallbacks[0].reason, /unusable tag name/)
    })
  })

  it('a failed fetch is remembered for a few minutes, and leaves no temporary clone behind', () => {
    withTempDir((osTmp) => {
      apply(run({ accept: 'all' }))
      release('1.1.0', 'brand new template\n')
      const unreachable = { vars: { ...vars, KIT_GIT_URL: pathToFileURL(join(tmp, 'no-such-kit')).href } }
      const first = plan(noDefaultFetch(unreachable))
      assert.match(first.baseFallbacks[0].reason, /could not fetch tag 1\.0\.0/)
      const second = plan(noDefaultFetch(unreachable))
      assert.match(second.baseFallbacks[0].reason, /fetch failed recently/)
      const left = readdirSync(osTmp)
      assert.ok(!left.some((n) => n.startsWith('qa-kit-base-')), `temporary clones removed, found ${left}`)
      assert.ok(left.includes('qa-kit-fetch-failures'))
    })
  })

  it('a tag renderer that runs too long is stopped and the file falls back', () => {
    apply(run({ accept: 'all' }))
    write(repo, 'AGENTS.md', 'rendered by the old renderer\n')
    const m = manifestOf()
    m.files['AGENTS.md'].sha = shaOf('rendered by the old renderer\n')
    write(repo, '.qa-kit/manifest.json', JSON.stringify(m, null, 2))
    snapshot()
    write(snaps.get('1.0.0'), 'tools/merge.mjs', 'export function renderAll() { const end = Date.now() + 5000; while (Date.now() < end) {} return {} }\n')
    release('1.1.0', 'brand new template\n')
    const p = plan(run({ baseRenderer: 'tag', renderTimeoutMs: 400 }))
    assert.equal(entryOf(p, 'AGENTS.md').status, 'unknown-base')
    assert.match(p.baseFallbacks[0].reason, /renderer of tag 1\.0\.0 failed: timed out/)
  })

  describe('checking the recorded tag at init', () => {
    it('is ok when the tag renders what was just written, and is not run when nothing new was recorded', () => {
      const first = apply(run({ accept: 'all' }))
      assert.equal(first.tagCheck.status, 'ok')
      assert.equal(first.tagCheck.tag, '1.0.0')
      assert.ok(first.tagCheck.targets.includes('AGENTS.md'))
      assert.equal(apply(run({ fetchTag: neverFetch, accept: 'all' })).tagCheck, null)
    })

    it('is not run for line-merged files only', () => {
      assert.equal(apply(run({ fetchTag: neverFetch, accept: ['.gitignore'] })).tagCheck, null)
    })

    it('reports "differs" when the installed kit is ahead of its tag, and still writes everything', () => {
      apply(run({ accept: 'all' }))
      write(kit, 'templates/AGENTS.md.template', 'line1\nline2\nline3\nline4\nline5\nurl: <KIT_GIT_URL>\nunreleased line\n')
      const r = apply(run({ accept: 'all' })) // same version number, content ahead of tag 1.0.0
      assert.equal(r.tagCheck.status, 'differs')
      assert.deepEqual(r.tagCheck.targets, ['AGENTS.md'])
      assert.match(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), /unreleased line/)
      assert.equal(manifestOf().files['AGENTS.md'].tag, '1.0.0', 'the tag is still recorded, so a corrected tag heals it')
    })

    it('reports "missing" when git cannot find the tag, and "unverified" when it cannot reach the repository', () => {
      const notFound = Object.assign(new Error('clone failed'), { stderr: 'fatal: Remote branch 1.0.0 not found in upstream origin' })
      const missing = apply(run({ fetchTag: () => { throw notFound }, accept: 'all' }))
      assert.equal(missing.tagCheck.status, 'missing')
      assert.match(missing.tagCheck.reason, /Remote branch 1\.0\.0 not found/)
      rmSync(repo, { recursive: true, force: true })
      mkdirSync(repo)
      execFileSync('git', ['init', '-q'], { cwd: repo })
      const offline = apply(run({ fetchTag: () => { throw new Error('could not resolve host') }, accept: 'all' }))
      assert.equal(offline.tagCheck.status, 'unverified')
    })

    it('record checks the tag too', () => {
      apply(run({ accept: 'all' }))
      release('1.1.0', 'line1\nline2\nline3\nline4\nline5\nurl: KIT <KIT_GIT_URL>\n')
      write(repo, 'AGENTS.md', 'resolved by hand\n')
      assert.equal(record(run({ paths: ['AGENTS.md'] })).tagCheck.status, 'ok')
    })
  })

  it('keeps the older tag for a file whose content did not change', () => {
    apply(run({ accept: 'all' }))
    release('1.1.0')
    const r = apply(run({ fetchTag: neverFetch, accept: 'all' }))
    assert.equal(r.tagCheck, null)
    assert.equal(manifestOf().kitVersion, '1.1.0')
    assert.equal(manifestOf().files['AGENTS.md'].tag, '1.0.0')
  })

  it('a file skipped while the variables changed is still rebuilt with the variables it was written with', () => {
    apply(run({ accept: 'all' }))
    release('1.1.0')
    const lib = { vars: { ...vars, TEST_SOURCE_DIR: 'lib' } }
    apply(run({ ...lib, accept: ['AGENTS.md'] })) // .claude/settings.json (which uses TEST_SOURCE_DIR) is skipped
    assert.deepEqual(manifestOf().files['.claude/settings.json'].vars, { TEST_SOURCE_DIR: 'src' })
    assert.equal(manifestOf().vars.TEST_SOURCE_DIR, 'lib')
    release('1.2.0')
    const p = plan(run(lib))
    assert.equal(entryOf(p, '.claude/settings.json').status, 'fast-forward')
    assert.equal(entryOf(p, '.claude/settings.json').base, 'tag')
    assert.deepEqual(p.baseFallbacks, [])
    apply(run({ ...lib, accept: 'all' }))
    assert.equal(manifestOf().files['.claude/settings.json'].vars, undefined, 'settled records carry no override')
  })

  it('drops records of targets the kit no longer manages, unless a legacy copy still needs them', () => {
    apply(run({ accept: 'all' }))
    const m = manifestOf()
    m.files['.gitattributes'] = shaOf('old line\n')
    m.files['stale-two'] = shaOf('x\n')
    write(repo, '.qa-kit/manifest.json', JSON.stringify(m, null, 2))
    write(repo, '.qa-kit/base/stale-two', 'edited since the kit wrote it\n') // kept by the removal, so its record must stay
    apply(run({ accept: 'all' }))
    assert.equal(manifestOf().files['.gitattributes'], undefined)
    assert.ok('stale-two' in manifestOf().files, 'its legacy copy is still on disk')
    rmSync(join(repo, '.qa-kit/base'), { recursive: true, force: true })
    apply(run({ accept: 'all' }))
    assert.equal(manifestOf().files['stale-two'], undefined, 'pruned once the copy is gone')
  })

  describe('the merge tool from the command line', () => {
    const cli = (args, env = {}) => spawnSync(process.execPath, [fileURLToPath(new URL('../../tools/merge.mjs', import.meta.url)), ...args], { encoding: 'utf8', env: { ...process.env, ...env } })

    it('rejects an unknown --base-renderer value', () => {
      const r = cli(['plan', '--repo', repo, '--base-renderer', 'nope'])
      assert.equal(r.status, 1)
      assert.match(r.stderr, /--base-renderer takes current or tag/)
    })

    it('prints a fallback line in the plan when the base cannot be rebuilt', () => {
      withTempDir((osTmp) => {
        const env = { TEMP: osTmp, TMP: osTmp, TMPDIR: osTmp }
        const cliRepo = join(tmp, 'cli-repo')
        mkdirSync(cliRepo)
        const url = pathToFileURL(join(tmp, 'no-such-kit')).href
        const all = ['--repo', cliRepo, '--agents', 'claude', '--var', `KIT_GIT_URL=${url}`, '--var', 'TEST_SOURCE_DIR=src', '--var', 'PROJECT_NAME=p', '--var', 'PRODUCT_NAME=p']
        assert.equal(cli(['apply', ...all, '--accept', 'all'], env).status, 0)
        const m = JSON.parse(readFileSync(join(cliRepo, '.qa-kit/manifest.json'), 'utf8'))
        m.files['AGENTS.md'] = { sha: '0'.repeat(64), tag: '9.9.9' }
        write(cliRepo, '.qa-kit/manifest.json', JSON.stringify(m, null, 2))
        write(cliRepo, 'AGENTS.md', 'edited\n')
        const r = cli(['plan', ...all], env)
        assert.equal(r.status, 0, r.stderr)
        assert.match(r.stdout, /base fallback: AGENTS\.md - could not fetch tag 9\.9\.9/)
      })
    })
  })

  describe('upgrading a repo that still has the 0.3.x .qa-kit/base folder', () => {
    // Turns a fresh install into what 0.3.x left behind: v1 records (hash only) and a copy of every file.
    const asZeroThree = () => {
      apply(run({ accept: 'all' }))
      const m = manifestOf()
      for (const [target, rec] of Object.entries(m.files)) {
        write(repo, `.qa-kit/base/${target}`, readFileSync(join(repo, target), 'utf8'))
        m.files[target] = rec.sha
      }
      write(repo, '.qa-kit/manifest.json', JSON.stringify(m, null, 2))
    }
    const legacyFiles = () => (existsSync(join(repo, '.qa-kit/base')) ? true : false)

    it('uses the copies as the base (no network), lists the folder in the plan and removes it on accept', () => {
      asZeroThree()
      release('1.1.0', 'line1\nline2\nline3\nline4\nline5\nurl: <KIT_GIT_URL>\nnew kit line\n')
      const p = plan(run({ fetchTag: neverFetch }))
      assert.equal(entryOf(p, 'AGENTS.md').status, 'fast-forward')
      assert.equal(entryOf(p, 'AGENTS.md').base, 'migrated')
      const gone = entryOf(p, '.qa-kit/base/')
      assert.equal(gone.status, 'remove')
      assert.ok(gone.files.includes('AGENTS.md') && gone.files.includes('.claude/settings.json'))
      assert.ok(legacyFiles(), 'plan removes nothing')
      const r = apply(run({ fetchTag: neverFetch, accept: 'all' }))
      assert.deepEqual(r.legacyBase.blockedBy, [])
      assert.deepEqual(r.legacyBase.kept, [])
      assert.ok(r.legacyBase.removed.includes('AGENTS.md'))
      assert.ok(!legacyFiles(), 'the folder is gone')
      assert.equal(manifestOf().files['AGENTS.md'].tag, '1.1.0')
      assert.ok(Object.values(manifestOf().files).every((rec) => rec.legacy === undefined), 'no leftover marker')
      assert.ok(plan(run({ fetchTag: neverFetch })).entries.every((e) => ['unchanged', 'kept'].includes(e.status)))
    })

    it('never runs git while removing it', () => {
      asZeroThree()
      release('1.1.0')
      apply(run({ accept: 'all' }))
      assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' }), '')
    })

    it('keeps a copy that was edited, does not trust it as a base, and says so', () => {
      asZeroThree()
      write(repo, '.qa-kit/base/AGENTS.md', 'someone edited the old copy\n')
      release('1.1.0', 'line1\nline2\nline3\nline4\nline5\nurl: <KIT_GIT_URL>\nnew kit line\n')
      const p = plan(run())
      assert.equal(entryOf(p, 'AGENTS.md').base, 'tag', 'rebuilt from the tag instead')
      const r = apply(run({ accept: 'all' }))
      assert.deepEqual(r.legacyBase.kept, ['AGENTS.md'])
      assert.ok(r.legacyBase.removed.includes('.claude/settings.json'))
      assert.equal(readFileSync(join(repo, '.qa-kit/base/AGENTS.md'), 'utf8'), 'someone edited the old copy\n')
    })

    it('keeps the folder while a skipped file still depends on it, and removes it once that is settled', () => {
      asZeroThree()
      release('1.1.0', 'line1\nline2\nline3\nline4\nline5\nurl: <KIT_GIT_URL>\nnew kit line\n')
      const first = apply(run({ accept: ['.claude/settings.json', '.qa-kit/project/conventions.md', '.gitignore', '.qa-kit/base/'] }))
      assert.deepEqual(first.legacyBase.blockedBy, ['AGENTS.md'])
      assert.deepEqual(first.legacyBase.removed, [])
      assert.ok(legacyFiles())
      const second = apply(run({ accept: 'all' }))
      assert.deepEqual(second.legacyBase.blockedBy, [])
      assert.ok(second.legacyBase.removed.includes('AGENTS.md'))
      assert.ok(!legacyFiles())
    })

    it('keeps the folder when the entry is not accepted', () => {
      asZeroThree()
      release('1.1.0')
      const r = apply(run({ accept: ['AGENTS.md'] }))
      assert.equal(r.legacyBase.skipped, true)
      assert.ok(legacyFiles())
    })

    it('ignores the copies for files that already have a v2 record', () => {
      apply(run({ accept: 'all' }))
      write(repo, '.qa-kit/base/AGENTS.md', 'a stray copy\n')
      release('1.1.0', 'line1\nline2\nline3\nline4\nline5\nurl: <KIT_GIT_URL>\nnew kit line\n')
      const p = plan(run())
      assert.equal(entryOf(p, 'AGENTS.md').base, 'tag')
      const r = apply(run({ accept: 'all' }))
      assert.deepEqual(r.legacyBase.kept, ['AGENTS.md'], 'a copy nothing vouches for is never deleted')
    })

    it('without the copies, a v1 record is rebuilt from the tag of the last merged kit version', () => {
      asZeroThree()
      rmSync(join(repo, '.qa-kit/base'), { recursive: true, force: true })
      release('1.1.0', 'line1\nline2\nline3\nline4\nline5\nurl: <KIT_GIT_URL>\nnew kit line\n')
      const p = plan(run())
      assert.equal(entryOf(p, 'AGENTS.md').status, 'fast-forward')
      assert.equal(entryOf(p, 'AGENTS.md').base, 'tag')
      assert.equal(entryOf(p, '.qa-kit/base/'), undefined)
    })
  })
})

describe('the shipped kit templates', () => {
  let tmp
  const vars = { KIT_GIT_URL: 'https://example.test/org/qa-kit.git', TEST_SOURCE_DIR: 'tests', PROJECT_NAME: 'p', PRODUCT_NAME: 'p' }
  const run = (extra = {}) => ({ repo: tmp, agents: ['claude', 'opencode'], vars, ...extra })

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'qa-kit-real-'))
    execFileSync('git', ['init', '-q'], { cwd: tmp })
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('writes no base folder and no .gitattributes line, and a re-run changes nothing without any fetch', () => {
    const p = plan(run())
    assert.equal(p.entries.find((e) => e.target === '.gitattributes'), undefined)
    apply(run({ accept: 'all' }))
    assert.ok(!existsSync(join(tmp, '.gitattributes')))
    assert.ok(!existsSync(join(tmp, '.qa-kit/base')))
    const again = plan(run({ fetchTag: () => { throw new Error('must not fetch when the kit renders what was recorded') } }))
    assert.ok(again.entries.every((e) => ['unchanged', 'kept'].includes(e.status)))
    assert.deepEqual(again.baseFallbacks, [])
  })

  it('leaves the repo\'s own .gitattributes alone', () => {
    writeFileSync(join(tmp, '.gitattributes'), '* text=auto\n')
    apply(run({ accept: 'all' }))
    assert.equal(readFileSync(join(tmp, '.gitattributes'), 'utf8'), '* text=auto\n')
  })
})

describe('review copies', () => {
  it('never land in an unprotected folder: qa-kit-artifacts ignores itself before the first copy is written, even if its own entry is declined', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'qa-kit-rc-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: tmp })
      writeFileSync(join(tmp, 'AGENTS.md'), ['something the repo already had', ''].join('\n')) // no recorded base -> needs a manual merge
      const r = apply({ repo: tmp, agents: ['claude'], vars: { KIT_GIT_URL: 'https://example.test/o/qa-kit.git', TEST_SOURCE_DIR: 'tests', PROJECT_NAME: 'p', PRODUCT_NAME: 'p' }, accept: ['AGENTS.md'] })
      assert.deepEqual(r.needsManual, ['qa-kit-artifacts/merge/AGENTS.md'])
      assert.equal(readFileSync(join(tmp, 'qa-kit-artifacts', '.gitignore'), 'utf8'), '*\n')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('installing into a subfolder of a larger repo (--path)', () => {
  let tmp, sub
  const vars = { KIT_GIT_URL: 'https://example.test/org/qa-kit.git', TEST_SOURCE_DIR: 'tests', PROJECT_NAME: 'p', PRODUCT_NAME: 'p' }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'qa-kit-sub-'))
    execFileSync('git', ['init', '-q'], { cwd: tmp })
    writeFileSync(join(tmp, 'CLAUDE.md'), '# Developer CLAUDE.md\n')
    writeFileSync(join(tmp, '.gitignore'), 'node_modules/\n')
    sub = join(tmp, 'automation')
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('writes every file, the state folder and the artifacts ignore under the subfolder only', () => {
    const r = apply({ repo: sub, agents: ['claude', 'opencode'], vars, accept: 'all' })
    assert.equal(r.needsManual.length, 0)
    for (const f of ['AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.mcp.json', 'opencode.json', '.gitignore',
      '.qa-kit/manifest.json', '.qa-kit/project/conventions.md', 'qa-kit-artifacts/.gitignore']) {
      assert.ok(existsSync(join(sub, f)), `${f} should be under automation/`)
    }
    // The repo root keeps exactly what the Developers had.
    assert.equal(readFileSync(join(tmp, 'CLAUDE.md'), 'utf8'), '# Developer CLAUDE.md\n')
    assert.equal(readFileSync(join(tmp, '.gitignore'), 'utf8'), 'node_modules/\n')
    for (const f of ['AGENTS.md', '.mcp.json', 'opencode.json', '.claude', '.qa-kit', '.gitattributes']) {
      assert.ok(!existsSync(join(tmp, f)), `${f} must not appear at the repo root`)
    }
  })

  it('updates in place on a second run from the same folder', () => {
    apply({ repo: sub, agents: ['claude'], vars, accept: 'all' })
    const again = plan({ repo: sub, vars })
    assert.ok(again.entries.every((e) => e.status === 'unchanged' || e.status === 'kept'))
  })
})
