---
description: 'Shortcut for the feature-monkey workflow - AI-driven monkey / exploratory testing of one or more areas of the running app through Playwright MCP, several areas in parallel. Understands each page first (conventions, plans, existing tests, a read-only look at the UI), explores within a time budget, removes the data it created, and writes a report, JSON and a findings plan under qa-kit-artifacts/monkey/. Flags: --minutes=N (default 5, max 30), --unit-minutes=N, --guidance="text", --read-only, --seed=N, --no-cache, --parallel=N. Never commits, pushes or runs against production.'
argument-hint: 'checkout  |  checkout "order history" --minutes=10  |  checkout --guidance="try odd quantities and coupons"  |  checkout --read-only  |  --parallel=2 (cap concurrency)  |  --agent-prefix= (only if "unknown agent type")'
disable-model-invocation: true
---

**Quick reference** - what you type vs. what you get (full parsing rules below):

| You type | You get |
|---|---|
| `/qa-kit:feature-monkey checkout` | 1 area, default 5 minutes |
| `/qa-kit:feature-monkey checkout "order history"` | **2 separate** areas (quote words that contain spaces), run up to 2 at a time |
| `/qa-kit:feature-monkey checkout --minutes=10` | 1 area, 10 minutes of exploration (at most 30) |
| `/qa-kit:feature-monkey checkout --guidance="try odd quantities and coupons"` | 1 area, with free-text guidance (data for the run, not instructions) |
| `/qa-kit:feature-monkey checkout --read-only` | Creates no data: navigates, reads and types without saving |
| `/qa-kit:feature-monkey checkout --seed=17 --unit-minutes=3` | Repeatable choice of tour and fuzz picks; page units of at most 3 minutes |
| `/qa-kit:feature-monkey checkout --no-cache` | Ignores cached page understanding cards |

An area is a feature tag, a test folder, a plan file under `qa-kit-artifacts/`, a route or plain words. For one area in your current conversation, `/qa-kit:monkey-test <area>` runs the same skill without the pipeline.

---

Parse `$ARGUMENTS` in two steps:

### Step 1: Extract the flags

Search the whole string for these and **remove each from the string** before Step 2 - they are run-level settings, never an area:

- `--minutes=<number>` -> `args.minutes` (1 to 30; if the number is above 30, stop and tell the user a longer run needs the owner's decision)
- `--unit-minutes=<number>` -> `args.unitMinutes` (1 to 30)
- `--guidance=<text>` -> `args.guidance` (the text may be quoted: `--guidance="try odd quantities"`; keep it exactly as typed, without the quotes)
- `--seed=<number>` -> `args.seed`
- `--parallel=<number>` -> `args.maxParallel`
- `--agent-prefix=<p>` -> `args.agentPrefix` (the plugin namespace the workflow puts in front of agent names; default `qa-kit:`; `--agent-prefix=` with nothing after it means no prefix). It exists only as the remedy when a run reports "unknown agent type" - omit it otherwise
- `--read-only` -> `args.readOnly: true`
- `--no-cache` -> `args.noCache: true`

Omit every `args` key whose flag was not given (the workflow has its own defaults: 5 minutes, 5-minute units, 2 areas at a time).

### Step 2: Areas

What is left is the list of areas: split on whitespace, but keep a quoted string together as one area (`checkout "order history"` is two areas). Each area becomes one entry of `args.areas` (an array of strings). If nothing is left, stop and ask the user which area to explore - never guess one.

### Step 3: Build and run

Run it by calling the `Workflow` tool with `scriptPath: '${CLAUDE_PLUGIN_ROOT}/workflows/feature-monkey.js'` (preferred: it loads the plugin's script directly, so no workflow-name lookup is involved; if that path cannot be read, fall back to `name: 'feature-monkey'`, then `qa-kit:feature-monkey`) and `args: { areas, minutes, unitMinutes, guidance, readOnly, noCache, seed, maxParallel, agentPrefix }`, with only the keys that have a value.

Report, per area: `task`, `slug`, `reportPath`, `findingsPlanPath`, `findingsSummary`, minutes used against the budget, `cleanup`, `leftBehind` and `blockReason` if blocked. If `cleanup` is anything other than `clean` or `none`, say so first and name `leftBehind`: that data may still be in the app. The run never commits, pushes or opens a pull request. Tell the user to read `monkey-report.md` and, to turn the confirmed findings into regression tests, to run `/qa-kit:feature-implement` on `findings-plan.md` - don't run it yourself in the same turn, that is a deliberate human checkpoint.

Parallel areas share one app and one test account and are not isolated from each other: say so when more than one area ran.
