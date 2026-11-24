---
description: 'Shortcut for the feature-diff workflow - read-only. Starts from the code that changed (not from a ticket like feature-plan): looks at a set of changes (your local checkout against another branch, local or remote, the last N days, pull requests, or pull requests of a separate GitHub app repo), crosses them with the existing tests, marks every affected area covered, partial or none, and writes one reviewable plan per coverage gap plus the execution scope for the affected existing tests. Stops at plan review: review the plans, then run feature-implement. Flags: --base=<ref>, --head=<ref>, --since=<days>, --repo=<org/app> (repeatable), --min-confidence=high, --fetch, --no-select, --run-affected, --no-smoke, --threshold=<percent>, --parallel=N. Never commits, writes or heals a test.'
argument-hint: '(nothing = this branch vs the default branch)  |  123, 130  |  --base=origin/main  |  --since=7  |  --repo=org/app 456  |  --repo=org/a --repo=org/b --since=7  |  --run-affected  |  --no-select  |  --min-confidence=high  |  --fetch  |  --parallel=2  |  --agent-prefix= (only if "unknown agent type")'
disable-model-invocation: true
---

**Quick reference** - what you type vs. what you get (full parsing rules below):

| You type | You get |
|---|---|
| `/qa-kit:feature-diff` | Your local checkout (committed, staged, unstaged and new files) compared with the default branch: coverage gaps planned, and the tests to run |
| `/qa-kit:feature-diff --since=7` | The commits of the last 7 days |
| `/qa-kit:feature-diff 123, 130` | The changes of pull requests 123 and 130 |
| `/qa-kit:feature-diff --base=origin/release-5 --fetch` | Against a remote branch (fetches that one branch if it is not available locally) |
| `/qa-kit:feature-diff --repo=org/app 456` | Pull request 456 of a separate GitHub app repo; the tests stay the ones in this repo |
| `/qa-kit:feature-diff org/orders#456, org/billing#12` | Pull requests of several repos, analysed as one change set (a product that spans several services) |
| `/qa-kit:feature-diff --repo=org/orders --repo=org/billing --since=7` | The last 7 days of merged pull requests of both repos |
| `/qa-kit:feature-diff --run-affected` | Also runs the affected existing tests once, report-only, never healing (a narrowed selection only) |
| `/qa-kit:feature-diff --no-select` | Coverage and plans only, no execution scope |

It writes the plans under `qa-kit-artifacts/`, and under `qa-kit-artifacts/changes/` the analysis, the selection and the hand-off, each as a readable `.md` for you and a `.json` for a script (`changes`, `selection`, `handoff`), plus `selection.args`. It stops at plan review. For the fast, CI-oriented variant without planning, see `/qa-kit:feature-select`.

---

Parse `$ARGUMENTS` in two steps:

### Step 1: Extract the flags

Search the whole string for these and **remove each from the string** before Step 2:

- `--base=<ref>` -> `args.baseRef`; `--head=<ref>` -> `args.headRef` (plain git refs: a local or a remote-tracking branch)
- `--since=<days>` -> `args.since` (a positive number, at most 365)
- `--repo=<org/app>` -> `args.repos`, an array: **it may be given more than once** (at most 10 repos), each value is added in order (GitHub only; needs pull requests or `--since`). Any other flag given twice: stop and say so, never keep one silently
- `--threshold=<percent>` -> `args.threshold` (1 to 100)
- `--min-confidence=<high|medium>` -> `args.minConfidence` (`high`: narrow only when the mapping file and the analysis agree; default `medium`)
- `--parallel=<number>` -> `args.maxParallel`
- `--agent-prefix=<p>` -> `args.agentPrefix` (the plugin namespace the workflow puts in front of agent names; default `qa-kit:`; `--agent-prefix=` with nothing after it means no prefix). It exists only as the remedy when a run reports "unknown agent type" - omit it otherwise
- `--fetch` -> `args.fetch: true`
- `--no-smoke` -> `args.smoke: false`
- `--no-select` -> `args.select: false`
- `--run-affected` -> `args.runAffected: true`

Omit every `args` key whose flag was not given. Give **one source only**: pull requests or ranges, `--since`, or `--base`/`--head`; if more than one is given, stop and say so.

### Step 2: Pull requests and ranges

What is left is a list, split on whitespace and commas. Each item is a pull request -> `args.prs`: a number (`456`, only when zero or one `--repo` was given), `org/app#456`, or a `https://github.com/<org>/<repo>/pull/<n>` URL. With several `--repo`, a bare number is ambiguous: stop and ask which repo it is for, or a range `base..head` -> `args.ranges`. Anything else is not a source: stop and tell the user (never guess). Nothing left is fine: your local checkout, uncommitted changes included, is compared with the default branch.

### Step 3: Build and run

Run it by calling the `Workflow` tool with `scriptPath: '${CLAUDE_PLUGIN_ROOT}/workflows/feature-diff.js'` (preferred: it loads the plugin's script directly, so no workflow-name lookup is involved; if that path cannot be read, fall back to `name: 'feature-diff'`, then `qa-kit:feature-diff`) and `args: { prs, ranges, baseRef, headRef, since, repos, minConfidence, fetch, smoke, select, runAffected, threshold, maxParallel, agentPrefix }`, with only the keys that have a value.

Report: the `gaps` (area and coverage), one line per plan (`planPath`, `testType`, `blockReason` if blocked), `planFailures`, `implementCommand`, `coverage` (`not-run` means coverage could not be checked, which is not "no gaps"), then `mode` and `fallbackReason`, `selectedFiles` of `suiteFiles`, `confidence`, `selectionFile` and `argsFile`, `affectedRun` when `--run-affected` was given, and `blockReason` if blocked. The run never commits, pushes, writes or heals a test. Tell the user to review the plans and then run the `implementCommand` - don't run it yourself in the same turn, that is a deliberate human checkpoint.
