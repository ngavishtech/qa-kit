---
name: commit-and-push
description: Stages the specific changed files, commits with a drafted or provided message, and pushes to the current branch's upstream. Confirms before pushing unless explicitly pre-authorized (a feature-implement run that was told to push). Use when asked to commit and push.
disable-model-invocation: true
argument-hint: '[optional commit message]'
allowed-tools: Bash, Read, Grep, Skill
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`. If invoking another skill by its bare name (as this document does) fails, retry as `qa-kit:<name>`, or read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it directly.

# Commit and Push

**Purpose**: Turn a drafted message into a real commit and push, safely - composes `write-commit-message` rather than re-deriving the message itself, and `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md` rather than re-deriving the safety/staging/push rules.

**Only invoked explicitly** (`disable-model-invocation: true`) - by a human typing `/qa-kit:commit-and-push`, by `create-pr` as an early step, or by `agent-deliverer`'s Deliver step inside the `feature-implement` workflow (only when that run was told to commit) or the `feature-deliver` workflow.

## Workflow

### Step 1: Safety scan

Per `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md`: run the secrets scan first, before touching branches or staging anything - stop and warn if anything's found. (When the project is a subfolder of a larger repo, scan and list only the project folder - `-- .` - as that file's "When the project is a subfolder of a larger repo" section says, and never stage `qa-kit-artifacts/`.) Also apply its "Lockfile hygiene" check: a lockfile from a package manager other than the repo's, or a change to the repo's own lockfile without a matching `package.json` change, is a stop-and-warn, same as a secret (worked examples for `yarn.lock` and `package-lock.json` are in that file).

### Step 2: Branch check

If the current branch is the default branch (detect it live per `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md` -> "Detecting the real default/base branch"; never assume a name): create and switch to a new feature branch (`git checkout -b <name>`) - don't stop to ask, this is safe/cheap to undo. Derive `<name>` per `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md` (an explicit ticket ID if one was mentioned in the request, otherwise `<type>/<slug>` from the change itself), unless `.qa-kit/project/conventions.md` -> *Git -> Branch naming* prescribes a pattern - then use that. If already on a feature branch, just continue on it - don't create another one.

### Step 3: Get a message

- If a message was given directly in the request, use it as-is.
- Otherwise, invoke `write-commit-message` (user-invocation-only: if the Skill tool refuses it, read `${CLAUDE_PLUGIN_ROOT}/skills/write-commit-message/SKILL.md` and follow it directly) and use what it drafts - now that Step 2 has settled the branch, its ticket-ID-from-branch-name detection works correctly whether this is a pre-existing feature branch or one just created in Step 2.
- If `write-commit-message` reports no changes, stop here and say so.

### Step 4: Stage specific files

List the actual changed files (`git status --porcelain` / `git diff --name-only`) and `git add` them by name (in a subfolder project, use root-anchored pathspecs and limit the listing to the project folder: see "When the project is a subfolder of a larger repo" in `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md`). **If the caller gave an exclusion list** (paths that were already modified before the run started and belong to the user), never stage those; if this run's own work also edited one of them, stop and report the path instead of committing a mixed change. **If the caller says the request is to deliver everything the person has changed** (the `feature-deliver` workflow), stage every change `git status --porcelain` shows in the project folder (modified, deleted, renamed and staged files, and new files that are not ignored) by name, whether or not this run produced it and whether or not it is a test file, and report the paths it did not produce back to the caller; the secrets scan and the lockfile rule in `git-safety.md` still apply in full. Never `git add -A`/`git add .` - see `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md`.

### Step 5: Commit

Write the message (drafted or provided) to `qa-kit-artifacts/commit-message.txt` and run `git commit -F qa-kit-artifacts/commit-message.txt` (see `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md` -> "Commit messages and PR bodies: use a file"). For a provided message, still add the attribution trailer per `write-commit-message`'s attribution rule (as the environment instructs, else none). If the commit fails because of a hook, report the failure - don't `--no-verify`.

### Step 6: Decide whether to push

- **Interactive use** (a human typed `/qa-kit:commit-and-push` or asked for this directly): show the commit that was just made (hash + message) and the branch, and ask "push to origin/`<branch>`? (y/n)" - only push on an explicit yes.
- **Pre-authorized use** (invoked by `agent-reviewer` inside `feature-implement`): skip the interactive confirmation *only* if your instructions say push was already authorized for this run - that happens when the human who launched the pipeline explicitly asked for the branches to be pushed (or asked for a PR, which implies push), decided once up front, not per-feature. If your instructions don't say that, commit only and do not push, even though this is an isolated branch - say so clearly in your report (the human can push manually from the worktree, or re-run with push explicitly requested). This is the real confirmation gate for pipeline use: an unattended run cannot be interactively asked mid-run, so the default without explicit authorization is "commit, don't push."

### Step 7: Push (per Step 6) and report

Per `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md`'s upstream-aware push: if an upstream already exists, `git pull --ff-only` first (catches the remote having moved ahead without merging/rebasing - if it fails, that's a real conflict, report it and stop), then push; if no upstream yet, `git push -u origin HEAD`. If the push is rejected, report the exact error and stop - don't auto-rebase-and-retry. Report the real commit hash, branch name, and whether the push happened (or, if Step 6 decided not to push, say so explicitly rather than silently skipping it).

## Success criteria

1. Never stages more than the files actually related to this change, unless the caller explicitly asked to deliver everything the person has changed (then: every change git shows, by name, and nothing git ignores)
2. Never commits on the default branch - always on a feature branch, created automatically if needed
3. Never pushes without either an explicit human "yes" or a genuine pre-authorization already present in the calling instructions
4. Pulls (`--ff-only`) before pushing when there's an existing upstream; a rejected or diverged push is reported, never auto-resolved
5. Reports the real commit hash and branch, not a guess
