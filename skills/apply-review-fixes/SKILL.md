---
name: apply-review-fixes
description: Applies review-tests findings as real edits (Blocking and Should-fix), runs fix-lint on what changed, then confirms with an execute-tests re-run. Reuses findings from this conversation or runs review-tests first. Use to act on review findings, or to review-and-fix your own branch or PR in one go; never someone else's PR uninvited.
argument-hint: '<PR number, branch, or "the current diff">'
allowed-tools: Bash, Read, Edit, Glob, Grep, Skill
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`. If invoking another skill by its bare name (as this document does) fails, retry as `qa-kit:<name>`, or read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it directly.

# Apply Review Fixes

**Purpose**: Turn `review-tests`' findings (or its triage of a human's PR comments) into real edits - the one place that actually changes code as a result of a review, so `review-tests` itself can stay strictly read-only.

**Only ever targets your own branch/PR** - never invoked against someone else's PR without being explicitly asked to.

---

## How this skill is invoked

- **On demand, by a human, chaining automatically**: `/qa-kit:apply-review-fixes review PR #123 and fix what you find` - if no findings for that target already exist in this conversation, this skill invokes `review-tests` itself first (Step 1), then applies what it finds. One command, no need to run `/qa-kit:review-tests` separately first.
- **On demand, reusing findings already produced**: after `/qa-kit:review-tests` has already run in this conversation (e.g. you wanted to see the findings before deciding), `/qa-kit:apply-review-fixes` reuses them rather than re-reviewing.
- **From the `test-reviewer` agent's Review step**: when self-reviewing its own pipeline branch (never someone else's PR), the agent invokes `review-tests` first, then this skill against its findings, by default - see `${CLAUDE_PLUGIN_ROOT}/agents/test-reviewer.md`. (The agent always calls both explicitly in that order; it doesn't rely on this skill's own auto-chain, but the result is the same.)
- **From `create-pr`'s self-review gate**: same shape, one level earlier - before a PR exists at all, not after. See `create-pr`'s `SKILL.md` Step 2 and `${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md`'s "PR Review SLA" note for why this is mandatory there by default.

Either way works - point it at a PR/branch/diff and it gets findings one way or the other before touching anything. There's no separate flag syntax.

---

## Workflow

### Step 1: Get the findings

If `review-tests` already produced findings for this exact target in this conversation, use those - together with any `verify-coverage` findings produced for it (same severities, same "concrete fix" shape; a missing planned scenario is Blocking and goes to Step 5, never invented here). **Otherwise, invoke `review-tests` yourself first**, against the same target you were given (PR number/branch/"current diff") - this skill never re-implements the checklist logic, but it also never blocks on the user having to run `review-tests` separately; composing it here is what makes `/qa-kit:apply-review-fixes <target>` work as a single command.

### Step 2: Apply Blocking / Should-fix findings

For each finding in those two severity buckets: apply the suggested fix via `Edit`, following the project's existing patterns (Page Objects, factories, helpers, constants) - the same fix each finding already came with. Leave **Nit**-severity findings alone unless asked to include them too.

A **pattern finding** (one rule with an occurrence list - see `review-tests` Step 5) is applied to *every* listed occurrence in this pass, then re-grep the changed files for the same smell before moving on; fixing only the first instance is exactly what forces a reviewer to comment on each remaining one.

### Step 3: Lint

Only if Step 2 actually changed a file: invoke `fix-lint` scoped to exactly those files (skip entirely if nothing needed fixing - re-running it after a no-op review is pure redundancy).

### Step 4: Confirm nothing broke

Re-run the affected test(s) via `execute-tests` (report-only - a review fix breaking a test is a signal to reconsider the fix, not something to heal around). If a test newly fails because of a fix applied here, say so explicitly rather than reporting the review clean.

### Step 5: Hand off what it can't do

A finding that needs a genuinely new file (not an edit to one that already exists - a missing Page Object, a new fixture, a new spec) is `write-tests` territory: standalone, tell the user what's missing; inside `feature-implement`, return a blocked result instead of skipping the finding silently or forcing an in-place hack.

### Step 6: Report

Summarize what changed (file:line per fix), whether lint is clean, whether the confirming re-run passed, and which findings (if any) still need a human decision or `write-tests`.

---

## Quality Criteria

1. Only ever acts on findings that already exist - never re-derives its own opinion of what's wrong
2. Never touches a PR/branch that isn't the one being actively worked on
3. A fix always fits the project's existing patterns, since it's just applying what `review-tests` already specified

---

**Note**: This skill only acts on findings. Use `review-tests` to produce them, and `execute-tests`/`heal-tests` if a confirming re-run itself needs fixing beyond what a review implies.
