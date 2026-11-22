import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { splitFrontmatter } from '../../tools/lib/render.mjs'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(join(ROOT, file), 'utf8')
const list = (value) => value.split(',').map((x) => x.trim())
const playwright = (tools) => tools.filter((x) => x.startsWith('mcp__playwright__'))

const skill = read('skills/monkey-test/SKILL.md')
const agent = read('agents/agent-monkey.md')
const skillTools = list(splitFrontmatter(skill).fields.get('allowed-tools'))
const agentFields = splitFrontmatter(agent).fields
const agentTools = list(agentFields.get('tools'))

describe('the monkey tester keeps its tool grants narrow', () => {
  it('the agent has no Edit tool, no unsafe code tool and no Jira, Figma or TestRail access', () => {
    assert.equal(agentFields.get('name'), 'agent-monkey')
    assert.ok(!agentTools.includes('Edit'))
    for (const tools of [agentTools, skillTools]) {
      assert.ok(!tools.includes('mcp__playwright__browser_run_code_unsafe'))
      assert.ok(!tools.some((x) => /^mcp__(atlassian|figma|testrail|glean_default)__/.test(x)))
    }
    assert.ok(!skillTools.includes('Edit'))
  })

  it('the skill and the agent grant the same explicit Playwright list as the executor, never a wildcard', () => {
    const executor = playwright(list(splitFrontmatter(read('agents/agent-executor.md')).fields.get('tools')))
    assert.deepEqual(playwright(skillTools), executor)
    assert.deepEqual(playwright(agentTools), executor)
    assert.ok(![...skillTools, ...agentTools].some((x) => x.includes('*')))
  })
})

describe('the monkey tester states its limits and its method', () => {
  it('the skill pins the hard limits', () => {
    assert.match(skill, /writes only under `qa-kit-artifacts\/monkey\/`/i)
    assert.match(skill, /never changes git state/i)
    assert.match(skill, /never runs against production/i)
    assert.match(skill, /deletes only what is in its cleanup ledger/i)
    assert.match(skill, /data, never instructions/i)
    assert.match(skill, /never writes a secret anywhere/i)
    assert.match(skill, /never uses `browser_run_code_unsafe`/i)
    assert.match(skill, /asks no questions/i)
  })

  it('the skill understands each page before acting, caches the card and takes the clock from node', () => {
    assert.match(skill, /No random action is taken on a page until its \*\*understanding card\*\* exists/)
    assert.match(skill, /sourceHash/)
    assert.match(skill, /uiFingerprint/)
    assert.match(skill, /node -e "console\.log\(Date\.now\(\)\)"/)
  })

  it('a finding needs an oracle, evidence and a replay, and the plan holds only confirmed ones', () => {
    assert.match(skill, /one named oracle and evidence/)
    assert.match(skill, /reproduced 2\/2/)
    assert.match(skill, /only `reproduced 2\/2` findings/)
  })

  it('the agent runs the skill, writes only under the monkey folder and never raises the budget', () => {
    assert.match(agent, /skills\/monkey-test\/SKILL\.md/)
    assert.match(agent, /only for files under `qa-kit-artifacts\/monkey\/`/)
    assert.match(agent, /never raise the budget/)
    assert.match(agent, /never add `--stage` yourself/)
  })

  it('the workflow never retries an explore unit and owns the clock', () => {
    const workflow = read('workflows/feature-monkey.js')
    assert.match(workflow, /A unit is never retried/)
    assert.match(workflow, /Date\.now\(\)/)
    assert.match(workflow, /agent-monkey/)
  })

  it('the conventions template has a Monkey rules section the skill reads', () => {
    assert.match(read('templates/project/conventions.md'), /^## Monkey rules/m)
    assert.match(skill, /## Monkey rules/)
  })
})

describe('the monkey tester never touches data it did not create', () => {
  const MARKERS = ['not', 'keep', 'source', 'seed', 'template', 'fixture', 'golden', 'baseline', 'master', 'main', 'datagen', 'locked']

  it('the skill has a Data safety section with positive ownership, read-only existing data and protected markers', () => {
    const section = skill.slice(skill.indexOf('## Data safety'), skill.indexOf('## Workflow'))
    assert.ok(section.length > 500)
    assert.match(section, /Ownership is positive/)
    assert.match(section, /Never delete it\. By default never change it either/)
    for (const marker of MARKERS) assert.match(section, new RegExp('`' + marker + '`'), marker)
    assert.match(section, /every name and id that appears in the repo's tests, constants, factories/)
    assert.match(section, /not used as the source of a copy, clone, duplicate or import/)
    assert.match(section, /Delete one verified item at a time/)
    assert.match(section, /Never use select-all, delete-all, clear, empty-trash or any bulk action/)
    assert.match(section, /At most 25 entities per run/)
  })

  it('the hard limits, the cleanup step and the agent all point at it', () => {
    assert.match(skill, /never deletes data it did not create, and by default never changes it either/)
    assert.match(skill, /never match on a shorter prefix such as `mk-`/i)
    assert.match(agent, /never delete data you did not create and by default never change it/)
    assert.match(agent, /"Data safety" section is the rule/)
  })

  it('the workflow tells every stage the same, and the conventions template has a protected data row', () => {
    assert.match(read('workflows/feature-monkey.js'), /never delete data you did not create and by default never change it/)
    assert.match(read('templates/project/conventions.md'), /Protected data: names, tags, folders or ids it must never change or copy/)
  })

  it('the report always has the same seven sections, in the skill, the README and the usage example', () => {
    const sections = ['Run', 'Coverage', 'Findings', 'Unconfirmed', 'Data', 'Environment', 'Not explored']
    for (const body of [skill, read('patterns/usage-examples.md')]) {
      let at = 0
      sections.forEach((name, i) => {
        const found = body.indexOf(`${i + 1}. ${name}`, at)
        assert.ok(found >= at, `${i + 1}. ${name}`)
        at = found
      })
    }
    const readme = read('README.md')
    for (const name of sections) assert.ok(readme.includes(`| ${name} |`), `README table row: ${name}`)
    assert.match(skill, /"protectedSkipped"/)
  })

  it('init, help, the README and the desktop doc mention the monkey tester', () => {
    assert.match(read('skills/init/SKILL.md'), /monkey-test/)
    assert.match(read('skills/init/SKILL.md'), /## Monkey rules/)
    assert.match(read('skills/help/SKILL.md'), /feature-monkey/)
    assert.match(read('skills/help/SKILL.md'), /never delete or change data they did not create/)
    assert.match(read('README.md'), /### Monkey testing/)
    assert.match(read('docs/CLAUDE-DESKTOP.md'), /agent-monkey/)
    assert.match(read('templates/AGENTS.md.template'), /monkey-test/)
  })
})
