---
description: 'Shortcut for the feature-deliver workflow (review with a confirming re-review, then deliver) on branches that already have tests written - the standalone delivery step for tests that /qa-kit:feature-implement left uncommitted (its default), branches left mid-pipeline (--no-apply findings unresolved, committed-but-unpushed) or any branch that''s just ready to ship. It always commits - running it is the request to deliver. With no target named, it uses the branches reported earlier in the SAME conversation; in a new session it works on the branch you are currently on. Flags: --push, --pr (implies --push), --parallel=N, --apply/--no-apply.'
argument-hint: '(commits locally, all prior targets or current branch)  |  ABC-3702 (by task)  |  feature/0-abc-3702 (by branch)  |  --push  |  --pr (implies --push)  |  --parallel=2  |  --no-apply (report-only review)  |  --agent-prefix='
disable-model-invocation: true
---

**Quick reference** - what you type vs. what you get (full flag parsing below):

| You type | You get |
|---|---|
| `/qa-kit:feature-deliver` | Review (reviews, applies fixes, confirming re-review if anything changed) -> Deliver, all targets resolved per the order below; commits locally, nothing pushed. This is how you deliver what `/qa-kit:feature-implement` left uncommitted, **plus every file you changed or added by hand** (reported as `handChanges`), whether or not it is a test file |
| `/qa-kit:feature-deliver --push` | Same, then pushes each branch once its Deliver step finishes |
| `/qa-kit:feature-deliver --pr` | Same, then opens a PR per target (implies push - no need for `--push --pr` together) |
| `/qa-kit:feature-deliver --pr --parallel=2` | Same as `--pr`, capped at 2 targets running concurrently instead of the default 3 |
| `/qa-kit:feature-deliver --no-apply` | Review stage only reviews and reports (invokes `review-tests`, not `apply-review-fixes`) - no edits made, no re-review (nothing to confirm); Deliver still commits whatever's on the branch as-is |
| `/qa-kit:feature-deliver ABC-1234` | Only the target(s) whose `task` mentions `ABC-1234` |
| `/qa-kit:feature-deliver feature/0-abc-3702` | Only the target whose `branch` matches that name |

**Common mistakes**: `--pr` already implies `--push` - passing both isn't wrong, just redundant. Omitting all flags is deliberate and safe (commits locally, applying on); it's not a "did you forget something" state. `--commit` and `--apply` (spelled out, matching the defaults) are accepted too, but redundant - this command always commits, and only `--no-apply` actually changes review behavior. There is no `--heal`/`--no-heal` here - this workflow has no Execute stage, nothing to heal.

Resolve `args.targets` in this order:
1. If `$ARGUMENTS` names a specific target, match it against any prior `feature-plan`/`feature-implement` report entry already visible in this conversation, by `task` **or** `branch` (same matching rule as `${CLAUDE_PLUGIN_ROOT}/commands/feature-implement.md`'s plan-selection, extended to also match on `branch`).
2. If none named, use every such report entry found in this conversation.

For every target taken from a `feature-implement` report entry, also pass its `ownedFiles` (every path the pipeline produced; Review and Deliver start from these) and its `baselineChanges` (the paths that were already modified before that run started - found in the `history` entry whose `stage` is `write`) so Deliver never stages them. A target from the current-checkout fallback has neither: Deliver then takes the outstanding test changes and the report says "no recorded run".

**Everything you changed is delivered.** `feature-deliver` commits every change git shows in the project folder: modified, deleted, renamed and staged files, and new files that are not ignored. That includes the pipeline's own files, anything you changed or added by hand after the implement run to close a gap, a file you had already modified before the implement run, and files that are not tests. Only git's own ignore list and the staging safety rules leave anything out (a secret file stops the target, another package manager's lockfile is skipped and reported). Whatever it stages beyond the pipeline's files is listed as `handChanges` and named in the commit message. Say so plainly in your report so the person knows exactly what went into the commit.
3. If the conversation has no `feature-plan`/`feature-implement` report entries at all (fresh session, manual/standalone use): fall back to a single implicit target - run `git branch --show-current` for `branch`, and use the current working directory for `worktreePath`. Same spirit as `/qa-kit:create-pr` working on "whatever's currently changed in your checkout."

If a named target matches none, or more than one, ask before proceeding rather than guessing.

Parse flags out of `$ARGUMENTS` (order doesn't matter, plain-text NLP, not strict CLI parsing):
- `--commit` present -> omit it (this workflow always commits; don't pass `true` as noise)
- `--push` present -> `args.push: true`
- `--pr` present -> `args.createPr: true` (this alone implies push - don't also require `--push`)
- `--parallel=N` present -> `args.maxParallel: N`
- `--agent-prefix=<p>` present -> `args.agentPrefix` (default `qa-kit:`; `--agent-prefix=` for none; only needed if a run reports "unknown agent type")
- `--no-apply` present -> `args.apply: false`
- `--apply` present (and `--no-apply` isn't) -> omit `args.apply` entirely (it's already the default - don't pass `true` as noise)
A value flag given twice (for example `--parallel=2 --parallel=3`) is an error: stop and say so, never keep one silently.
- None of these present -> omit them entirely (commits locally, default concurrency, applying on)

Run it by calling the `Workflow` tool with `scriptPath: '${CLAUDE_PLUGIN_ROOT}/workflows/feature-deliver.js'` (preferred: it loads the plugin's script directly, so no workflow-name lookup is involved; if that path cannot be read, fall back to `name: 'feature-deliver'`, then `qa-kit:feature-deliver`) and `args: { targets: [...], push, createPr, maxParallel, apply, agentPrefix }` (only include the flags actually parsed above - don't pass `push: false`/`apply: true` etc. as noise).

Report the resulting per-target status from `report[]` - `task`/`branch`/`stage`/`reReviewed`/`scope`/`handChanges` (files you changed by hand that went into the commit)/`skippedPaths` (left unstaged by a staging safety rule, such as another package manager's lockfile)/`committed`/`pushed`/`prUrl`/`blocked`/`blockReason` as applicable. If any target is `blocked`, surface `blockReason` clearly rather than just noting the count.
