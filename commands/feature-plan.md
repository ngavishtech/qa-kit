---
description: 'Shortcut for the feature-plan workflow (plan-only phase) - plan one or more features in parallel, each combining one or more sources (Jira/Figma/TestRail location/free text, in any order), or revise an already-planned feature in place. Flags: --plan <src, src, ...> (repeatable - merges everything in one block into ONE feature), --update <path>, <src, ...> (repeatable - merges new sources into an already-planned feature''s existing plan), --parallel=N. A TestRail location (testrail:<projectId>/<suiteId>/<sectionId> or a TestRail URL) overrides testrail-mapping.md for that plan. Stops for human review before feature-implement.'
argument-hint: 'ABC-1234, "text" (2 separate features)  |  --plan ABC-1234, ABC-1235, "text" (1 merged feature)  |  --plan ABC-1234, testrail:3/12/104 (TestRail override)  |  --update qa-kit-artifacts/ABC-1234-test-plan.md, "text" (revise existing plan)  |  --parallel=2 (cap concurrency)  |  --agent-prefix= (only if "unknown agent type")'
disable-model-invocation: true
---

**Quick reference** - what you type vs. what you get (full parsing rules below):

| You type | You get |
|---|---|
| `/qa-kit:feature-plan ABC-1234` | 1 feature, 1 source |
| `/qa-kit:feature-plan ABC-1234, qa-kit-artifacts/plan.md, "extra text"` | **3 separate** features, 1 source each |
| `/qa-kit:feature-plan --plan ABC-1234, ABC-1235, "extra text"` | **1 feature**, 3 sources merged into it |
| `/qa-kit:feature-plan ABC-9000, --plan ABC-1234, ABC-1235` | 2 features: `ABC-9000` alone, and `ABC-1234`+`ABC-1235` merged |
| `/qa-kit:feature-plan --plan ABC-1 --plan ABC-2, ABC-3` | 2 features: `ABC-1` alone, and `ABC-2`+`ABC-3` merged |
| `/qa-kit:feature-plan ABC-1234 --parallel=2` | 1 feature; caps concurrency at 2 for this run (matters once there are several) |
| `/qa-kit:feature-plan --update qa-kit-artifacts/ABC-1234-test-plan.md, "these screenshots: <desc>"` | Revises the **existing** plan file at that path in place (no new file) - not a fresh feature |
| `/qa-kit:feature-plan --plan ABC-1234, testrail:3/12/104, https://figma.com/file/abc, "extra text"` | **1 feature**, 4 sources merged, **in any order** - the TestRail location overrides `testrail-mapping.md` for this plan's cross-check |

**Common mistakes this causes if you skip `--plan`**: `/qa-kit:feature-plan ABC-1, ABC-2` plans **two separate** features (each its own plan file), not one feature covering both tickets. If you meant one feature made of both, you needed `/qa-kit:feature-plan --plan ABC-1, ABC-2`. Always quote free text (`"..."`) - an unquoted description containing a comma will get split into extra, bogus sources.

**`--update` is a different flag from `--plan`, not a variant of it** - `--plan` always starts a *fresh* feature (new plan file), even if it merges several sources into it; `--update` always revises an *existing* one (same plan file, in place), even if you only give it one new source. Never mix the two inside the same block.

---

Parse `$ARGUMENTS` in three steps:

### Step 1: Extract run-level flags (`--parallel=N`, `--agent-prefix=<p>`), if present, before anything else

A value flag given twice (for example `--parallel=2 --parallel=3`) is an error: stop and say so, never keep one silently. Search the whole string for `--parallel=<number>` (it can appear anywhere - before, inside, or after any `--plan` block). If found, set `args.maxParallel` to that number and **remove it from the string** before Step 2 - it's a run-level setting, not a feature source, and must never end up inside a `jiraKeys`/`descriptions`/etc. array. If absent, omit `args.maxParallel` entirely (default concurrency, 3).

Do the same for `--agent-prefix=<p>` -> `args.agentPrefix` (the plugin namespace the workflow puts in front of agent names; default `qa-kit:`; `--agent-prefix=` with nothing after it means no prefix). It exists only as the remedy when a run reports "unknown agent type" - omit it otherwise.

### Step 2: Parse what's left in passes - the three grammars can be freely mixed in one call, not either/or

**Classification is entirely by what an item *looks like*, never by its position.** Within any block (`--plan`, `--update`, or a Pass-2 leftover), items can appear in **any order** - `testrail:3/12/104, ABC-1234, "text", https://figma.com/file/abc` classifies identically to `ABC-1234, https://figma.com/file/abc, testrail:3/12/104, "text"`. Parse the whole block first, classify every item independently, *then* act - don't assume a fixed positional grammar (e.g. "Jira key always first").

**Pass 1 - carve out `--plan` and `--update` blocks first.** Find every occurrence of either literal token (`--plan`, `--update`); everything from one such token up to the next `--plan`/`--update` token (or end of string) is one block. Which token started a block decides what kind it is - **never mix the two inside one block**.

- **A `--plan`-started block** is a fresh multi-source feature (unchanged from before this flag existed). Split the block on top-level commas (a quoted string's internal commas don't split it) and classify each item, **in any order**:
  - A Jira ticket key (e.g. `ABC-1234`) -> collect into that feature's `jiraKeys[]`
  - A path under `qa-kit-artifacts/` (a plan file) -> `planFiles[]`
  - A Figma URL (contains `figma.com`) -> `figmaLinks[]`
  - A TestRail location - either the `testrail:<projectId>/<suiteId>[/<sectionId>]` shorthand, or a URL containing TestRail's characteristic `/index.php?/` path shape -> `testrailLocations[]`. This is **not** requirements content like the other three - it's an override for `plan-tests`'s Step 3 TestRail cross-check (see its `SKILL.md`), carrying no acceptance-criteria/scope content of its own.
  - Anything else (plain text/quoted description) -> `descriptions[]`

  Each `--plan` block becomes exactly one feature object with whichever of those five arrays it populated, e.g. `--plan ABC-1234, ABC-1235, https://figma.com/file/abc, testrail:3/12/104, "Add CSV export to the orders table"` -> `{ jiraKeys: ['ABC-1234', 'ABC-1235'], figmaLinks: ['https://figma.com/file/abc'], testrailLocations: ['testrail:3/12/104'], descriptions: ['Add CSV export to the orders table'] }`.

- **An `--update`-started block** revises an already-planned feature instead of starting a new one. Its **first** item (before the first comma) is always the path to the existing plan (e.g. `qa-kit-artifacts/ABC-1234-test-plan.md`), never a source - split the rest of the block on top-level commas the same way as `--plan`, classifying each remaining item into `jiraKeys`/`planFiles`/`figmaLinks`/`testrailLocations`/`descriptions` the same five ways (again, in any order); those are the **new** sources to merge in, not the whole feature's sources. Then build `plan` as `{ planPath }` using that path directly - a plan is just that file, so no prior report is needed; if a prior `feature-plan` report entry in this conversation matches by `planPath`, take its `{ task, planPath, testType }` unmodified instead (extra fields like `task` are harmless). Build the update object as `{ plan, jiraKeys?, planFiles?, figmaLinks?, testrailLocations?, descriptions? }` from the new sources. If the file doesn't exist at that path, the workflow reports it blocked rather than starting a second, disconnected plan - surface that and ask the user for the right path.

**Pass 2 - whatever's left over (everything before the first `--plan`/`--update`, if either is used at all; or the entire string when neither appears) is the legacy shorthand.** Split that leftover text on top-level commas the same way; each resulting item is its **own** feature with exactly one source, classified the same five ways as above but each wrapped as a length-one array (e.g. a bare `ABC-9000` -> its own feature `{ jiraKeys: ['ABC-9000'] }`). A bare `testrailLocations`-only Pass-2 item is legal but not very useful on its own - per `plan-tests`'s "Blocking rule," a TestRail location carries no requirements content, so a feature with *only* one is treated as if nothing was given at all.

So `/qa-kit:feature-plan ABC-9000, --plan ABC-3702, ABC-3703, "..."` produces **two** features: `{ jiraKeys: ['ABC-9000'] }` (Pass 2, its own plan) and `{ jiraKeys: ['ABC-3702', 'ABC-3703'], descriptions: ['...'] }` (Pass 1, one merged plan) - never guess that a leading bare item belongs *inside* the first `--plan` block just because it appears before it. Similarly, `/qa-kit:feature-plan ABC-9000, --update qa-kit-artifacts/ABC-1234-test-plan.md, "add the empty-cart edge case"` produces one Pass-2 feature plus one Pass-1 update against the matched report entry for `qa-kit-artifacts/ABC-1234-test-plan.md`.

### Step 3: Build and run

Build `args.features` from every Pass-1 `--plan` block and every Pass-2 leftover item - always the plural/array field names (`jiraKeys`/`planFiles`/`figmaLinks`/`testrailLocations`/`descriptions`), even for a Pass-2 single-source feature (see `${CLAUDE_PLUGIN_ROOT}/patterns/usage-examples.md` examples E and F for the exact shape and worked examples of both passes, including the mixed case). Build `args.updates` from every Pass-1 `--update` block the same way, each as `{ plan, jiraKeys?, planFiles?, figmaLinks?, testrailLocations?, descriptions? }`.

Run it by calling the `Workflow` tool with `scriptPath: '${CLAUDE_PLUGIN_ROOT}/workflows/feature-plan.js'` (preferred: it loads the plugin's script directly, so no workflow-name lookup is involved; if that path cannot be read, fall back to `name: 'feature-plan'`, then `qa-kit:feature-plan`) and `args: { features: [...], updates: [...], maxParallel, agentPrefix }` - omit `features`/`updates` entirely (not as an empty array) if that call had none of that kind, and omit `maxParallel`/`agentPrefix` entirely if their flags weren't given.

Report the returned plan(s) - `task`/`planPath`/`testType`/`updated`, or `blocked`/`blockReason` if planning/updating failed - and remind the user to review the `qa-kit-artifacts/*.md` file(s) before running `/qa-kit:feature-implement`. Don't run `/qa-kit:feature-implement` yourself as a follow-up in the same turn - that step is a deliberate human checkpoint, not something to chain automatically.
