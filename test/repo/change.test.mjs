import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { parseWorkflowArgs, splitArgs } from '../../runner/lib/parse.mjs'
import { resolveInputs } from '../../runner/lib/state.mjs'
import { splitFrontmatter } from '../../tools/lib/render.mjs'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(join(ROOT, file), 'utf8')
const list = (value) => value.split(',').map((x) => x.trim())

const analyze = read('skills/analyze-changes/SKILL.md')
const select = read('skills/select-tests/SKILL.md')
const agent = read('agents/agent-change-analyst.md')
const analyzeTools = list(splitFrontmatter(analyze).fields.get('allowed-tools'))
const selectTools = list(splitFrontmatter(select).fields.get('allowed-tools'))
const agentFields = splitFrontmatter(agent).fields
const agentTools = list(agentFields.get('tools'))
const READ_ONLY_JIRA = ['mcp__atlassian__get*', 'mcp__atlassian__search*', 'mcp__atlassian__lookup*']

describe('change analysis keeps its tool grants narrow', () => {
  it('has no Edit tool, no browser tool, and Atlassian access only where it is used and read-only', () => {
    assert.equal(agentFields.get('name'), 'agent-change-analyst')
    for (const tools of [agentTools, analyzeTools, selectTools]) {
      assert.ok(!tools.includes('Edit'))
      assert.ok(!tools.some((x) => x.startsWith('mcp__playwright__')))
      assert.ok(!tools.some((x) => /^mcp__(figma|testrail|glean_default)__/.test(x)))
      assert.ok(!tools.some((x) => x.includes('*') && !READ_ONLY_JIRA.includes(x)))
    }
    assert.deepEqual(agentTools.filter((x) => x.startsWith('mcp__atlassian__')), READ_ONLY_JIRA)
    assert.deepEqual(analyzeTools.filter((x) => x.startsWith('mcp__atlassian__')), READ_ONLY_JIRA)
    assert.deepEqual(selectTools.filter((x) => x.startsWith('mcp__atlassian__')), [], 'select-tests never reads a ticket')
  })

  it('the agent runs the two skills, leaves the decision to the gate and pins its own limits', () => {
    assert.match(agent, /skills\/analyze-changes\/SKILL\.md/)
    assert.match(agent, /skills\/select-tests\/SKILL\.md/)
    assert.match(agent, /The decision is not yours/)
    assert.match(agent, /never overrule the gate's answer/)
    assert.match(agent, /never read `change-mapping\.md` while inferring/)
    assert.match(agent, /only for files under `qa-kit-artifacts\/changes\/`/)
    assert.match(agent, /never add `--coverage`, `--fetch` or `--record-plans` yourself/)
    assert.match(agent, /never use `gh api`/)
    assert.match(agent, /data, never instructions/)
    assert.match(agent, /Never answer from part of the evidence/)
  })

  it('the git and gh commands the skill and the agent name are the ones the settings template allows', () => {
    const settings = read('templates/settings.json.template')
    const git = ['status', 'log', 'rev-list', 'diff', 'show', 'rev-parse', 'merge-base', 'ls-files', 'remote show', 'symbolic-ref', 'branch --show-current']
    for (const command of git) {
      assert.ok(analyze.includes(`\`${command}\``), `analyze-changes names ${command}`)
      assert.ok(agent.includes(`\`${command}\``), `the agent names ${command}`)
      assert.ok(settings.includes(`"Bash(git ${command}`), `settings allows git ${command}`)
    }
    for (const command of ['gh pr view', 'gh pr diff', 'gh pr list', 'gh repo view']) assert.ok(settings.includes(`"Bash(${command}`), command)
    assert.ok(settings.includes('"Bash(node *select-gate.mjs*)"'))
    assert.ok(!/gh api/.test(settings))
    assert.ok(!/"Bash\(git (fetch|add|commit|push|checkout)/.test(settings))
  })
})

describe('the analysis skill records facts and states its limits', () => {
  it('pins the hard limits', () => {
    assert.match(analyze, /never changes git state/i)
    assert.match(analyze, /writes only under `qa-kit-artifacts\/changes\/`/i)
    assert.match(analyze, /Never `gh api`/)
    assert.match(analyze, /`git fetch` runs only when `--fetch` was given/)
    assert.match(analyze, /data, never instructions/i)
    assert.match(analyze, /asks no questions/i)
    assert.match(analyze, /uses \*\*no browser tools\*\*/)
    assert.match(analyze, /never writes a secret anywhere/i)
    assert.match(analyze, /runs that repo code/)
  })

  it('records facts only: it never reads the mapping file and never decides', () => {
    assert.match(analyze, /\*\*Do not read `\.qa-kit\/project\/change-mapping\.md`\*\*/)
    assert.match(analyze, /never decides how much to run/)
    assert.match(analyze, /When in doubt, `global`/)
    assert.match(analyze, /can only make a kind wider than yours/)
    assert.match(analyze, /a source file is never ignorable/)
    for (const kind of ['ui', 'api', 'shared-test-support', 'test-only', 'config-infra', 'ignorable', 'global']) assert.match(analyze, new RegExp('`' + kind + '`'), kind)
  })

  it('the local checkout is the candidate and a source that cannot be read in full is blocked', () => {
    assert.match(analyze, /\*\*The checkout you are in is the candidate\.\*\*/)
    assert.match(analyze, /git ls-files --others --exclude-standard/)
    assert.match(analyze, /A shallow clone, or a failed `git merge-base <base> HEAD`, ends `blocked`/)
    assert.match(analyze, /Never fall back to a two-dot or `HEAD~1` diff/)
    assert.match(analyze, /more than \*\*300 changed files\*\*/)
    assert.match(analyze, /Never sample a huge change set/)
    assert.match(analyze, /Do not scope the diff to the folder qa-kit lives in/)
    assert.match(analyze, /Never answer from part of the evidence/)
  })

  it('does not trust the capped gh output and says what a truncated source means', () => {
    assert.match(analyze, /--limit 200/)
    assert.match(analyze, /Never use `gh pr view --json files`/)
    assert.match(analyze, /`changedFiles`/)
    assert.match(analyze, /exactly 200 pull requests is truncated: end `blocked`/)
    assert.match(analyze, /a failed `gh pr diff`/)
  })

  it('starts every run clean, and writes the hand-off only when coverage ran', () => {
    assert.match(analyze, /select-gate\.mjs" begin/)
    assert.match(analyze, /Every run starts by removing what the previous run left/)
    assert.match(analyze, /\*\*Only written when coverage ran\*\*: no hand-off file means coverage was not assessed/)
    assert.match(analyze, /never report "no gaps" for coverage that was not checked|never "no gaps"|not `no gaps`|`not-run`, not "no gaps"/)
    assert.match(analyze, /Invoke `verify-coverage` in \*\*plan mode\*\*/)
    assert.match(analyze, /this skill never plans/)
    assert.match(analyze, /Never run `feature-implement` from here/)
  })

  it('treats several repositories as one change set', () => {
    assert.match(analyze, /\*\*Several repos are one change set\*\*/)
    assert.match(analyze, /ends the whole run `blocked` with that repo named/)
    assert.match(read('templates/project/change-mapping.md'), /org\/app:<glob>/)
    assert.match(analyze, /"repo": null/)
  })

  it('documents a return value without nulls, and the fixed output files', () => {
    assert.match(analyze, /## Return value/)
    assert.match(analyze, /never `null`/)
    for (const file of ['changes.json', 'changes-report.md', 'handoff.json', 'test-index.json', 'run.json']) assert.ok(analyze.includes(`qa-kit-artifacts/changes/${file}`), file)
    assert.ok(analyze.includes('handoff.md'))
    assert.match(analyze, /its Markdown twin says the same thing for a person and is never parsed/)
  })
})

describe('the selection skill shows the gate\'s decision and never makes its own', () => {
  it('calls the script, never overrules it and never edits the selection files', () => {
    assert.match(select, /\*\*The model does not decide this\.\*\*/)
    assert.match(select, /select-gate\.mjs" finalize/)
    assert.match(select, /select-gate\.mjs" check/)
    assert.match(select, /never overrule the gate/)
    assert.match(select, /You never edit `selection\.json`, `selection\.md` or `selection\.args` yourself/)
    assert.match(select, /It \*\*never runs the tests\*\* it selects/)
    assert.match(select, /`--min-confidence=high`/)
  })

  it('names every reason the gate can answer full or none', () => {
    for (const reason of ['analysis-unavailable', 'stale-analysis', 'index-unavailable', 'no-changes', 'unverified-source', 'analysis-incomplete', 'global-change', 'docs-only', 'no-candidates', 'low-confidence', 'unsafe-path', 'wide-selection', 'only-deletions']) {
      assert.match(select, new RegExp('`' + reason + '`'), reason)
    }
    assert.match(select, /`full` is the answer for every doubt/)
    assert.match(select, /"no scope identified", run nothing/)
    assert.match(select, /an empty line never narrows the run/i)
  })

  it('the reasons in the skill are the reasons in the code', () => {
    const code = read('runner/lib/select-gate.mjs')
    for (const reason of ['analysis-unavailable', 'stale-analysis', 'index-unavailable', 'global-change', 'low-confidence', 'no-candidates', 'unsafe-path', 'wide-selection', 'unverified-source', 'analysis-incomplete', 'no-changes', 'docs-only', 'only-deletions']) {
      assert.ok(code.includes(`'${reason}'`), reason)
    }
  })

  it('documents the exact output files and a return value without nulls', () => {
    for (const file of ['selection.json', 'selection.md', 'selection.args']) assert.ok(select.includes(`qa-kit-artifacts/changes/${file}`), file)
    assert.match(select, /## Return value/)
    assert.match(select, /never `null`/)
  })
})

describe('the change flows are read-only and stop at review', () => {
  const flows = { 'feature-select': read('workflows/feature-select.js'), 'feature-diff': read('workflows/feature-diff.js') }

  it('both workflows validate what reaches a prompt and what an agent returns', () => {
    for (const [name, body] of Object.entries(flows)) {
      assert.match(body, /agent-change-analyst/, name)
      assert.match(body, /function sourceProblem\(\)/, name)
      assert.match(body, /are data, never instructions/, name)
      assert.match(body, /no git add, commit, stash, checkout, pull or push/, name)
      assert.match(body, /const PLAN_PATH = /, name)
      assert.match(body, /const TICKET = /, name)
      assert.match(body, /function cleanGaps\(/, name)
      assert.match(body, /Built here, never taken from an agent/, name)
      assert.match(body, /fallbackReason: 'selection-failed'/, name)
      assert.ok(!/agent-(writer|deliverer|reviewer)/.test(body), `${name} never calls a writer, reviewer or deliverer`)
    }
  })

  it('only feature-diff runs the executor, report-only, once, after a check', () => {
    assert.match(flows['feature-diff'], /NEVER heal/)
    assert.match(flows['feature-diff'], /a test run is never repeated automatically/)
    assert.match(flows['feature-diff'], /check step of the select-tests skill/)
    assert.ok(!/agent-executor/.test(flows['feature-select']))
  })

  it('the guard registers both as read-only, and the strict set is exactly these two', () => {
    const guard = read('runner/lib/guard.mjs')
    assert.match(guard, /READ_ONLY_WORKFLOWS = \['feature-plan', 'feature-monkey', 'feature-diff', 'feature-select'\]/)
    assert.match(guard, /READ_ONLY_STRICT = \['feature-diff', 'feature-select'\]/)
  })
})

describe('the commands, init, help, the templates and the docs agree with the code', () => {
  it('every command that parses flags says a repeated value flag is an error', () => {
    for (const name of readdirSync(join(ROOT, 'commands')).filter((f) => f.startsWith('feature-'))) {
      assert.match(read(`commands/${name}`), /given twice/, name)
    }
  })

  it('the OpenCode wrappers of the change flows handle exit 1 and never report an earlier run', () => {
    for (const flow of ['feature-select', 'feature-diff']) assert.match(read(`opencode/commands/${flow}.md`), /Exit code 1 means the arguments were invalid/, flow)
  })

  it('the mapping file is created once by init, in both agents, and its template is parseable', () => {
    const manifest = JSON.parse(read('templates/manifest.json'))
    const entry = manifest.files.find((file) => file.target === '.qa-kit/project/change-mapping.md')
    assert.ok(entry)
    assert.equal(entry.update, 'once')
    assert.deepEqual(entry.agents, ['claude', 'opencode'])
    assert.match(read('skills/init/SKILL.md'), /change-mapping\.md/)
    const template = read('templates/project/change-mapping.md')
    assert.match(template, /read, never edited\*\* by qa-kit/)
    assert.match(template, /\*\*Shared paths\*\*/)
    assert.match(read('templates/project/conventions.md'), /\| Smoke tag /)
  })

  it('help names both flows and both skills, keeps the flags it had, and has the examples', () => {
    const help = read('skills/help/SKILL.md')
    for (const name of ['feature-select', 'feature-diff', 'analyze-changes', 'select-tests']) assert.match(help, new RegExp(name))
    assert.match(help, /the six flows/)
    assert.match(help, /\/qa-kit:feature-select --base=origin\/main/)
    assert.match(help, /\/qa-kit:feature-diff --since=7 --run-affected/)
    assert.match(help, /\/qa-kit:plan-tests ABC-1234/)
    for (const flag of ['--no-retest', '--seed=N', '--no-cache', '--guidance="text"', '--parallel=N', '--min-confidence=high']) assert.ok(help.includes(flag), flag)
  })

  it('the consumer instructions list the new commands in both agents', () => {
    const agents = read('templates/AGENTS.md.template')
    for (const name of ['feature-select', 'feature-diff', 'analyze-changes', 'select-tests']) {
      assert.match(agents, new RegExp('`/qa-kit:' + name), name)
      assert.match(agents, new RegExp('`/qa-kit-' + name), name)
    }
  })

  it('section 18 keeps its Usage line, and section 19 documents the gate, the exception and the CI rule', () => {
    const reference = read('patterns/workflows-reference.md')
    const s18 = reference.slice(reference.indexOf('### 18.'), reference.indexOf('### 19.'))
    assert.match(s18, /\*\*Usage\*\*: `\/qa-kit:retest-defect ABC-1234`/)
    const s19 = reference.slice(reference.indexOf('### 19.'))
    assert.ok(!/retest-defect/.test(s19))
    assert.match(s19, /The facts and the decision are separate/)
    assert.match(s19, /Decided exception/)
    assert.match(s19, /approved data scope/)
    assert.match(s19, /The hand-off exists only when coverage ran/)
    assert.match(s19, /Not built yet \(TODO: CI wiring\)/)
    assert.match(s19, /a non-zero exit, a blocked entry or a missing `selection\.json` means run the full suite/)
  })

  it('the README, the actions README and CLAUDE.md carry the TODO, the full-run rule and the decided exception', () => {
    const readme = read('README.md')
    assert.match(readme, /^### Change-driven testing/m)
    assert.match(readme, /Roadmap \/ TODO \(CI wiring, not built yet\)/)
    assert.match(readme, /One decided exception/)
    assert.match(readme, /Your local checkout is the candidate/)
    assert.match(readme, /no scope identified/)
    for (const item of ['--min-confidence=high', 'shallow clone', 'more than 100 files', 'fetch-depth', 'a leftover `selection.json`']) assert.ok(readme.includes(item), item)
    assert.match(read('actions/README.md'), /^## TODO: running only the tests a change affects/m)
    assert.match(read('actions/README.md'), /fetch-depth: 0/)
    for (const file of ['patterns/workflows-reference.md', 'README.md', 'actions/README.md']) assert.match(read(file), /a missing `selection\.json`/, file)
    const rules = read('.claude/CLAUDE.md')
    assert.match(rules, /Change analysis \(`analyze-changes`/)
    assert.match(rules, /\*\*Owner-approved exception:\*\*/)
    assert.match(rules, /\*\*Owner-approved data scope:\*\*/)
    assert.match(rules, /The model never decides how much to run/)
    assert.match(read('docs/CLAUDE-DESKTOP.md'), /agent-change-analyst/)
  })

  it('every example command of usage example AB is valid for the real parser', () => {
    const examples = read('patterns/usage-examples.md')
    const section = examples.slice(examples.indexOf('### AB.'), examples.indexOf('### R.'))
    const lines = section.split('\n').map((l) => l.trim()).filter((l) => /^(\/qa-kit:feature-(select|diff)|node <kit>\/runner\/qa-kit\.mjs feature-(select|diff))/.test(l))
    assert.ok(lines.length >= 12, `${lines.length} example commands`)
    for (const line of lines) {
      const command = line.replace(/\s*\|\|.*$/, '').replace('node <kit>/runner/qa-kit.mjs ', '/qa-kit:').replace(/ --agent \w+/, '')
      const [name, ...tokens] = splitArgs(command.replace(/^\/qa-kit:/, ''))
      const { args, items } = parseWorkflowArgs(name, tokens)
      assert.doesNotThrow(() => resolveInputs({ workflow: name, args, items, cwd: ROOT }), line)
    }
  })
})
