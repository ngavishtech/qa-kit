---
name: create-pr
description: Runs a mandatory self-review gate (review-tests + apply-review-fixes against your own branch), then commits and pushes (via commit-and-push), then opens a pull request against the project's real default branch. Confirms before both the push and the PR creation unless explicitly pre-authorized (a feature-implement run that was told to create PRs). Use when asked to open/create a PR.
disable-model-invocation: true
argument-hint: '[optional commit message] [optional PR title]'
allowed-tools: Bash, Read, Grep, Skill
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`. If invoking another skill by its bare name (as this document does) fails, retry as `qa-kit:<name>`, or read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it directly.

# Create Pull Request

**Purpose**: Compose `review-tests`+`apply-review-fixes` for the self-review gate and `commit-and-push` for commit/push logic rather than re-deriving either, and `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md` for base-branch detection - then add only the PR-specific steps (gate, draft, `gh pr create`).

**By default, a human-triggered step** - not something the agent decides to run on its own (`disable-model-invocation: true`). It **can** run inside the `feature-implement` workflow, but *only* when that pipeline run was explicitly told to create PRs for this run (the same shape as `commit-and-push`'s push pre-authorization, one level up) - never as a default, and PR creation always implies push is authorized too (you can't PR a branch that isn't pushed). See `${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md` §7.

## Workflow

### Step 1: Detect the real base branch

Use the detection rule in `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md` -> "Detecting the real default/base branch" - live, every time, never a hardcoded name. Needed now, not just at PR-creation time, because Step 2's self-review diffs against it.

### Step 2: Self-review gate (mandatory - this is what keeps TL review fast)

Invoke `apply-review-fixes` against the diff from that base branch to the current working tree (uncommitted changes included - everything going into this PR, not just what's already committed). Per its own Step 1, `apply-review-fixes` invokes `review-tests` itself only if findings for this target don't already exist in this conversation. Inside the pipeline, Review and Deliver are separate agent calls with separate contexts, so Deliver does not see the Review stage's findings and runs its own `review-tests` pass (normally clean, since the branch was just fixed). Standalone, it's the first and only review this branch gets before a human sees it.

This is the single highest-leverage step in this whole skill: every mechanical/convention issue (hardcoded values, excessive comments, missing enum, title-text branching, etc. - see `review-tests`'s R1-R14) gets caught and fixed here, before a human ever spends review time on it. A PR that skips this gate pushes that same catching work onto the TL instead, which is exactly what blows up review rounds and PR lifecycle.

**Scope of the gate**: when the caller names the paths to deliver (the pipeline passes the run's `ownedFiles`, and from `feature-deliver` also the person's own test edits), review and fix only those paths, and never a path the caller lists as belonging to the user. Without a list (standalone use), the gate covers the whole diff as above.

- If `apply-review-fixes` resolves everything down to Nit-level findings (or finds nothing): continue to Step 3. In interactive use its edits (if any) ride along with whatever `commit-and-push` commits next - no separate commit needed for them.
- If a Blocking/Should-fix finding can't be auto-resolved (e.g. it needs a genuinely new file - `write-tests` territory): stop and tell the human what's still open, and let them decide whether to fix it first or explicitly proceed anyway. Don't silently open the PR with known Blocking findings still in it.
- **When the caller has no edit tool** (the `test-deliverer` agent, inside the pipeline): the gate cannot apply fixes. If it finds anything Blocking or Should-fix, stop, return blocked with the findings, and point at `/qa-kit:feature-deliver`, whose Review step applies fixes before delivering again. Commit nothing and open no PR in that case.
- Only skip this gate entirely when the human explicitly says to (e.g. "open the PR as-is, skip self-review") - note that explicitly in the final report so it's clear the PR wasn't gated.

### Step 3: Commit and push

Invoke `commit-and-push` (it is user-invocation-only, so the Skill tool may refuse it - if so, read `${CLAUDE_PLUGIN_ROOT}/skills/commit-and-push/SKILL.md` and follow it directly):
- **Interactive use** (a human asked for this directly): its normal interactive mode - confirm before it pushes.
- **Pre-authorized use** (invoked by the `test-deliverer` agent inside `feature-implement`, only when that run was explicitly told to create PRs): tell `commit-and-push` that push is pre-authorized too, so it doesn't ask - PR creation already implies the human wants this branch pushed.

### Step 4: Draft the PR

- **Title**: the provided PR title argument, or derived from the commit message if none was given.
- **Body**: a short summary of the actual diff (not the commit message restated), a "Test plan" checklist, a mandatory "Self-review" line stating whether `review-tests` + `apply-review-fixes` ran and the real counts (e.g. "Self-review: `review-tests` run, 7 findings fixed, 0 Blocking/Should-fix open", or "Self-review: skipped by request" if it was) so the TL can see at a glance whether the gate ran, without asking. End the body with the PR-description attribution line your environment instructs for AI-authored work, exactly as instructed; if it specifies none, add none and never invent one.
- **Interactive use**: show the user the drafted title/body and ask for confirmation before running `gh pr create`.
- **Pre-authorized use**: skip this confirmation too - explicitly requesting PR creation for the pipeline run already covers it - but still report the drafted title/body in your final report so it's reviewable after the fact.

### Step 5: Create the PR

Write the body to `qa-kit-artifacts/pr-body.md` (the folder ignores itself), then run:

```bash
gh pr create --base <detected-default-branch> --title "<title>" --body-file qa-kit-artifacts/pr-body.md
```

See `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md` -> "Commit messages and PR bodies: use a file". When the project is a subfolder of a larger repo, also follow its "When the project is a subfolder of a larger repo" section (look only at the project folder, stage with root-anchored paths) and never stage `qa-kit-artifacts/`.

### Step 6: Report

Print the PR URL clearly. If creation fails, print the exact error - don't guess at a fix.

## Success criteria

1. Never pushes or opens a PR without either an explicit human "yes" or a genuine pre-authorization already present in the calling instructions
2. Base branch is detected live, never hardcoded
3. Inside a pipeline, only ever runs when that specific run was explicitly told to create PRs - never a silent default
4. Never opens a PR with a known, unresolved Blocking finding still open unless the human explicitly chose to proceed anyway - the self-review gate exists so the TL's first look is the only look needed
