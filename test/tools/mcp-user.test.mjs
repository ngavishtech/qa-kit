import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { envNames, forPlatform, loadServers, main, parseArgs, setupClaude, setupOpenCode } from '../../tools/mcp-user.mjs'

describe('user-level MCP setup', () => {
  let dir
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qa-kit-mcp-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const servers = loadServers()
  const file = () => join(dir, 'opencode.json')
  const read = () => JSON.parse(readFileSync(file(), 'utf8'))

  it('loads the same five servers init writes, or a chosen subset', () => {
    assert.deepEqual(Object.keys(servers).sort(), ['atlassian', 'figma', 'glean_default', 'playwright', 'testrail'])
    assert.deepEqual(Object.keys(loadServers(['figma'])), ['figma'])
    assert.throws(() => loadServers(['nope']), /unknown server/)
  })

  it('reports env var names, never values', () => {
    assert.deepEqual(envNames(servers.figma), ['FIGMA_API_KEY'])
    assert.deepEqual(envNames(servers.glean_default), ['GLEAN_URL'])
    assert.deepEqual(envNames(servers.atlassian), [])
  })

  describe('OpenCode', () => {
    it('creates opencode.json with the V2 shape and {env:VAR} references', () => {
      const r = setupOpenCode({ servers, configDir: dir })
      assert.equal(r.added.length, 5)
      assert.equal(read().mcp.servers.figma.environment.FIGMA_API_KEY, '{env:FIGMA_API_KEY}')
      assert.equal(read().mcp.servers.glean_default.type, 'remote')
      assert.equal(read().mcp.servers.glean_default.url, '{env:GLEAN_URL}')
    })

    it('keeps existing servers and unrelated settings, adds only what is missing', () => {
      writeFileSync(file(), JSON.stringify({ theme: 'dark', mcp: { servers: { figma: { type: 'remote', url: 'https://mine.test' } } } }))
      const r = setupOpenCode({ servers, configDir: dir })
      assert.deepEqual(r.kept, ['figma'])
      assert.equal(read().mcp.servers.figma.url, 'https://mine.test')
      assert.equal(read().theme, 'dark')
      assert.ok(read().mcp.servers.atlassian)
    })

    it('dry run writes nothing', () => {
      setupOpenCode({ servers, configDir: dir, dryRun: true })
      assert.throws(() => readFileSync(file()))
    })

    it('refuses files it cannot edit safely', () => {
      writeFileSync(join(dir, 'opencode.jsonc'), '{ // comment\n}')
      assert.throws(() => setupOpenCode({ servers, configDir: dir }), /opencode\.jsonc/)
      rmSync(join(dir, 'opencode.jsonc'))
      writeFileSync(file(), '{ "a": 1, }')
      assert.throws(() => setupOpenCode({ servers, configDir: dir }), /not plain JSON/)
      writeFileSync(file(), JSON.stringify({ mcp: { figma: { type: 'remote', url: 'x' } } }))
      assert.throws(() => setupOpenCode({ servers, configDir: dir }), /V1 schema/)
    })
  })

  describe('Claude Code', () => {
    const fake = (existing = [], failAdd = []) => {
      const calls = []
      const exec = (args) => {
        calls.push(args)
        if (args[0] === '--version') return { status: 0 }
        if (args[1] === 'get') return { status: existing.includes(args[2]) ? 0 : 1 }
        return { status: failAdd.includes(args[4]) ? 1 : 0 }
      }
      return { exec, calls }
    }

    it('adds missing servers at user scope with the template JSON, placeholders intact', () => {
      const { exec, calls } = fake(['atlassian'])
      const r = setupClaude({ servers, exec })
      assert.deepEqual(r.kept, ['atlassian'])
      assert.equal(r.added.length, 4)
      const add = calls.find((c) => c[1] === 'add-json' && c[4] === 'testrail')
      assert.deepEqual(add.slice(0, 4), ['mcp', 'add-json', '--scope', 'user'])
      assert.equal(JSON.parse(add[5]).env.TESTRAIL_API_KEY, '${TESTRAIL_API_KEY}')
    })

    it('dry run only checks, never adds', () => {
      const { exec, calls } = fake()
      setupClaude({ servers, exec, dryRun: true })
      assert.ok(calls.every((c) => c[1] !== 'add-json'))
    })

    it('prints a manual command when an add fails', () => {
      const { exec } = fake([], ['figma'])
      const r = setupClaude({ servers, exec })
      assert.equal(r.failed.length, 1)
      assert.match(r.failed[0].command, /^claude mcp add-json --scope user figma '\{/)
    })

    it('prints the exact manual commands when the claude CLI is missing', () => {
      const r = setupClaude({ servers, exec: () => ({ status: null }) })
      assert.match(r.unavailable, /not found on PATH/)
      assert.equal(r.failed.length, 5)
      assert.ok(r.failed.every((f) => f.command.startsWith('claude mcp add-json --scope user ')))
      assert.deepEqual(r.added, [])
    })

    it('explains the npm .cmd shim problem separately', () => {
      const r = setupClaude({ servers, exec: () => ({ status: null, error: { code: 'EINVAL' } }) })
      assert.match(r.unavailable, /native claude\.exe/)
    })

    it('wraps npx stdio servers in cmd /c on Windows only, leaving remote servers alone', () => {
      assert.deepEqual(forPlatform(servers.figma, 'win32').args.slice(0, 2), ['/c', 'npx'])
      assert.equal(forPlatform(servers.figma, 'win32').command, 'cmd')
      assert.equal(forPlatform(servers.figma, 'linux'), servers.figma)
      assert.equal(forPlatform(servers.glean_default, 'win32'), servers.glean_default)
      const { exec, calls } = fake()
      setupClaude({ servers: { figma: servers.figma }, exec, platform: 'win32' })
      const add = calls.find((c) => c[1] === 'add-json')
      assert.equal(JSON.parse(add[5]).command, 'cmd')
      assert.equal(JSON.parse(add[5]).env.FIGMA_API_KEY, '${FIGMA_API_KEY}')
    })
  })

  describe('CLI', () => {
    it('requires --agent and rejects unknown arguments', () => {
      assert.throws(() => parseArgs([]), /usage/)
      assert.throws(() => parseArgs(['--agent', 'claude', '--bogus']), /unknown argument/)
    })

    it('runs end to end for OpenCode in a temp config dir', () => {
      const r = main(['--agent', 'opencode', '--dir', dir, '--servers', 'glean_default,figma'])
      assert.deepEqual(r.added.sort(), ['figma', 'glean_default'])
      assert.deepEqual(Object.keys(read().mcp.servers).sort(), ['figma', 'glean_default'])
    })
  })
})
