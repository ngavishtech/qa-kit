---
description: 'Shortcut for the feature-implement workflow (write/execute/review, and deliver only when asked) on previously-planned, approved features - optionally naming which plan(s) by Jira key or qa-kit-artifacts/*.md filename. With no plan named, it uses the plans from the /qa-kit:feature-plan run earlier in the SAME conversation - in a new session, name the plan file (qa-kit-artifacts/<name>-test-plan.md). Nothing is committed unless --commit, --push or --pr is given; /qa-kit:feature-deliver delivers later. Flags: --commit, --push, --pr, --parallel=N, --heal/--no-heal, --apply/--no-apply, --level=smoke|sanity|regression.'
argument-hint: '(nothing committed, all approved plans)  |  qa-kit-artifacts/ABC-3702-test-plan.md (just that plan)  |  --commit  |  --push (implies --commit)  |  --pr (implies --push)  |  --parallel=2 (combine with any)  |  --no-heal (skip auto-healing)  |  --no-apply (report-only review)  |  --level=smoke (only that level''s scenarios; also sanity, regression)  |  --base=origin/main  |  --worktree-dir=../wt  |  --install="yarn install --frozen-lockfile"  |  --agent-prefix='
disable-model-invocation: true
---

**Quick reference** - what you type vs. what you get (full flag parsing below):

| You type | You get |
|---|---|
| `/qa-kit:feature-implement` | Write -> Execute (runs and heals) -> Review (reviews and applies fixes), all approved plans; **nothing is committed** - the tests stay uncommitted in your checkout (one plan) or in each plan's worktree (several). Run `/qa-kit:feature-deliver` when you want them delivered |
| `/qa-kit:feature-implement --commit` | Same, then a Deliver step commits each feature locally; nothing pushed |
| `/qa-kit:feature-implement --push` | Same, then pushes each branch once its Deliver step finishes (implies `--commit`) |
| `/qa-kit:feature-implement --pr` | Same, then opens a PR per feature (implies push and commit - no need for `--push --pr` together) |
| `/qa-kit:feature-implement --pr --parallel=2` | Same as `--pr`, capped at 2 features running concurrently instead of the default 3 |
| `/qa-kit:feature-implement --no-heal` | Execute stage only runs and classifies (invokes `execute-tests`, not `heal-tests`) - no edits made; Review/Deliver still run against whatever passed or didn't |
| `/qa-kit:feature-implement --no-apply` | Review stage only reviews and reports (invokes `review-tests`, not `apply-review-fixes`) - no edits made; a Deliver step (if asked for) still commits whatever's on the branch as-is |
| `/qa-kit:feature-implement --no-heal --no-apply` | Neither Execute nor Review edits anything - what reaches Deliver (or stays uncommitted) is exactly what `write-tests` produced |
| `/qa-kit:feature-implement --level=smoke` (with `=`, not a space) | Only the plan's `Level: Smoke` scenarios are written, run and reviewed (and committed, with `--commit` or beyond) - a quick check that the basics work before spending more. Run it again with `--level=sanity` later to add just that level; with no `--level`, every level is implemented |
| `/qa-kit:feature-implement ABC-1234` | Only the plan(s) whose `task` mentions `ABC-1234`, not every approved plan from the last `feature-plan` run |
| `/qa-kit:feature-implement qa-kit-artifacts/ABC-3702-test-plan.md` | Only the plan whose `planPath` matches that file - the handle you actually have in front of you after reviewing `qa-kit-artifacts/*.md` |

**Common mistakes**: `--pr` already implies `--push`, and `--push` already implies `--commit` - passing several isn't wrong, just redundant. Omitting all flags is deliberate and safe (nothing committed, healing on, applying on, every level); it's not a "did you forget something" state - the work is simply left for you to look at, then `/qa-kit:feature-deliver`. `--heal`/`--apply` (spelled out, matching the defaults) are accepted too, but redundant - only `--no-heal`/`--no-apply` actually change behavior.

Use the plan entries from the most recent `feature-plan` workflow run in this conversation. If `$ARGUMENTS` names specific plans, filter to just those - matched against each report entry's `task` (a Jira key or free-text fragment) **or its `planPath`** (the `.md` filename/path, exact or by basename - e.g. `ABC-3702-test-plan.md` matches `qa-kit-artifacts/ABC-3702-test-plan.md`). `planPath` is usually the more reliable handle once a feature merges several sources into one `--plan` block (its `task` becomes a long joined string like `"ABC-3702 + https://figma.com/... + ..."`, awkward to type back) - prefer naming the plan file when you have it. Otherwise use all approved plans - if none exist yet in this conversation, or a given name matches none/more than one, ask before proceeding rather than guessing. Exception: if `$ARGUMENTS` names a `qa-kit-artifacts/*.md` plan file that exists on disk but has no matching report entry (a plan from standalone `/qa-kit:plan-tests`, or a new session), build the entry yourself as `{ task: <file basename>, planPath, testType }` (read the plan's `**Test Type**` header field - `ui`/`api`/`both`; for an older plan that predates the field, derive it from the scenarios' `Type:` lines: all UI -> `ui`, all API -> `api`, a mix -> `both`) - a plan is just that file, no worktree or branch is needed up front. **Where the work happens is decided by the workflow from the plan count**: exactly one plan -> your current checkout (on a new `feature/<slug>` branch if you're on the default branch, or the feature branch you're already on); two or more -> one isolated git worktree + branch per plan.

Parse flags out of `$ARGUMENTS` (order doesn't matter, plain-text NLP, not strict CLI parsing):
- `--commit` present -> `args.commit: true`
- `--push` present -> `args.push: true` (this alone implies commit - don't also require `--commit`)
- `--pr` present -> `args.createPr: true` (this alone implies push and commit - don't also require `--push`)
- `--parallel=N` present -> `args.maxParallel: N`
- `--no-heal` present -> `args.heal: false`
- `--heal` present (and `--no-heal` isn't) -> omit `args.heal` entirely (it's already the default - don't pass `true` as noise)
- `--no-apply` present -> `args.apply: false`
- `--apply` present (and `--no-apply` isn't) -> omit `args.apply` entirely (it's already the default - don't pass `true` as noise)
- `--level=<smoke|sanity|regression>` present -> `args.level` (lowercase; exact level, not cumulative: `sanity` does not include Smoke; applies to every plan in the run; the plan's `Level:` field decides which scenarios match; a later run at another level adds only the scenarios not already implemented). Any other value -> ask, do not guess. Absent -> omit (every level)
- `--base=<ref>` present -> `args.baseRef` (ref isolated worktrees branch from; default `origin/HEAD`, which needs `git remote set-head origin -a` once in a clone where `origin/HEAD` is unset)
- `--worktree-dir=<dir>` present -> `args.worktreeDir` (default `../worktrees`, relative to the git root)
- `--install="<command>"` present -> `args.installCommand` (dependency install run inside a new worktree; default is auto-detected from the lockfile)
- `--agent-prefix=<p>` present -> `args.agentPrefix` (default `qa-kit:`; `--agent-prefix=` for none; only needed if a run reports "unknown agent type")
A value flag given twice (for example `--parallel=2 --parallel=3`) is an error: stop and say so, never keep one silently.
- None of these present -> omit them entirely (nothing committed, default concurrency, healing on, applying on, every level)

**Continuing earlier work**: when this conversation already holds a `feature-implement` report entry for the same plan (matched by `planPath`, else `task`), pass that entry's `ownedFiles` as the plan's `priorOwned` (add it to the plan object you hand over). A run without a delivery flag leaves its files uncommitted, so without `priorOwned` the next run would take them for the user's own changes. With no earlier entry, omit it.

Run it by calling the `Workflow` tool with `scriptPath: '${CLAUDE_PLUGIN_ROOT}/workflows/feature-implement.js'` (preferred: it loads the plugin's script directly, so no workflow-name lookup is involved; if that path cannot be read, fall back to `name: 'feature-implement'`, then `qa-kit:feature-implement`) and `args: { plans: [...], commit, push, createPr, maxParallel, heal, apply, baseRef, worktreeDir, installCommand, level, agentPrefix }` (only include the flags actually parsed above - don't pass `commit: false`/`push: false`/`heal: true`/`apply: true` etc. as noise).

Report the resulting per-feature status from `report[]` - `task`/`level`/`worktreePath`/`branch`/`notes`/`stage`/`coverageGaps` (planned scenarios the Review stage found missing or weak, if any)/`skippedPaths` (changed files Deliver left unstaged because the pipeline did not produce them, if any)/`committed`/`pushed`/`prUrl`/`blocked`/`blockReason` as applicable. If any feature is `blocked`, surface `blockReason` clearly rather than just noting the count. When no delivery flag was given, say so plainly: the tests are uncommitted at each `worktreePath` and `/qa-kit:feature-deliver` delivers them.
