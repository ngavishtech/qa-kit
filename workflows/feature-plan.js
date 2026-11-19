export const meta = {
  name: 'feature-plan',
  description: "Plan-only phase for several features in parallel - writes one reviewable plan per feature under the current checkout's qa-kit-artifacts/ (no worktree, no branch, no code touched), or merges new sources into an already-planned feature via --update. Stop and review before running feature-implement.",
  phases: [
    { title: 'Plan', detail: 'test-planner agent per feature - writes qa-kit-artifacts/<slug>-test-plan.md in the current checkout' },
    { title: 'Update', detail: 'test-planner agent per update - merges new sources into the existing plan file in place' },
  ],
}

// args.features: array of { jiraKeys?, planFiles?, figmaLinks?, testrailLocations?, descriptions? },
// one entry per feature - each field is an array (usually holding one item, but a single feature can
// legitimately combine several Jira IDs/Figma links/free-text fragments - e.g. an epic plus its
// subtasks plus a design link plus extra context, all merged into ONE plan). Fields can be given in
// any order by the caller - this script and plan-tests both classify by shape, never by position.
// `testrailLocations` is NOT a requirements source like the other four - each entry is either a
// `testrail:<projectId>/<suiteId>[/<sectionId>]` shorthand or a raw TestRail URL, and plan-tests's
// SKILL.md Step 3 treats any given here as an override that wins over testrail-mapping.md entirely
// for this feature's TestRail cross-check. plan-tests's SKILL.md Step 1 is what actually fetches and
// merges the requirements sources; this script just carries the whole bundle through untouched.
// The `/qa-kit:feature-plan` command builds this shape from two input grammars: a bare comma-separated
// list (legacy shorthand, one source per feature) or one or more `--plan <src, src, ...>` blocks
// (multi-source - everything in one block is one feature) - see `commands/feature-plan.md`.
//
// args.updates: array of { plan: { planPath, task?, testType? }, jiraKeys?, planFiles?, figmaLinks?,
// testrailLocations?, descriptions? } - one entry per already-planned feature to revise, NOT a fresh
// feature. `plan.planPath` is the existing plan file to revise in place (a prior feature-plan report
// entry works unmodified, but only planPath is required). The other fields are the NEW source(s)
// to merge in, same shapes as args.features' fields (a new `testrailLocations` entry replaces
// whatever override/mapping-file fallback the existing plan was using). Maps to plan-tests's
// `--update <path>` flag (see plan-tests's SKILL.md -> "Update Mode"). The `/qa-kit:feature-plan` command
// builds this from a `--update <path>, <src, ...>` block - see `commands/feature-plan.md`.
//
// args.maxParallel: optional override for MAX_PARALLEL_FEATURES below - shared by both the Plan and
// Update loops.
//
// This is deliberately plan-only: plan-tests's own SKILL.md says a plan must be reviewed/approved
// by a human before write-tests touches it. A workflow cannot pause for a question
// mid-run, so that approval step has to be a real stop between two separate invocations, not a
// step inside one continuous script. Review this run's output (and the qa-kit-artifacts/*.md files it wrote),
// then hand the approved subset to feature-implement as args.plans.

const MAX_PARALLEL_FEATURES = args?.maxParallel || 3
// The Workflow tool or the runner sets the agent prefix through args.agentPrefix ("qa-kit:" for Claude Code,
// "qa-kit-" for OpenCode, "" for none) - this is the one place the namespace lives.
const AGENT_PREFIX = args?.agentPrefix ?? 'qa-kit:'


// planPath/testType only exist on a successful plan. Deliberately NOT required, so a genuine block
// (e.g. neither atlassian nor glean_default can resolve a Jira ticket, and no one's there to paste
// text) can be reported via blocked/blockReason without test-planner being forced to fabricate a
// plan just to satisfy this schema - see mcp-usage.md's blocking-vs-optional rule. The plan is only
// a file under the current checkout's qa-kit-artifacts/ - no worktree or branch exists at this stage;
// feature-implement creates those later, and only when it runs several features at once.
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    planPath: { type: 'string' },
    testType: { type: 'string', enum: ['ui', 'api', 'both'] },
    blocked: { type: 'boolean' },
    blockReason: { type: 'string' },
    // Only ever set true by the Update loop below - absent (not false) on a fresh Plan-loop
    // result, so a consumer can tell "freshly planned" from "revised" at a glance.
    updated: { type: 'boolean' },
  },
  required: ['blocked'],
}

// Every source across every field, in a stable order, used for the human-readable
// description/prompt. testrailLocations deliberately sorts last - it's a cross-check override, not
// requirements content.
function allSources(f) {
  return [
    ...(f.jiraKeys || []),
    ...(f.planFiles || []),
    ...(f.figmaLinks || []),
    ...(f.descriptions || []),
    ...(f.testrailLocations || []),
  ]
}

function describeFeature(f) {
  const sources = allSources(f)
  return sources.length ? sources.join(' + ') : 'feature'
}

// One phrase per source, in the same order allSources() uses - kept as a separate array (not just
// joined into describeFeature's output) so planPrompt can decide singular vs. merged phrasing.
function sourcePhrases(f) {
  return [
    ...(f.jiraKeys || []).map(k => `Jira story ${k}`),
    ...(f.planFiles || []).map(p => `the plan file at ${p}`),
    ...(f.figmaLinks || []).map(l => `the Figma design at ${l}`),
    ...(f.descriptions || []).map(d => `this requirement: "${d}"`),
    ...(f.testrailLocations || []).map(t => `TestRail location override ${t} (use this instead of testrail-mapping.md for this plan's cross-check)`),
  ]
}

function planPrompt(f) {
  const phrases = sourcePhrases(f)
  const sourceText =
    phrases.length <= 1
      ? phrases[0] || 'this requirement (no source given)'
      : `ALL of the following, merged into ONE feature and ONE plan - not one plan per source: ${phrases.join('; ')}`
  return (
    `Plan test coverage for ${sourceText}. Work in the current checkout: do NOT create a git worktree or a branch, and do not touch any tracked file - ` +
    `the only thing this stage produces is the plan file under this checkout's qa-kit artifacts folder (qa-kit-artifacts/ unless .qa-kit/project/conventions.md names another; several features may be planned at once, each writing its own distinct file there). ` +
    `Return the plan's path and test type.`
  )
}

// Retries once on a null/errored agent() call before giving up, so a transient failure is
// recorded as an explicit blocked reason instead of the feature silently vanishing from the report.
async function planStage(f) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await agent(planPrompt(f), {
        agentType: AGENT_PREFIX + 'test-planner',
        phase: 'Plan',
        label: `plan:${describeFeature(f)}`,
        schema: PLAN_SCHEMA,
      })
      if (r) return { task: describeFeature(f), ...r }
      log(`plan:${describeFeature(f)} returned nothing (attempt ${attempt}/2)${attempt < 2 ? ' - retrying' : ''}`)
    } catch (err) {
      log(`plan:${describeFeature(f)} errored (attempt ${attempt}/2): ${err?.message || err}${attempt < 2 ? ' - retrying' : ''}`)
    }
  }
  return {
    task: describeFeature(f),
    blocked: true,
    blockReason: 'Plan stage failed twice (transient agent failure or terminal error) - needs a human to investigate and re-run this feature',
  }
}

function updatePrompt(u) {
  const priorTask = u.plan?.task || u.plan?.planPath || 'this feature'
  const phrases = sourcePhrases(u)
  const sourceText =
    phrases.length <= 1
      ? phrases[0] || 'no new source given - re-check the existing plan for anything already answerable from what it already has'
      : `ALL of the following, merged together: ${phrases.join('; ')}`
  return (
    `This is an UPDATE to an already-planned feature (${priorTask}), not a fresh feature - do NOT create a git worktree or a branch. ` +
    `If the plan file at ${u.plan?.planPath} is missing, report blocked rather than creating a new one, since that would silently start a second, ` +
    `disconnected plan instead of revising the original. Otherwise invoke plan-tests's --update mode on it, ` +
    `merging in this new source: ${sourceText}. Return the same plan path (unchanged), and set updated: true.`
  )
}

// Same retry shape as planStage - a transient failure here still needs to surface as a named
// blockReason rather than the update silently vanishing from the report.
async function updateStage(u) {
  const label = u.plan?.task || u.plan?.planPath || 'update'
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await agent(updatePrompt(u), {
        agentType: AGENT_PREFIX + 'test-planner',
        phase: 'Update',
        label: `update:${label}`,
        schema: PLAN_SCHEMA,
      })
      if (r) return { task: `Update: ${label}`, ...r }
      log(`update:${label} returned nothing (attempt ${attempt}/2)${attempt < 2 ? ' - retrying' : ''}`)
    } catch (err) {
      log(`update:${label} errored (attempt ${attempt}/2): ${err?.message || err}${attempt < 2 ? ' - retrying' : ''}`)
    }
  }
  return {
    task: `Update: ${label}`,
    blocked: true,
    blockReason: 'Update stage failed twice (transient agent failure or terminal error) - needs a human to investigate and re-run this update',
  }
}

const allPlans = []
if (args.features?.length) {
  for (let offset = 0; offset < args.features.length; offset += MAX_PARALLEL_FEATURES) {
    const batch = args.features.slice(offset, offset + MAX_PARALLEL_FEATURES)
    log(`Planning features ${offset + 1}-${offset + batch.length} of ${args.features.length} (max ${MAX_PARALLEL_FEATURES} in parallel)`)
    const batchResults = await parallel(
      batch.map(f => () => planStage(f)),
    )
    allPlans.push(...batchResults.filter(Boolean))
  }
}

const allUpdates = []
if (args.updates?.length) {
  for (let offset = 0; offset < args.updates.length; offset += MAX_PARALLEL_FEATURES) {
    const batch = args.updates.slice(offset, offset + MAX_PARALLEL_FEATURES)
    log(`Updating plans ${offset + 1}-${offset + batch.length} of ${args.updates.length} (max ${MAX_PARALLEL_FEATURES} in parallel)`)
    const batchResults = await parallel(batch.map(u => () => updateStage(u)))
    allUpdates.push(...batchResults.filter(Boolean))
  }
}

const allResults = [...allPlans, ...allUpdates]
const blocked = allResults.filter(p => p.blocked)
log(
  `Planned ${allPlans.length - allPlans.filter(p => p.blocked).length}/${args.features?.length || 0} fresh feature(s), ` +
    `updated ${allUpdates.length - allUpdates.filter(p => p.blocked).length}/${args.updates?.length || 0} existing plan(s)` +
    (blocked.length ? `; ${blocked.length} blocked total - see blockReason.` : '.') +
    ' Review qa-kit-artifacts/*.md before approving any for feature-implement.',
)

return allResults
