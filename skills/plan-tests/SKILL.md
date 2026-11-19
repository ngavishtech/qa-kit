---
name: plan-tests
description: Produces a prioritized Playwright test plan (positive, negative, boundary and edge scenarios, TestRail stubs as plan text) from Jira/Confluence tickets, Figma links or plain text, combined into one plan and saved under qa-kit-artifacts/ for review. Use when starting new coverage from a requirement, to plan tests for a story, or (--update) to revise an existing plan.
argument-hint: '[--update <plan path>] <ticket keys, Figma links, TestRail location, or text>'
allowed-tools: Read, Write, Glob, Grep, Bash, Skill, mcp__figma__*, mcp__testrail__get*, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_hover, mcp__playwright__browser_wait_for, mcp__playwright__browser_close
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`. If invoking another skill by its bare name (as this document does) fails, retry as `qa-kit:<name>`, or read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it directly.

# Plan Tests

**Purpose**: Analyze requirements from Jira/Confluence and Figma, cross-check against existing TestRail/repo coverage, and produce a reviewable test plan

**Approach**: Senior automation engineer with 17+ years experience - smart, specific, business-aware

**Output home**: `qa-kit-artifacts/<story-or-feature-slug>-test-plan.md` - `qa-kit-artifacts/` is the one folder where qa-kit writes everything it produces (plans today). It is gitignored (it ignores itself, and `/qa-kit:init` also lists it in the repo's `.gitignore`), so plans live there for team review and are never pushed to GitHub. If `qa-kit-artifacts/.gitignore` does not exist yet (a fresh clone, or a folder `init` was never run in), create it containing `*` before writing the plan. Once a plan is approved, `write-tests` implements it.

**Portability (shared plugin)**: this skill runs in many repos, so every codebase-grounding step below that names a repo-specific path or construct - `src/tests/`, `src/support/`, `playwright.config.ts`, a `TestFeature` enum and its tags, `.qa-kit/project/testrail-mapping.md` - applies **only if it actually exists in the current repo**. Detect first (Glob/Read); if absent, skip that step without erroring and add one line to the plan's Open Questions ("Codebase grounding skipped: <what was missing>") instead of inventing paths or enum members. If `.qa-kit/project/conventions.md` exists, read it first: it can name the test directory, the feature-tag enum, and a different gitignored plan folder to use wherever this document says `qa-kit-artifacts/`. The TestRail cross-check still works with no mapping file when an explicit `testrail:<projectId>/<suiteId>[/<sectionId>]` location is given; with neither, it is skipped as an optional dependency.

**Git boundary**: this skill never touches git - no worktree, no branch - whether run standalone/interactively or by `test-planner` inside `feature-plan`. The plan file under `qa-kit-artifacts/` is its only output, so the same plan can go either to `write-tests` (the manual track) or to `feature-implement` (pass it as `{ task, planPath, testType }`) - see `${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md` §7 "Feature Pipeline" -> "Two tracks". `feature-implement`, not planning, is what creates any worktree/branch.

## Project Context

Before generating a plan, consult `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md` - it's the single source of truth for the document envelope and the per-scenario Scenario Block shape. `write-tests` reads plans in this exact shape, so this skill never defines its own competing format.

---

## How this skill is invoked

- **On demand, by a human**: type `/qa-kit:plan-tests` followed by what to analyze, e.g. `/qa-kit:plan-tests ABC-1234` or `/qa-kit:plan-tests review the attached Figma design for the new order filter fields`. **Multiple sources for the same feature** work too - e.g. `/qa-kit:plan-tests plan one feature covering ABC-1234, its subtask ABC-1235, this Figma link: <url>, and also handle this edge case: <text>` - see Step 1's "merging multiple sources" below rather than assuming only one source is ever given.
- **To update an existing plan instead of starting fresh**: `/qa-kit:plan-tests --update qa-kit-artifacts/ABC-3702-test-plan.md with <new source>` - e.g. "...with this Figma link: <url>", "...with these screenshots: <description>", or "...now that I have the missing screens, resolve the `<UI-TBD>` markers." The `--update` flag is what triggers this - same convention as `--heal`/`--apply`/`--push`/`--pr` elsewhere in this kit's skills/workflows (see `${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md`'s "Flags & Composition Reference"). See "Update Mode" below rather than a fresh run of Step 1-5.
- **Autonomously, by the agent**: if the current task matches this skill's description (e.g. the user asks "plan test coverage for ABC-1234" without naming the skill), the agent may invoke it directly.
- **From the `test-planner` agent**: when running inside the `feature-plan` workflow (see `${CLAUDE_PLUGIN_ROOT}/workflows/feature-plan.js`), the `test-planner` agent (`${CLAUDE_PLUGIN_ROOT}/agents/test-planner.md`) invokes this skill directly - same procedure, just driven by a subagent instead of the main conversation (no git setup of any kind). The skill's own behavior doesn't change based on who invokes it. `feature-plan` is deliberately plan-only - it stops for human review/approval per this skill's own "Step 5: Save for Review" before anything gets implemented; `feature-implement` is the separate workflow that continues from an approved plan.

There is no separate CLI - invocation happens through the skill mechanism above, and the resulting plan is written to a Markdown file under `qa-kit-artifacts/` (see "Output home" above) as well as summarized in the conversation.

---

## Capabilities

1. **Requirement Analysis**
   - Fetch a Jira story by ID (any project prefix, e.g. `ABC-1234` - not just `ABC-`) and its linked Confluence pages, via the `read-ticket` skill
   - Extract acceptance criteria
   - Identify user flows from Figma designs
   - Map to existing test coverage (TestRail test cases, scoped via `.qa-kit/project/testrail-mapping.md`, + repo specs)

2. **Gap Analysis**
   - Compare requirements vs existing TestRail cases and `src/tests/` specs
   - Identify missing coverage areas
   - Flag potential edge cases
   - Check for accessibility requirements

3. **Test Planning**
   - Generate test scenarios:
     - ✅ Positive scenarios (happy path)
     - ❌ Negative scenarios (error handling)
     - 🔀 Boundary conditions
     - 🐛 Edge cases
   - Prioritize tests (Critical/High/Medium/Low via `TestPriority`, TestRail-aligned - correlated with but distinct from test level; see `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`)
   - Assign appropriate tags (@smoke, @regression, etc.) - pick `Level` by the rule in `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md` (Scenario Block `Level`, Smoke > Sanity > Regression; when in doubt choose Sanity). The `Level` also decides which `/qa-kit:feature-implement --level=<level>` run implements the scenario, so give every scenario exactly one
   - Map to TestRail test cases (once the TestRail MCP server is configured - see `${CLAUDE_PLUGIN_ROOT}/docs/MCP-SETUP-GUIDE.md`)

4. **Output Generation**
   - Markdown test plan document, saved to `qa-kit-artifacts/` (gitignored) for team review
   - TestRail test case stubs (plan text only - nothing is written to TestRail)
   - Scenario checklist for implementation

---

## Workflow

### Step 1: Fetch Requirements

**Gather every source given, not just the first one.** A single feature can legitimately be described by more than one source at once - e.g. an epic plus its subtasks, a ticket plus a Figma link, or a ticket plus extra free-text context the ticket doesn't cover. Fetch/read each source independently using the matching branch below, then **merge all of them into one combined requirements set** before Step 2 - never produce a separate plan per source. (When invoked from `feature-plan`'s `test-planner` agent, `args.features[].{jiraKeys,planFiles,figmaLinks,testrailLocations,descriptions}` already arrives as one bundle per feature - see `${CLAUDE_PLUGIN_ROOT}/workflows/feature-plan.js` - so "merge" here means literally combining everything in that one bundle, not re-splitting it.)

**Every source type below can arrive in any order, mixed freely with the others** - a Jira ID, a Figma link, a TestRail location, and free text can appear in whatever sequence the caller gave them (see `${CLAUDE_PLUGIN_ROOT}/commands/feature-plan.md`'s per-item classification, which is likewise order-independent). Classify each item by *what it looks like*, never by *where it appears* in the request.

**If given one or more Jira story IDs:**
For **each** ticket key, invoke the `read-ticket` skill rather than fetching it yourself - it's the single source of truth for Jira/Confluence fetching and produces a ready-made Summary/Acceptance-Criteria/Scope/Open-Questions/**Linked References** digest per ticket. `read-ticket` itself tries `atlassian` first and falls back to `glean_default` (read-only enterprise search, also indexes Jira/Confluence) if Atlassian isn't authenticated locally - this skill doesn't need to know which one actually served each request. Merge every ticket's digest together into Step 4's `Requirements Summary`/`Scope`/`Open Questions` envelope sections (e.g. one Acceptance Criteria bullet list per ticket, clearly attributed) rather than re-deriving them or treating only the first ticket as real. **Any Figma link or TestRail location a ticket's `Linked References` surfaces is folded into the Figma/TestRail handling below, in addition to whatever was given directly** - a ticket-embedded link is never dropped just because it wasn't also typed into the request explicitly, and never replaces what was typed in either; both are kept.

**If given one or more Figma design links** (given directly, and/or surfaced by a ticket's `Linked References` above):
For **each** link, call the `mcp__figma__*` tools (configured in your MCP settings; requires `FIGMA_API_KEY` set locally, see `${CLAUDE_PLUGIN_ROOT}/docs/MCP-SETUP-GUIDE.md`) to extract design specs:
- UI components
- User interactions
- States (enabled, disabled, loading, error)
- Responsive breakpoints

**If given one or more TestRail locations** (given directly as `testrail:<projectId>/<suiteId>[/<sectionId>]` or a TestRail URL, and/or surfaced by a ticket's `Linked References` above): these are **not** a requirements source like the three above - they carry no acceptance-criteria/scope content of their own. Instead, collect them for Step 3: **any explicitly-given TestRail location(s) (from either origin, unioned and deduplicated) override `.qa-kit/project/testrail-mapping.md` entirely for this plan's TestRail cross-check** - see Step 3's "TestRail cross-check" for exactly how. If a location was given as a raw URL rather than the `testrail:` shorthand, resolve it to concrete `projectId`/`suiteId`/`sectionId` values yourself (via the TestRail MCP's own lookups, e.g. matching the URL's numeric IDs against `getProjects`/`getSuites`/`getSections`) before Step 3 - don't guess IDs from a URL's shape alone, and ask the user to clarify if it can't be resolved confidently.

**If given plain text or a pasted requirement:** use it directly, merged alongside whatever Jira/Figma/TestRail content was also given - no MCP dependency for this part either way.

**Blocking rule, evaluated across the whole merged request, not per source** (see `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md`'s blocking-vs-optional rule): a bare Jira ID or Figma link has no other route to real content on its own, but as long as **at least one** given source resolved to real content (any ticket, any Figma link, or any free text), the plan proceeds - it is not blocked just because one Jira ID among several couldn't be fetched, or a Figma link couldn't be resolved while a ticket succeeded. **A TestRail location never counts toward this** - it carries no requirements content of its own (see the TestRail-location bullet above), so a request given *only* TestRail location(s) and nothing else is treated the same as a request given nothing at all. A source that failed to resolve is never silently dropped, though: call it out explicitly, by name, in the plan's **Open Questions** section per `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md` (e.g. "ABC-1235 could not be fetched - neither Atlassian nor Glean authenticated; its acceptance criteria are missing from this plan") - this is a requirements-gathering gap, not a test-coverage gap, so it belongs in Open Questions, not in the separate "Existing Coverage" section Step 3 produces.

Only stop the whole thing if **every** given source failed to resolve (e.g. the request was a bare ticket ID - or several - and no MCP server serves any of them, and no free text was given either):
- **Running interactively (a human typed `/qa-kit:plan-tests` or asked for this)**: relay the failure(s), name every viable alternative per failed source (e.g. "Atlassian or Glean" for a Jira ID, "Figma" for a link), and ask the user to either authenticate one of them or paste the content directly - then stop and wait, don't proceed to Step 2 on a guess.
- **Running as the `test-planner` agent inside the `feature-plan` workflow (no one to ask mid-run)**: stop before Step 5 and return `{ blocked: true, blockReason: '...' }` (naming every source that failed and why) per `test-planner.md`'s instructions - never write a placeholder file to `qa-kit-artifacts/` for this feature.

**Before moving on to Step 2**: if the merged requirements are UI-relevant and leave the actual journey (where in the app it starts, what screens/states it passes through) genuinely unclear - and no source given was an image/Figma link that would otherwise show it - see "Live UI Journey Grounding" below now, not as an afterthought once the plan is already drafted. Declined, unavailable (inside `feature-plan`), or simply not needed -> carry any remaining journey gap into Step 4 as a `<UI-TBD: ...>` marker (see "Marking Unverified UI Journey Details" in `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`) instead of guessing silently.

### Step 2: Analyze & Decompose

**Identify Testable Elements:**
- User actions (clicks, inputs, navigation)
- System behaviors (validations, calculations, API calls)
- UI states (loading, success, error)
- Data transformations
- Integration points

**Coverage Types:**

1. **Positive Scenarios** (Critical-High)
   - Happy path workflows
   - Core functionality
   - Expected user journeys

2. **Negative Scenarios** (High-Medium)
   - Invalid inputs
   - Authorization failures
   - Network errors
   - Boundary violations

3. **Boundary Conditions** (Medium)
   - Min/max values
   - Empty states
   - Full states (e.g., max items in a cart)
   - Transition states

4. **Edge Cases** (Low)
   - Concurrent operations
   - Race conditions
   - Browser compatibility
   - Performance limits

### Step 3: Map to Existing Coverage

Two sources, both checked:
- **Repo specs**: start from the test index - run the *List tests* command from `.qa-kit/project/conventions.md` (default `npx playwright test --list --reporter=json`, no browser needed, `--grep @feature-tag` in a large repo) for the exact file, line, title and tags of every existing test - then Grep/Glob over `src/tests/` to confirm and to read the related specs (e.g. `Grep "feature-keyword" src/tests/`). If the list command fails, fall back to Grep/Glob alone and say so in Existing Coverage.
- **TestRail cases**: scoped, never a wide search - see "TestRail cross-check" below.

Classify each requirement area as:
- ✅ Already covered
- ⚠️ Partially covered (needs expansion)
- ❌ Not covered (new test needed)

**Then cross-check every scenario from Step 2, not just the areas**: once the TestRail cases below are fetched, invoke `verify-coverage` in plan mode with the scenario list and those cases (it never calls TestRail itself, so this step stays read-only). It returns a verdict with evidence per scenario - `duplicate`, `partial` or `new` - and this plan acts on it:
- **`duplicate`**: remove the scenario from Test Scenarios and list it in Existing Coverage with its evidence (`file:line` and test title, or the TestRail case ID), so the reviewer can see what was dropped and why. Never drop one without that row.
- **`partial`**: keep the scenario, and open its Description with the existing test it builds on ("Extends `src/tests/ui/orders/export.spec.ts` 'exports an empty order list': adds ..."), so `write-tests` adds the missing part instead of copying the test.
- **`new`**: keep it as is.
Roll the counts into the Coverage Summary and Existing Coverage sections, and let them set `Estimated Tests`. If the repo has no tests yet, or the test directory cannot be found, skip the check and add "Coverage cross-check skipped: <why>" to Open Questions, as the portability rule above says.

**Support-code check (helpers, utils, fixtures, constants, factories, page objects, API clients)**: for each concern the scenarios will need (waiting, assertions, Allure/tag metadata, random or generated input, keyboard/modifier handling, auth'd API calls, test-data builders, test IDs), follow `${CLAUDE_PLUGIN_ROOT}/patterns/helper-discovery.md` steps 1-3 - find the repo's existing implementation by purpose, not by the names this plugin's examples use. Anything with no equivalent goes into the plan's *Proposed Support Additions* section (step 4, Planning) so a human approves it with the plan; do not assume a symbol exists, and do not create anything while planning.

**If an existing spec file's name/location doesn't match the grouping this plan is about to introduce for the same feature area** (e.g. a pre-existing `order-search.spec.ts` when this plan's new files are all `order-list-*.spec.ts`), don't describe it as separate already-covered work sitting alongside new files of a different naming scheme - call for consolidating it into the new grouping instead. Record it in `Scope` as `Existing (renamed): <old-path> -> <new-path>` per `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`'s "Existing Coverage" section, and fold its existing test cases into the relevant new Coverage Type bucket rather than a standalone "already covered, elsewhere" note.

**Any statement about spec execution order, parallelism, or shared-state continuity across files must be grounded in the real `playwright.config.ts`** (`Read` it, don't assume), and expressed through Playwright's own existing mechanisms rather than a hand-rolled scheme. Both modes are legitimate, and the project's config already has a place for each - see `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`'s Notes-section guidance for the full breakdown:
- **Serial/full-regression** (state continuity across files) is already the default (`fullyParallel: false`, `workers: 1`) - don't propose a redundant new project to re-achieve it.
- **Parallel/isolated** runs (faster iteration, independent debugging, CI parallelism) are equally valid - describe them as an additional named `project` in `playwright.config.ts` (same pattern as the existing `setup`/`chromium` split), not a scheme outside the `projects` array.
- **Order/relations between files**, when genuinely required, get described declaratively (which file needs which prior state, and why) so `write-tests` can implement it via `test.describe.configure({ mode: 'serial' })` and/or project `dependencies` - never via numbered filename prefixes.
- Don't pre-author fixture/config implementation code in the plan itself - that's `write-tests`' job at implementation time. See "Quality Criteria" below for the tag-based-determinism rule that applies if the need includes any notion of "critical" vs. "non-critical" failures blocking the rest of a run.

**TestRail cross-check**:

- **If Step 1 collected any explicit TestRail location(s)** (given directly and/or surfaced from a ticket's `Linked References`, unioned and deduplicated): use **exactly those** locations for this plan's *entire* cross-check - **this wins over `.qa-kit/project/testrail-mapping.md` outright, for every `TestFeature` this plan touches, not just the one(s) the location happens to name.** Call `mcp__testrail__getCases` (or equivalent) scoped to each given `projectId`/`suiteId`/`sectionId`. No keyword list travels with a command-given location the way `testrail-mapping.md`'s entries carry one - if a scoped location returns few enough cases to review directly, use them as-is; if it returns a lot, filter by this plan's own scenario/feature terms (the same *idea* as the mapping file's `Keywords`, just derived from this plan's content instead of a pre-authored list) rather than dumping everything unfiltered. Note in "Existing Coverage" that this plan used an explicit override, and which location(s), so a reviewer knows why coverage came from there instead of the mapping file.
- **Otherwise**, look up every `TestFeature` this plan's scenarios touch (from Step 2's analysis) against `.qa-kit/project/testrail-mapping.md` - the single source of truth for which exact TestRail project/suite/section(s) hold that feature's cases (a feature can map to more than one location; union and dedupe across every scenario in this plan). For each mapped location, call `mcp__testrail__getCases` scoped exactly to that location's `projectId`/`suiteId`/`sectionId` - **never** an unscoped project-wide or instance-wide query - then filter those results by that location's own `Keywords` list, a filter within an exact scope, not a substitute for one. **A `TestFeature` with no entry (or an explicit `Unmapped`) in `testrail-mapping.md` skips the cross-check entirely** - note it as unavailable in "Existing Coverage" per the optional-dependency rule in "MCP Integration" below, and don't fall back to a wide/unscoped search just to have something - that's exactly the cost this mapping file exists to avoid. You may suggest to the user that adding a mapping entry would help future plans, but never edit `testrail-mapping.md` yourself while planning.

Either path needs `mcp__testrail__*` configured in your MCP settings (requires `TESTRAIL_URL`/`TESTRAIL_USERNAME`/`TESTRAIL_API_KEY` set locally, see `${CLAUDE_PLUGIN_ROOT}/docs/MCP-SETUP-GUIDE.md`) - an explicit override doesn't bypass needing the server itself, only bypasses the mapping file lookup.

### Step 4: Generate Test Plan

**Output Format**: follow `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md` exactly - it defines both the envelope (Requirements Summary -> Test Scenarios -> Coverage Summary -> Existing Coverage -> TestRail Mapping -> Implementation Priority -> Notes -> Next Steps) and the per-scenario **Scenario Block** used inside "Test Scenarios." Every scenario in the plan, in every priority bucket (Positive/Negative/Boundary/Edge Case), is one Scenario Block - this is the same block shape `test-writer` parses directly, so don't improvise a different per-scenario structure here.

Populate the envelope sections from this skill's own analysis, **merging every source Step 1 gathered - never just whichever one came first**:
- **Requirements Summary / Acceptance Criteria** - each fetched ticket's `read-ticket` digest (one per Jira ID, attributed), plus whatever Figma design specs and/or plain-text content were also given, combined into one summary and one Acceptance Criteria list - not "Jira's digest, or else Figma/text" as alternatives.
- **Scope** - same merge: each Jira ticket's `read-ticket`-derived Scope, plus Scope derived the same way for any Figma link/free text also given (product area inferred from what was given, automation-codebase area from real `Glob`/`Grep` over `src/support/`/`src/tests/`) - one combined Scope section, deduplicated where sources overlap.
- **Proposed Support Additions** - the gaps found by Step 3's support-code check, in the table shape from `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`; omit the section if nothing is missing
- **Open Questions** - every source's Open Questions merged together, plus any failed-source gaps from Step 1's "Blocking rule" (e.g. a Jira ID that couldn't be fetched while others succeeded); omit the section entirely only if it's genuinely empty across *all* sources, never because just one source had nothing to add
- **Test Scenarios** - one Scenario Block per test identified in Step 2, grouped by the four Coverage Types. Any journey detail inside a block's `Preconditions`/`Steps`/`Expected Results` that's still unconfirmed at this point (no source described it, and it wasn't grounded live per "Live UI Journey Grounding" below) gets marked inline with `<UI-TBD: ...>` per `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md` - never guessed and written as if it were confirmed.
- **Coverage Summary** - counts/status rolled up from the Scenario Blocks above
- **Test Type (header field)** - `**Test Type**: ui | api | both` in the plan's header, exactly one lowercase value, because `feature-implement` reads it to know what to build: `ui` if every scenario's `Type` is UI (including UI A11y/Performance) and none exercises the API layer; `api` if every scenario is API-only; `both` if the plan has any API scenario alongside UI ones, or any scenario whose `Type` carries both UI and API. Never omit it and never leave it for the reader to infer.
- **Existing Coverage** - from Step 3's gap analysis
- **TestRail Mapping** - one entry per Scenario Block's `ID`, once the TestRail MCP is configured
- **Implementation Priority** - Scenario Blocks grouped into phases by their `Priority` field
- **Notes / Next Steps** - repo conventions reminder + the standard hand-off to `write-tests`/`execute-tests`

### Step 5: Save for Review

Write the plan above to `qa-kit-artifacts/<story-or-feature-slug>-test-plan.md` - **never overwrite an existing file here**: if that path already exists (a prior plan, possibly already reviewed or hand-edited), save to `qa-kit-artifacts/<story-or-feature-slug>-test-plan-v2.md` instead (`-v3`, `-v4`... if that exists too), return the actual path you wrote, and tell the user both paths. Only Update Mode (below) ever rewrites an existing plan, because `--update` is the user's explicit choice to revise it. Prepare the folder first, without touching any tracked file: create `qa-kit-artifacts/` if it doesn't exist, and if `qa-kit-artifacts/.gitignore` doesn't exist create it containing the single line `*` (the folder then ignores itself, so nothing in it can ever be committed, even in a repo where `/qa-kit:init` was never run, and parallel planners writing the same file is harmless). Do not edit the repo's own `.gitignore` - `/qa-kit:init` adds the folder there. If `git check-ignore -q <the plan path>` still says the file is not ignored, say so in your report instead of fixing it yourself. Tell the user the file path and ask them to review/approve before handing it to `write-tests`. Don't skip this step even for a short, verbally-described plan - the point is a durable, reviewable artifact the team can comment on outside the chat.

---

## Update Mode

**Trigger**: the request carries the `--update` flag plus the existing plan file's path under `qa-kit-artifacts/`, e.g. `/qa-kit:plan-tests --update qa-kit-artifacts/ABC-3702-test-plan.md with these screenshots: <description>`. `--update` is the trigger, not just mentioning an existing file path in passing - without it, every invocation in "How this skill is invoked" above still produces a brand-new plan via Steps 1-5. Update Mode exists only to let new information (a Figma link/screenshot that arrived after the ticket was planned, extra text, an answer to an `Open Questions`/`<UI-TBD>` item) get merged into a plan that may already carry team review, without discarding that.

**Why this matters**: a plan in `qa-kit-artifacts/` may already carry a team's comments/approval on top of the Markdown - regenerating it from scratch on every new detail throws that away and produces a second, un-reconciled document. Update Mode edits the *same* file in place instead.

### Steps

1. **Load the existing plan** (`Read`) - this is the baseline, not a source to merge equally with the new ones; anything in it that the new source doesn't touch is preserved verbatim, including any human-added notes outside the standard sections.
2. **Fetch/read whatever new source(s) were given** - same per-source handling as Step 1 above (Jira ID -> `read-ticket`, Figma link -> `mcp__figma__*`, TestRail location -> collected for Step 3's override, free text/screenshot description -> used directly). A new TestRail location given during an update **replaces** whatever override (or mapping-file fallback) the existing plan was using, for any re-run of the TestRail cross-check this update triggers - same "wins over the mapping file" rule as a fresh plan. If a new source is itself insufficient in a way that would normally block a fresh plan, that same "Blocking rule" applies here too - evaluated only against the *new* source(s), since the existing plan already has whatever the old sources provided. **If `--update <path>` was given with no new source at all** (no source text after it), don't fabricate one to have something to merge - re-scan the existing plan's own `Open Questions`/`<UI-TBD>` entries against what's already in the plan/repo in case anything's answerable without new input, then say plainly that nothing changed if it isn't. This is a no-op, not an error.
3. **Reconcile, don't regenerate**:
   - Any `<UI-TBD: ...>` marker (see `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`) the new source actually answers gets resolved in place - replace the marker with the real detail, in the same `Preconditions`/`Steps`/`Expected Results` line it was in.
   - Any `Open Questions` entry the new source answers gets resolved the same way - removed from `Open Questions`, folded into whatever section it actually affects.
   - New scenarios the new source reveals get appended to the right Coverage Type bucket in `Test Scenarios`, with fresh sequential `ID`s continuing from the existing plan's highest `TC-NNN`. Run each new scenario through the same `verify-coverage` plan-mode cross-check as Step 3, and handle `duplicate`/`partial` the same way (a dropped duplicate is listed in Existing Coverage with its evidence).
   - **If the new source contradicts something already in the plan** (not just adds detail, but disagrees with it), don't silently overwrite - add a new `Open Questions` entry naming the conflict for a human to resolve, and leave the original content as-is until then.
   - **Any journey detail still unclear after all of the above** - a pre-existing `<UI-TBD>` the new source didn't answer, or a new one the new scenarios above introduce - stays/becomes `<UI-TBD: ...>` the same way a fresh plan would (see Step 4's rule above). If running interactively, this is also a fine moment to offer "Live UI Journey Grounding" below instead of leaving it marked, same opt-in gate as a fresh plan.
4. **Re-save to the same file path**, overwriting it, plus a one-line **Revised** note appended right under the document's title/metadata block (e.g. `**Revised**: 2026-09-10 - merged Figma link https://figma.com/... ; resolved 2 <UI-TBD> markers in TC-002, TC-004`) - so a reviewer who already looked at this plan once can see exactly what changed instead of re-reading the whole thing. If the merge adds or removes scenarios in a way that changes the UI/API mix, update the header's `**Test Type**` to match and mention it in the Revised note.
5. Tell the user the same file path was updated (not a new one created) and ask them to re-review before handing it to `write-tests` - same review gate as a fresh plan, per "Step 5: Save for Review" above.

**Scope note**: works the same way regardless of which track the plan is on (see `${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md` §7 "Two tracks") - a manually-`/qa-kit:plan-tests`'d file in `qa-kit-artifacts/`, or a `feature-plan`-produced one (also in `qa-kit-artifacts/`), update the same way; Update Mode doesn't change which track a plan is on.

---

## Live UI Journey Grounding (optional, opt-in, interactive only)

**Not a default step.** This skill normally reasons from ticket/Figma/free-text content alone (see Step 1) - this section only applies when a UI-relevant feature's actual journey (where in the app it starts, what screens/states it passes through) is genuinely unclear from every source given, *and* none of those sources is an image/Figma link that would otherwise show it. Don't reach for this to double-check something the sources already describe clearly.

**Trigger**: after Step 1, if the merged requirements leave the UI journey ambiguous, ask the user - don't just do it: *"I can open the live app and explore this journey myself to ground the plan - it'll be a headed browser, and I'll need you to log in / navigate to the right starting point. Want me to, or should I mark the ambiguous parts `<UI-TBD>` instead?"* Proceed only on a yes; on no (or no answer), fall through to marking the gaps `<UI-TBD: ...>` per `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md` and continue Step 2 normally.

**Not available inside `feature-plan`** - the `test-planner` agent runs non-interactively (no one to log in mid-pipeline), so this path never triggers there; a `feature-plan`-produced plan always falls back to `<UI-TBD>` markers for anything it can't ground from ticket/Figma/text content alone. A human can still ground it later by hand, once they've explored the app themselves or captured screenshots, via "Update Mode" above.

**If the user opts in:**
1. Open a **headed** Playwright MCP browser session (`mcp__playwright__browser_navigate` to `TARGET_ENVIRONMENT_URL`) - never headless, this needs a human at the keyboard.
2. **Wait for the user** to log in and/or navigate to the relevant starting point themselves - this skill never has/uses credentials and never fills in a login form. Ask them to confirm (e.g. "ready") once positioned; don't guess when they're done.
3. From there, explore read-only (`browser_snapshot`/`browser_click`/`browser_hover`/`browser_wait_for`) to see what screens/states exist and how they connect - this is about understanding **where the journey starts and what it's meant to achieve**, not about finding exact selectors (that's `discover-locator`'s job, at `write-tests` time, per the Locator Strategy Priority in `discover-locator`'s own `SKILL.md`). Don't chase individual element locators here.
4. Feed what was actually observed into Step 2/4 - ground `Scope`'s automation-codebase area and each affected Scenario Block's `Preconditions`/`Steps` with what you saw, and resolve any `<UI-TBD>` marker the exploration actually answered. Anything still unclear after this stays `<UI-TBD>` - exploring live doesn't obligate resolving everything, just improves on guessing blind.
5. Close the session (`browser_close`) once done - don't leave a live session open past this skill's run.

---

## Quality Criteria

### Test Scenarios Must Be:

1. **Specific** - Clear, unambiguous steps
2. **Deterministic** - Same input -> same result
3. **Business-Aware** - Why are we testing this?
4. **Comprehensive** - Cover positive, negative, boundary, edge
5. **Prioritized** - Critical -> Low via `TestPriority`, TestRail-aligned
6. **Tagged Appropriately** - `TestLevel.SMOKE`/`SANITY`/`REGRESSION` (exactly one), `TestType.UI`/`API`, plus the relevant `TestFeature` tag(s) - reuse an existing `TestFeature` member whenever one fits (the typical case); only rarely, when a feature genuinely has no matching member yet, propose a new one marked as new for `write-tests` to add (see `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`'s Scenario Block `Tags:` rule) - don't route a missing `TestFeature` member through `Open Questions` as if it were a business ambiguity
7. **Implementable** - Can be automated with existing infrastructure
8. **Deterministic about criticality** - if a scenario's design implies some failures should block/skip subsequent tests and others shouldn't (e.g. a shared-state suite where an early failure invalidates later tests), that distinction must be derivable from the scenario's own `TestPriority`/`TestLevel` fields (e.g. "Critical+Smoke blocks the rest of the run") - never from its `ID`, title text, or position in the file. A rule keyed to a specific test's number or name silently stops matching the moment scenarios are renumbered, renamed, or reordered; a rule keyed to its tags doesn't.

### Avoid:

- ❌ Vague scenarios ("Test the button")
- ❌ Missing expected results
- ❌ Unrealistic edge cases
- ❌ Scenarios that can't be automated
- ❌ Duplicate coverage
- ❌ A `Story: <ticket-id>` field on a Scenario Block (see `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`'s "No `Story` Field" section)
- ❌ Prescribing concrete `TEST_IDS`/locator constants, or numbered filename prefixes for execution order, anywhere in the plan (see `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`'s Notes-section guidance - `test.describe.configure({ mode: 'serial' })`/project `dependencies`/an additional `project` entry are the real mechanisms for order, relations, and parallelism, respectively)
- ❌ Treating a missing `TestFeature` member as an `Open Questions` business ambiguity - it's a rare, implementation-time addition `write-tests` makes, not a decision only a human/PM can make

---

## MCP Integration

See `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md` for the shared rule (live calls only, never fabricate a disconnected server's output, and - critically - decide blocking vs optional across the whole merged request before reacting). Servers this skill uses:
- **Atlassian** (`mcp__atlassian__*`, configured in your MCP settings; each developer authorizes via OAuth on first use): not called directly by this skill anymore - `read-ticket` owns the Jira/Confluence fetch (see Step 1), this skill just consumes its digest(s). **Blocking, per Jira ID**, unless another given source (another ticket, a Figma link, free text) already resolved - see Step 1's "Blocking rule."
- **Glean** (`mcp__glean_default__*`, configured in your MCP settings; own separate one-time login): also not called directly here - it's `read-ticket`'s read-only fallback for the same Jira/Confluence fetch when Atlassian isn't authenticated locally. Same status as Atlassian - they're alternatives for the same ticket, not independent dependencies.
- **Figma** (`mcp__figma__*`, configured in your MCP settings; needs `FIGMA_API_KEY` set locally): extract component/state specs referenced by the story. **Blocking, per Figma link**, unless another given source already resolved; not a dependency at all for a request with no Figma link in it.
- **TestRail** (`mcp__testrail__*`, configured in your MCP settings; needs `TESTRAIL_URL`/`TESTRAIL_USERNAME`/`TESTRAIL_API_KEY` set locally): read existing test cases for gap analysis (read-only: nothing is created or synced in TestRail; the stubs stay plan text) - always scoped, either to an explicit TestRail location given for this plan or to `.qa-kit/project/testrail-mapping.md` (see Step 3), never an unscoped search across the whole instance. **Always optional** - the plan itself never depends on it; skip Step 3's TestRail cross-check gracefully (server unauthenticated, **or** authenticated but this feature has neither an explicit location nor a mapping entry) and note it as unavailable in "Existing Coverage" rather than blocking anything or falling back to a wide search.
- **Playwright** (`mcp__playwright__*`, configured in your MCP settings): **optional, opt-in only, interactive sessions only** - live-explores the running app to ground an ambiguous UI journey when no screenshot/Figma link was given (see "Live UI Journey Grounding" above). Never triggered automatically, never available inside the non-interactive `feature-plan` workflow, and never used for locator-level detail - that stays `discover-locator`'s job at `write-tests` time.

Stop entirely only if **every** given source across the merged request failed to resolve (see Step 1's "Blocking rule" for the exact reaction, interactive vs. inside `feature-plan`). If at least one source resolved, continue and just flag the ones that didn't. If only an **optional** server (TestRail) is missing, continue and say so in the output - never a reason to stop.

---

## Example Output

**Input**: Jira story ABC-3702 - "User can filter orders by status"

**Output**: Comprehensive test plan with:
- 4 positive scenarios (Critical-High)
- 3 negative scenarios (High-Medium)
- 2 boundary conditions (Medium)
- 1 edge case (Low)
- TestRail mapping
- Implementation priority
- Gap analysis vs existing tests

---

## Success Metrics

- ✅ All acceptance criteria covered
- ✅ Positive, negative, boundary, edge scenarios identified
- ✅ Priority assigned based on business impact
- ✅ Tags assigned for test organization
- ✅ Gaps identified vs existing coverage, and every scenario cross-checked with `verify-coverage` - a duplicate is never planned again, and never dropped without a row (with evidence) in Existing Coverage
- ✅ TestRail stubs included as plan text (if applicable)
- ✅ Implementation plan with phases
- ✅ Scope names real automation-codebase files (via `Glob`/`Grep`), not assumed ones
- ✅ Open Questions section present only when there's genuine ambiguity, never padded, never silently dropped
- ✅ `<UI-TBD: ...>` used only for mechanical journey gaps live-inspection would resolve, never as a substitute for a genuine `Open Questions` business ambiguity
- ✅ Live UI Journey Grounding only ever run after an explicit yes from the user, never assumed/default
- ✅ Update Mode preserves existing plan content/review notes in place rather than regenerating the document from scratch, including each scenario's `Level` (re-evaluate it only when the new source changes what the scenario covers, and give every new scenario one)
- ✅ TestRail cross-check always scoped exactly - either an explicit TestRail location given for this plan, or `.qa-kit/project/testrail-mapping.md`'s exact project/suite/section IDs - never an unscoped/whole-instance search
- ✅ An explicit TestRail location (direct or ticket-embedded) always wins over `testrail-mapping.md` for the whole plan, and works even when the mapping file has no entry for any `TestFeature` this plan touches
- ✅ A naming/grouping conflict with an existing spec file is called out as a rename/consolidation, never left as a coexisting duplicate
- ✅ Any execution-order/parallelism statement is checked against the real `playwright.config.ts`, and expressed via Playwright's own `project`/`dependencies`/serial-mode mechanisms - not assumed, reinvented, or hand-rolled
- ✅ `Tags` on every Scenario Block reuse an existing `TestFeature` member wherever one fits; a genuinely missing member is proposed as new for `write-tests` to add, not raised as an `Open Questions` ambiguity

---

**Note**: This skill focuses on PLANNING. It saves its output to `qa-kit-artifacts/` for review - it never writes directly into `src/tests/`. Use the `write-tests` skill to implement the actual tests once the plan is approved.
