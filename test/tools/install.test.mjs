import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { buildBundle, install, installedVersion, uninstall } from '../../tools/install.mjs'

describe('OpenCode bundle', () => {
  let configDir
  beforeEach(() => { configDir = mkdtempSync(join(tmpdir(), 'qa-kit-oc-')) })
  afterEach(() => rmSync(configDir, { recursive: true, force: true }))

  const bundle = () => buildBundle(join(import.meta.dirname, '..', '..'), configDir)
  const textOf = (rel) => bundle().get(rel)

  it('prefixes every skill, agent and command with qa-kit- and matches names to folders', () => {
    for (const [rel, text] of bundle()) {
      const skill = /^skills\/(qa-kit-[^/]+)\/SKILL\.md$/.exec(rel)
      if (skill) assert.match(text, new RegExp(`^---\\nname: ${skill[1]}\\n`), rel)
    }
    const names = [...bundle().keys()]
    assert.ok(names.includes('skills/qa-kit-plan-tests/SKILL.md'))
    assert.ok(names.includes('agents/qa-kit-agent-writer.md'))
    assert.ok(names.includes('commands/qa-kit-plan-tests.md'))
    assert.ok(names.includes('commands/qa-kit-feature-implement.md'))
  })

  it('leaves no Claude-only constructs in rendered skills, agents, commands or patterns', () => {
    for (const [rel, text] of bundle()) {
      if (!/^(skills|agents|commands|qa-kit\/(patterns|docs))\//.test(rel)) continue
      assert.doesNotMatch(text, /\$\{CLAUDE_PLUGIN_ROOT\}/, rel)
      assert.doesNotMatch(text, /mcp__/, rel)
      assert.doesNotMatch(text, /qa-kit:/, rel)
      assert.doesNotMatch(text, /^allowed-tools:/m, rel)
    }
  })

  it('points plugin-root paths at the installed support directory', () => {
    const skill = textOf('skills/qa-kit-write-tests/SKILL.md')
    const root = join(configDir, 'qa-kit').replaceAll('\\', '/')
    assert.ok(skill.includes(`${root}/patterns/`), 'patterns path rewritten')
    assert.ok(skill.includes(`${configDir.replaceAll('\\', '/')}/skills/qa-kit-`), 'skill path rewritten')
  })

  it('every installed path a rendered file points at exists in the bundle', () => {
    const files = bundle()
    const cfg = configDir.replaceAll('\\', '/')
    const escaped = cfg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const missing = []
    for (const [rel, body] of files) {
      if (!/^(skills|agents|commands|qa-kit\/(patterns|docs))\//.test(rel)) continue
      for (const [, path] of body.matchAll(new RegExp(`${escaped}/([A-Za-z0-9_./-]+)`, 'g'))) {
        const clean = path.replace(/[.,;:]+$/, '')
        if (clean.endsWith('-')) continue
        const dir = clean.replace(/\/$/, '')
        const found = files.has(clean) || [...files.keys()].some((k) => k.startsWith(`${dir}/`))
        if (!found) missing.push(`${rel}: ${clean}`)
      }
    }
    assert.deepEqual(missing, [])
  })

  it('maps agent file references to the installed agents folder', () => {
    const planTests = bundle().get('skills/qa-kit-plan-tests/SKILL.md')
    assert.ok(planTests.includes(`${configDir.replaceAll('\\', '/')}/agents/qa-kit-agent-planner.md`))
  })

  it('renders MCP tool names in OpenCode style', () => {
    assert.match(textOf('skills/qa-kit-read-ticket/SKILL.md'), /atlassian_/)
  })

  it('does not rewrite templates (they list both agents explicitly)', () => {
    const agents = textOf('qa-kit/templates/AGENTS.md.template')
    assert.match(agents, /\/qa-kit:feature-plan/)
    assert.match(agents, /\/qa-kit-feature-plan/)
  })

  it('ships only the merge tool, not the installer', () => {
    const tools = [...bundle().keys()].filter((k) => k.startsWith('qa-kit/tools/'))
    assert.ok(tools.includes('qa-kit/tools/merge.mjs'))
    assert.ok(!tools.some((k) => k.endsWith('install.mjs') || k.endsWith('render.mjs')))
  })

  it('installs, is idempotent, and records every file', () => {
    const first = install({ configDir })
    assert.ok(first.written.length > 50)
    const second = install({ configDir })
    assert.equal(second.written.length, 0)
    assert.equal(second.unchanged.length, first.written.length)
    assert.equal(installedVersion(configDir), first.version)
  })

  it('does not overwrite a locally edited file unless forced', () => {
    install({ configDir })
    const f = join(configDir, 'skills/qa-kit-fix-lint/SKILL.md')
    writeFileSync(f, 'edited by me\n')
    assert.deepEqual(install({ configDir }).skipped, ['skills/qa-kit-fix-lint/SKILL.md'])
    assert.equal(readFileSync(f, 'utf8'), 'edited by me\n')
    install({ configDir, force: true })
    assert.notEqual(readFileSync(f, 'utf8'), 'edited by me\n')
  })

  it('never takes over a file it did not write', () => {
    const f = join(configDir, 'skills/qa-kit-fix-lint/SKILL.md')
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, 'someone else\n')
    assert.ok(install({ configDir }).skipped.includes('skills/qa-kit-fix-lint/SKILL.md'))
    assert.equal(readFileSync(f, 'utf8'), 'someone else\n')
  })

  it('dry run writes nothing', () => {
    install({ configDir, dryRun: true })
    assert.equal(readdirSync(configDir).length, 0)
  })

  it('uninstall removes what it wrote, keeps edited files, and prunes empty folders', () => {
    install({ configDir })
    const edited = join(configDir, 'agents/qa-kit-agent-writer.md')
    writeFileSync(edited, 'mine\n')
    const r = uninstall({ configDir })
    assert.deepEqual(r.skipped, ['agents/qa-kit-agent-writer.md'])
    assert.ok(existsSync(edited))
    assert.ok(!existsSync(join(configDir, 'skills')))
    assert.ok(!existsSync(join(configDir, 'qa-kit', 'patterns')))
  })

  it('bundles every file the bundled tools import or locate next to themselves (init must run from the installed copy)', () => {
    const files = bundle()
    const missing = []
    for (const [rel, text] of files) {
      if (!/^qa-kit\/tools\/.+\.mjs$/.test(rel)) continue
      const refs = [...text.matchAll(/from '(\.{1,2}\/[^']+)'/g), ...text.matchAll(/new URL\('(\.{1,2}\/[^']+)'/g)].map((m) => m[1])
      for (const ref of refs) {
        const target = posix.normalize(posix.join(posix.dirname(rel), ref))
        if (!files.has(target)) missing.push(`${rel} -> ${target}`)
      }
    }
    assert.deepEqual(missing, [])
    assert.ok(files.has('qa-kit/tools/lib/render-helper.mjs'), 'the tag-renderer helper is part of the install')
  })

  it('the installed merge tool and tag-renderer helper run from the installed copy', () => {
    install({ configDir })
    const kit = join(configDir, 'qa-kit')
    const repo = mkdtempSync(join(tmpdir(), 'qa-kit-oc-repo-'))
    try {
      const vars = { KIT_GIT_URL: 'https://example.test/org/qa-kit.git', TEST_SOURCE_DIR: 'src', PROJECT_NAME: 'p', PRODUCT_NAME: 'p' }
      const planned = spawnSync(process.execPath, [join(kit, 'tools', 'merge.mjs'), 'plan', '--repo', repo, '--agents', 'claude', ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}=${v}`])], { encoding: 'utf8' })
      assert.equal(planned.status, 0, planned.stderr)
      assert.match(planned.stdout, /\[create\] AGENTS\.md/)

      // The installed copy acts as the "clone of a tag": the helper renders every template with its own renderer.
      const varsFile = join(repo, 'vars.json')
      writeFileSync(varsFile, JSON.stringify(vars))
      const empty = join(repo, 'empty')
      mkdirSync(empty)
      const rendered = spawnSync(process.execPath, [join(kit, 'tools', 'lib', 'render-helper.mjs'), kit, varsFile, 'claude', empty], { cwd: empty, encoding: 'utf8' })
      assert.equal(rendered.status, 0, rendered.stderr)
      assert.match(JSON.parse(rendered.stdout)['AGENTS.md'], /example\.test/)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
