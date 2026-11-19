import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it } from 'node:test'
import { splitFrontmatter } from '../../tools/lib/render.mjs'

const ROOT = join(import.meta.dirname, '..', '..')
const CONTENT_DIRS = ['skills', 'agents', 'commands', 'patterns', 'workflows', 'docs', 'opencode', 'templates']

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const full = join(dir, n)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const files = CONTENT_DIRS.flatMap((d) => walk(join(ROOT, d)))
const text = new Map(files.map((f) => [relative(ROOT, f).replaceAll('\\', '/'), readFileSync(f, 'utf8')]))
const names = (dir) => readdirSync(join(ROOT, dir)).map((n) => n.replace(/\.md$/, ''))
const skills = names('skills')
const commands = names('commands')

describe('references resolve', () => {
  it('every ${CLAUDE_PLUGIN_ROOT}/... path points at an existing file', () => {
    const broken = []
    for (const [file, body] of text) {
      for (const [, path] of body.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
        const clean = path.replace(/[.,;:]+$/, '')
        if (!existsSync(join(ROOT, clean))) broken.push(`${file}: ${clean}`)
      }
    }
    assert.deepEqual(broken, [])
  })

  it('every /qa-kit:<name> is a skill or a command', () => {
    const unknown = []
    for (const [file, body] of text) {
      for (const [, name] of body.matchAll(/\/qa-kit:([a-z][a-z0-9-]*)(?![a-z0-9*-])/g)) {
        if (!skills.includes(name) && !commands.includes(name)) unknown.push(`${file}: /qa-kit:${name}`)
      }
    }
    assert.deepEqual(unknown, [])
  })

  it('every patterns/, docs/ and templates/ file named in prose exists', () => {
    const broken = []
    for (const [file, body] of text) {
      for (const [, path] of body.matchAll(/`((?:patterns|docs)\/[A-Za-z0-9_-]+\.md)`/g)) {
        if (!existsSync(join(ROOT, path))) broken.push(`${file}: ${path}`)
      }
    }
    assert.deepEqual(broken, [])
  })

  it('every agent a workflow addresses exists', () => {
    const agents = names('agents')
    const used = new Set()
    for (const [file, body] of text) {
      if (!file.startsWith('workflows/')) continue
      for (const [, name] of body.matchAll(/'(test-[a-z]+)'/g)) used.add(name)
    }
    for (const name of used) assert.ok(agents.includes(name), `workflow uses unknown agent ${name}`)
  })
})

describe('frontmatter', () => {
  it('skills: name matches the folder, description present', () => {
    for (const s of skills) {
      const { fields } = splitFrontmatter(text.get(`skills/${s}/SKILL.md`))
      assert.equal(fields.get('name'), s)
      assert.ok(fields.get('description')?.length > 40, `${s} needs a real description`)
    }
  })

  it('agents: name matches the file, description present', () => {
    for (const a of names('agents')) {
      const { fields } = splitFrontmatter(text.get(`agents/${a}.md`))
      assert.equal(fields.get('name'), a)
      assert.ok(fields.get('description'))
    }
  })

  it('commands (both agents) have a description', () => {
    for (const c of commands) assert.ok(splitFrontmatter(text.get(`commands/${c}.md`)).fields.get('description'), c)
    for (const c of names('opencode/commands')) {
      assert.ok(splitFrontmatter(text.get(`opencode/commands/${c}.md`)).fields.get('description'), c)
      assert.ok(commands.includes(c), `opencode/commands/${c} has no Claude counterpart`)
    }
  })

  it('user-invocation-only skills stay that way', () => {
    for (const s of ['init', 'commit-and-push', 'create-pr', 'write-commit-message']) {
      assert.match(splitFrontmatter(text.get(`skills/${s}/SKILL.md`)).fields.get('disable-model-invocation'), /true/, s)
    }
    for (const c of commands) {
      assert.match(splitFrontmatter(text.get(`commands/${c}.md`)).fields.get('disable-model-invocation'), /true/, c)
    }
  })
})

describe('read-only skills stay read-only', () => {
  const tools = (skill) => splitFrontmatter(text.get(`skills/${skill}/SKILL.md`)).fields.get('allowed-tools').split(',').map((x) => x.trim())

  it('verify-coverage and review-tests have no edit, write or MCP tool', () => {
    for (const s of ['verify-coverage', 'review-tests']) {
      for (const tool of tools(s)) assert.ok(['Read', 'Glob', 'Grep', 'Bash'].includes(tool), `${s} grants ${tool}`)
    }
  })

  const READ_ONLY_JIRA = /^mcp__(atlassian__(get|search|lookup)\*|glean_default__(search|read_document))$/
  const VERDICTS = ['product-bug', 'known-issue', 'deviation', 'product-gap', 'test-fix', 'flaky', 'environment', 'unverified']

  it('triage-failure and test-triager reach Jira and Glean read-only, wherever the tools are listed', () => {
    const agentFields = splitFrontmatter(text.get('agents/test-triager.md')).fields
    const agentTools = agentFields.get('tools').split(',').map((x) => x.trim())
    for (const granted of [tools('triage-failure'), agentTools]) {
      for (const tool of granted.filter((x) => /^mcp__(atlassian|glean_default)__/.test(x))) assert.match(tool, READ_ONLY_JIRA, tool)
    }
    assert.ok(!agentTools.includes('mcp__playwright__browser_run_code_unsafe'))
    assert.equal(agentFields.get('name'), 'test-triager')
  })

  it('triage-failure states its limits and names every verdict it can give', () => {
    const body = text.get('skills/triage-failure/SKILL.md')
    assert.match(body, /never creates, edits, transitions or comments on a Jira issue/i)
    assert.match(body, /edits test code only with `--heal`/i)
    assert.match(body, /never changes git state/i)
    assert.match(body, /uncommitted changes/i)
    assert.match(body, /asks no questions/i)
    for (const verdict of VERDICTS) assert.match(body, new RegExp('\\*\\*' + verdict + '\\*\\*'), verdict)
    assert.doesNotMatch(body, /test-issue/)
  })

  it('test-triager passes the skill flags through and never adds --heal itself', () => {
    const body = text.get('agents/test-triager.md')
    assert.match(body, /skills\/triage-failure\/SKILL\.md/)
    assert.match(body, /never add `--heal` yourself/)
  })

  it('the Review stage and the planner both name verify-coverage', () => {
    assert.match(text.get('agents/test-reviewer.md'), /verify-coverage/)
    assert.match(text.get('skills/plan-tests/SKILL.md'), /verify-coverage/)
    assert.match(text.get('workflows/feature-implement.js'), /verify-coverage/)
  })
})

describe('delivery and coverage rules stay written down', () => {
  it('the conventions template names a List tests command and the skills read it', () => {
    assert.match(text.get('templates/project/conventions.md'), /List tests[^\n]*npx playwright test --list --reporter=json/)
    for (const file of ['skills/verify-coverage/SKILL.md', 'skills/plan-tests/SKILL.md', 'skills/write-tests/SKILL.md']) {
      assert.match(text.get(file), /List tests/, file)
    }
  })

  it('write-tests skips covered scenarios on every run and extends instead of copying', () => {
    const body = text.get('skills/write-tests/SKILL.md')
    assert.match(body, /apply to every run, whether or not a level was named/)
    assert.match(body, /Extends <file> "<test>"/)
    assert.match(text.get('patterns/test-plan-format.md'), /Extends <file> "<test title>": <what this scenario adds>/)
  })

  it('create-pr and test-deliverer agree: no edit tool means a blocked gate, not a silent fix', () => {
    assert.match(text.get('skills/create-pr/SKILL.md'), /When the caller has no edit tool/)
    const deliverer = text.get('agents/test-deliverer.md')
    assert.ok(!splitFrontmatter(deliverer).fields.get('tools').split(',').map((x) => x.trim()).includes('Edit'))
    assert.match(deliverer, /return a blocked result/)
    assert.match(deliverer, /skippedPaths/)
    assert.match(deliverer, /handChanges/)
    assert.match(text.get('workflows/feature-deliver.js'), /return those paths in handChanges/)
  })

  it('the pipeline prompts and docs name the ledger the guard enforces', () => {
    for (const file of ['workflows/feature-implement.js', 'workflows/feature-deliver.js', 'patterns/workflows-reference.md', 'README.md']) {
      assert.match(file.endsWith('README.md') ? readFileSync(join(ROOT, file), 'utf8') : text.get(file), /ownedFiles/, file)
    }
  })
})

describe('the help screen stays complete and short', () => {
  const body = text.get('skills/help/SKILL.md')
  const overview = body.split('```')[1] ?? ''

  it('names every skill and every command, so a new one cannot be forgotten', () => {
    const missing = [...skills, ...commands].filter((name) => !new RegExp(`(^|[^a-z-])${name}([^a-z-]|$)`, 'm').test(overview))
    assert.deepEqual(missing, [])
  })

  it('stays one screen (the overview block is at most 70 lines)', () => {
    assert.ok(overview.trim().split('\n').length <= 70, `${overview.trim().split('\n').length} lines`)
  })

  it('can be picked by plain language and is announced where people start', () => {
    assert.equal(splitFrontmatter(body).fields.get('disable-model-invocation'), undefined)
    assert.match(text.get('skills/init/SKILL.md'), /\/qa-kit:help/)
    assert.match(text.get('templates/AGENTS.md.template'), /`\/qa-kit:help`[^\n]*`\/qa-kit-help`/)
  })

  it('only changes nothing: no write or shell tool', () => {
    const tools = splitFrontmatter(body).fields.get('allowed-tools').split(',').map((x) => x.trim())
    assert.deepEqual(tools.sort(), ['Glob', 'Read'])
  })
})

describe('product-agnostic and no personal data', () => {
  it('has no PEAPP-/VIS- ticket keys', () => {
    const hits = [...text].filter(([, body]) => /\b(PEAPP|VIS)-\d+/i.test(body)).map(([f]) => f)
    assert.deepEqual(hits, [])
  })

  it('names no specific AI model or vendor identity in shipped instructions', () => {
    const hits = [...text]
      .filter(([f]) => f.startsWith('skills/') || f.startsWith('agents/') || f.startsWith('patterns/'))
      .filter(([, body]) => /Claude (Sonnet|Opus|Haiku)|noreply@anthropic\.com/.test(body))
      .map(([f]) => f)
    assert.deepEqual(hits, [])
  })
})

describe('style', () => {
  it('uses plain ASCII dashes, arrows, quotes and ellipses', () => {
    const hits = [...text].filter(([, body]) => /[–—→←≤≥‘’“”…]/.test(body)).map(([f]) => f)
    assert.deepEqual(hits, [])
  })
})

describe('text that is rendered for both agents', () => {
  // skills, agents, patterns and docs are rewritten for OpenCode at install time, so they may only carry the
  // Claude form (the renderer produces the OpenCode form). Naming both forms makes the render say it twice.
  const rendered = [...text].filter(([f]) => /^(skills|agents|patterns|docs)\//.test(f))

  it('never writes the OpenCode form of a command, prefix or tool name', () => {
    const bad = []
    for (const [file, body] of rendered) {
      if (/\/qa-kit-(?!artifacts)[a-z]|`qa-kit-`|`<server(-key)?>_<tool>`|OpenCode spells/.test(body)) bad.push(file)
    }
    assert.deepEqual(bad, [])
  })

  it('does not tie MCP configuration to a Claude-only file name', () => {
    const bad = []
    for (const [file, body] of rendered) {
      if (!file.startsWith('docs/') && /configured in `\.mcp\.json`/.test(body)) bad.push(file)
    }
    assert.deepEqual(bad, [])
  })
})

describe('YAML safety', () => {
  it('no frontmatter value contains ": " unless it is quoted', () => {
    const bad = []
    for (const [file, body] of text) {
      if (!/^(skills|agents|commands|opencode\/commands)\//.test(file)) continue
      for (const [key, value] of splitFrontmatter(body).fields) {
        if (value.includes(': ') && !/^['"]/.test(value)) bad.push(`${file}: ${key}`)
      }
    }
    assert.deepEqual(bad, [])
  })
})

describe('MCP template', () => {
  it('every npx server is non-interactive (-y) and stays on @latest (decision: no pinned versions)', () => {
    const servers = JSON.parse(text.get('templates/mcp.json')).mcpServers
    for (const [name, s] of Object.entries(servers)) {
      if (s.command !== 'npx') continue
      assert.equal(s.args[0], '-y', `${name} needs -y`)
      assert.match(s.args[1], /@latest$/, `${name} must use @latest`)
    }
  })
})

describe('template variables', () => {
  const manifest = JSON.parse(text.get('templates/manifest.json'))
  const used = new Set()
  for (const f of manifest.files.filter((x) => x.update === 'merge')) {
    for (const [, name] of text.get(`templates/${f.source}`).matchAll(/<([A-Z][A-Z_]+)>/g)) used.add(name)
  }

  it('every placeholder in a kit-merged template is a declared variable', () => {
    for (const name of used) assert.ok(manifest.vars.includes(name), `<${name}> is not in manifest vars`)
  })

  it('every declared variable is used', () => {
    for (const name of manifest.vars) assert.ok(used.has(name), `${name} is declared but unused`)
  })

  it('the OpenCode install instruction clones outside the project', () => {
    const agents = text.get('templates/AGENTS.md.template')
    assert.match(agents, /git clone <KIT_GIT_URL> "\$HOME\/\.qa-kit-src"/)
    assert.doesNotMatch(agents, /git clone \S+ qa-kit\b/)
  })

  it('init gets its KIT_GIT_URL default from plugin.json, not only from a git clone', () => {
    const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
    assert.match(plugin.repository, /^https:\/\/\S+\/\S+\/qa-kit$/)
    assert.match(text.get('skills/init/SKILL.md'), /`repository` field of `\$\{CLAUDE_PLUGIN_ROOT\}\/\.claude-plugin\/plugin\.json`/)
  })
})

describe('runtime requirement', () => {
  it('package.json requires Node 22 or newer and the docs say the same', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    assert.equal(pkg.engines.node, '>=22')
    assert.match(readFileSync(join(ROOT, 'README.md'), 'utf8'), /Node\.js 22 or newer/)
    for (const file of ['README.md', 'skills/init/SKILL.md', 'docs/MCP-SETUP-GUIDE.md']) {
      assert.doesNotMatch(readFileSync(join(ROOT, file), 'utf8'), /Node(\.js)? (18|20)\b|\((18|20)(\.\d+)? or newer\)/, file)
    }
  })
})

describe('manifest', () => {
  it('every template named in templates/manifest.json exists', () => {
    const manifest = JSON.parse(text.get('templates/manifest.json'))
    for (const f of manifest.files) assert.ok(text.has(`templates/${f.source}`), f.source)
  })
})

describe('README', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')

  it('states the version of plugin.json, and the top changelog entry is that version', () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
    assert.equal(readme.match(/^Version: \*\*(\d+\.\d+\.\d+)\*\*/m)?.[1], version)
    assert.equal(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8').match(/^## (\d+\.\d+\.\d+)\b/m)?.[1], version)
  })

  it('every link in the contents table points at a heading that exists', () => {
    const slug = (h) => h.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9 _-]/g, '').trim().replace(/ /g, '-')
    const headings = new Set([...readme.matchAll(/^#{1,4} (.+)$/gm)].map((m) => slug(m[1])))
    const broken = [...readme.matchAll(/\]\(#([a-z0-9_-]+)\)/g)].map((m) => m[1]).filter((a) => !headings.has(a))
    assert.deepEqual(broken, [])
  })

  it('names the main flows: install, init, joining, day to day, update, no repo, troubleshooting', () => {
    for (const heading of ['Install the kit', 'Set up a repo', 'Joining a repo', 'Using qa-kit day to day', 'Updating to a new version', 'Using qa-kit without a repo', 'Troubleshooting']) {
      assert.match(readme, new RegExp(`^## ${heading}`, 'm'), heading)
    }
  })
})
