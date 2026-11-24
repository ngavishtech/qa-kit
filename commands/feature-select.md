---
description: 'Shortcut for the feature-select workflow - read-only: looks at a set of changes (your local checkout against another branch, local or remote, the last N days, pull requests, or pull requests of a separate GitHub app repo), works out which areas and existing tests they affect and writes the narrowest safe test selection to qa-kit-artifacts/changes/ (selection.json and selection.args). Falls back to the full suite when unsure. With --plan it also plans every coverage gap. Flags: --base=<ref>, --head=<ref>, --since=<days>, --repo=<org/app> (repeatable), --min-confidence=high, --fetch, --no-smoke, --threshold=<percent>, --plan, --parallel=N. Never commits, writes or runs a test.'
argument-hint: '(nothing = this branch vs the default branch)  |  123, 130  |  --base=origin/main  |  --since=7  |  --repo=org/app 456  |  --repo=org/a --repo=org/b --since=7  |  --plan  |  --no-smoke  |  --threshold=40  |  --min-confidence=high  |  --fetch  |  --parallel=2  |  --agent-prefix= (only if "unknown agent type")'
disable-model-invocation: true
---

**Quick reference** - what you type vs. what you get (full parsing rules below):

| You type | You get |
|---|---|
| `/qa-kit:feature-select` | Your local checkout (committed, staged, unstaged and new files) compared with the default branch: which tests to run |
| `/qa-kit:feature-select --base=origin/release-5 --fetch` | Against a remote branch (fetches that one branch if it is not available locally) |
| `/qa-kit:feature-select 123, 130` | The changes of pull requests 123 and 130 |
| `/qa-kit:feature-select --since=7` | The commits of the last 7 days |
| `/qa-kit:feature-select --repo=org/app 456` | Pull request 456 of a separate GitHub app repo; the tests stay the ones in this repo |
| `/qa-kit:feature-select org/orders#456, org/billing#12` | Pull requests of several repos, analysed as one change set (a product that spans several services) |
| `/qa-kit:feature-select --repo=org/orders --repo=org/billing --since=7` | The last 7 days of merged pull requests of both repos |
| `/qa-kit:feature-select --plan` | Also plans every coverage gap (plans to review, then `/qa-kit:feature-implement`) |
| `/qa-kit:feature-select --no-smoke --threshold=40` | No added smoke specs; the full suite when more than 40% of the spec files are selected |

It writes under `qa-kit-artifacts/changes/` the analysis, the selection and the hand-off, each as a readable `.md` for you and a `.json` for a script (`changes`, `selection`, `handoff`), plus `selection.args`. For one step without the pipeline see `/qa-kit:analyze-changes` and `/qa-kit:select-tests`; for coverage gaps first, `/qa-kit:feature-diff`.

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
- `--plan` -> `args.planGaps: true`

Omit every `args` key whose flag was not given. Give **one source only**: pull requests or ranges, `--since`, or `--base`/`--head`; if more than one is given, stop and say so.

### Step 2: Pull requests and ranges

What is left is a list, split on whitespace and commas. Each item is a pull request -> `args.prs`: a number (`456`, only when zero or one `--repo` was given), `org/app#456`, or a `https://github.com/<org>/<repo>/pull/<n>` URL. With several `--repo`, a bare number is ambiguous: stop and ask which repo it is for, or a range `base..head` -> `args.ranges`. Anything else is not a source: stop and tell the user (never guess). Nothing left is fine: your local checkout, uncommitted changes included, is compared with the default branch.

### Step 3: Build and run

Run it by calling the `Workflow` tool with `scriptPath: '${CLAUDE_PLUGIN_ROOT}/workflows/feature-select.js'` (preferred: it loads the plugin's script directly, so no workflow-name lookup is involved; if that path cannot be read, fall back to `name: 'feature-select'`, then `qa-kit:feature-select`) and `args: { prs, ranges, baseRef, headRef, since, repos, minConfidence, fetch, smoke, threshold, planGaps, maxParallel, agentPrefix }`, with only the keys that have a value.

Report: `mode` (narrowed, full or none) and `fallbackReason`, `selectedFiles` of `suiteFiles`, `confidence`, `selectionFile` and `argsFile`, the command to run (`npx playwright test` followed by the contents of `selection.args`; for `full` the whole suite, for `none` nothing), `coverage` (`run` or `not-run`), `gaps`, `plans`, `planFailures` and `implementCommand` when `--plan` was given, and `blockReason` if blocked. A blocked run means: run the full suite. `mode: none` with `no-changes` means no file changed and there is no scope to run: say "no scope identified" and run nothing. The selection is decided by a tested script, not by the model, and re-checked by code after the run. The run never commits, pushes, writes or runs a test. If plans were written, tell the user to review them and then run the `implementCommand` - don't run it yourself in the same turn, that is a deliberate human checkpoint.
