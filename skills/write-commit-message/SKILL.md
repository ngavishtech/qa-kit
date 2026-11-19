---
name: write-commit-message
description: Analyzes current git changes and drafts a commit title and body following the project's conventions. Never stages, commits, or pushes - only writes the message to a file and outputs a ready-to-paste command. Use when asked to draft/generate/suggest a commit message.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`. If invoking another skill by its bare name (as this document does) fails, retry as `qa-kit:<name>`, or read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it directly.

# Write Commit Message

**Purpose**: Draft a commit message from the real diff - the single source of truth for message format in this kit, so `commit-and-push` and `create-pr` compose this instead of each drafting their own (independently-drifting) version.

**Only invoked explicitly** (`disable-model-invocation: true`) - by a human typing `/qa-kit:write-commit-message`, or by `commit-and-push`/`create-pr` as one of their steps. Never invoked autonomously by the agent's own judgment based on the description alone.

**Not gated the way push/PR are.** Drafting a message never touches git state, so it's not part of the push/PR pre-authorization scheme (`args.push`/`args.createPr` on `feature-implement`) at all - whenever `commit-and-push` runs (in the pipeline's Deliver step, which only runs when the invocation asked to commit, since committing to an isolated branch needs no confirmation), it derives a message this way regardless of whether push was authorized for that run.

## Workflow

### Step 1: Analyze changes

- `git status`
- Diff: `git diff --cached` if anything is staged, else `git diff`. When the project is a subfolder of a larger repo, add `-- .` to each of these so other people's changes elsewhere in the repo are not described (`${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md` -> "When the project is a subfolder of a larger repo").
- If neither shows any changes: report "No changes to generate a message for" and stop.
- `git log --oneline -10` - read the real recent history; don't assume a format without checking.

### Step 2: Derive a ticket ID, if there is one

Check the current branch name for a Jira-style ticket key (`[A-Z][A-Z0-9_]+-\d+`, e.g. `ABC-936` or `AB2-12` from `ABC-936-order-status-filter`). If found, it becomes a bracketed prefix (Step 3). If not found, there's no prefix - don't invent one.

### Step 3: Draft the message

**Project overrides**: if the repo has `.qa-kit/project/conventions.md`, its *Git -> Commit message format* (a team prefix, an allowed scope list, a different trailer policy) wins over the defaults below.

**Format**: Conventional Commits, with the ticket ID (if any) as a bracketed prefix:
```
[<TICKET-ID>] <type>(<scope>): <description>
```
or, with no ticket ID:
```
<type>(<scope>): <description>
```
- `<type>`: `feat`/`fix`/`refactor`/`docs`/`chore`/`test` - pick the one that actually matches the diff, don't default to `feat`.
- `<scope>`: the affected area (e.g. `checkout`, `api`, `ci`) - omit the parentheses entirely if there's no single clear scope.
- `<description>`: imperative mood, lowercase, no trailing period.
- **Whole title line <=72 characters, including the ticket prefix.** If it doesn't fit, shorten the description first - never drop the ticket ID or the type to make room.
- Body (optional, 1-3 sentences): explains *why*, not a restatement of the diff. Skip it for a genuinely trivial change rather than padding it out.
- **Attribution**: end the message with a blank line, then the AI co-author trailer your environment instructs for AI-authored commits (`Co-Authored-By: <name> <address>`, exactly as instructed there). If the environment specifies none, add no trailer and never invent an identity.

### Step 4: Output

Write the message to `qa-kit-artifacts/commit-message.txt` (the only file this skill writes; the folder ignores itself), then output the ready-to-paste command - never run it:
```bash
git commit -F qa-kit-artifacts/commit-message.txt
```
and show the message itself:
```
[ABC-936] feat(checkout): group order summary items by category

Show items under their parent category name so long order
summaries are readable at a glance.

Co-Authored-By: <as specified by your environment>
```
The file keeps the command identical in every shell (no heredoc or quoting rules).

## Success criteria

1. Title <=72 characters, a real Conventional Commits type, ticket prefix only when one genuinely exists on the branch
2. Body (if present) explains why, not what - the diff already shows what
3. The AI co-author trailer is present exactly as the environment instructs, or absent when it specifies none - never an invented identity
4. Never stages, commits, or pushes anything - it only writes the message file and outputs the command
