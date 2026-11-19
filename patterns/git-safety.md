# Git Safety Patterns

Shared rules consulted by `write-commit-message`, `commit-and-push`, and `create-pr` - stated once here instead of duplicated across all three.

## Secrets scan

Before staging anything, check `git status`/`git diff` output for `.env` files, `*.pem`/`*.key` files, or obvious inline credentials (API keys, tokens, passwords in the diff body). **If found: stop immediately and warn the user - do not stage, commit, or push.** Not a lint warning to note and continue past.

## Lockfile hygiene

A repo has exactly one package manager, and so one lockfile: the one `.qa-kit/project/conventions.md` declares, otherwise whichever of `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` is already tracked (`git ls-files`). **Never stage or commit a lockfile of a different manager** - a second lockfile next to the real one creates dependency-resolution conflicts. If one shows up in `git status` (usually from running the wrong manager's install), stop and warn the user rather than staging it; leave deletion of an untracked one to the user. Also flag a change to the repo's own lockfile with no matching `package.json` change - that is unexplained dependency churn, not something to commit silently. A lockfile change that accompanies a `package.json` dependency change is normal. `review-tests` R12 enforces the same check on a PR diff.

The two lockfiles most common in the org today, as worked examples (any other manager's lockfile, e.g. `pnpm-lock.yaml`, is handled by the same rule):

| Repo's manager (its tracked lockfile) | Allowed in a commit | Stop and warn |
|---|---|---|
| **yarn** (`yarn.lock`) | `yarn.lock` changed together with `package.json` | any `package-lock.json` (typically from a stray `npm install`); `yarn.lock` changed with no `package.json` change |
| **npm** (`package-lock.json`) | `package-lock.json` changed together with `package.json` | any `yarn.lock` (typically from a stray `yarn install`); `package-lock.json` changed with no `package.json` change |

If the repo tracks neither yet, and `conventions.md` does not name a manager, ask which one it uses instead of guessing; do not stage either lockfile until that is answered.

## When the project is a subfolder of a larger repo

qa-kit can be installed in a subfolder (the folder that holds `.qa-kit/`), so the git root is a parent of the folder you work in and the rest of the repo belongs to other people. Everything above still applies; in addition:

- **Name paths from the git root.** `git status --porcelain` and `git diff --name-only` print paths relative to the **git root**, but `git add <path>` resolves a relative path against the **current folder**, so from a subfolder it points at the wrong place. Stage with a root-anchored pathspec, which works from any folder: `git add -- ':/<path>'` (quote it for your shell). Exclusion lists (files modified before the run started) are root-relative too, so compare them with other root-relative paths and never with `--relative` output.
- **Look only at the project folder.** Read status and diffs with a trailing `-- .` (`git status --porcelain -- .`, `git diff -- .`) so a Developer's edits elsewhere in the repo do not show up in a commit message, a secrets scan or a staging list. A file outside the project folder is not this run's work: do not stage it, and name it in the report.
- **The lockfile that counts is the project folder's** (next to the `package.json` the tests use). A lockfile or `package.json` at the git root belongs to the application: do not stage it, and warn if this run changed it.

## Never...

- **Never stage anything under `qa-kit-artifacts/`**, whether or not git currently shows it. The folder ignores itself only when its own `.gitignore` (containing `*`) or the repo's ignore line is present; that inner file is never committed, so a fresh clone, or a run started in a folder qa-kit was not set up in, can show `?? qa-kit-artifacts/`. Plans, commit messages and PR bodies are working files, not part of any commit. Before a skill writes into the folder, it creates `qa-kit-artifacts/.gitignore` containing `*` if that file is missing.
- **Never `git add -A` or `git add .`.** Stage specific files by name, derived from `git status --porcelain`/`git diff --name-only` - see the repo's own git norms. A blanket add can silently pick up `.env`, credentials, or a large binary the secrets scan above didn't anticipate.
- **Never force-push** (`--force`, `-f`, `--force-with-lease`, `+<ref>` refspecs), not even on request: it can overwrite someone else's work. If the user wants one, they run it themselves.
- **Never `git commit --no-verify` or `git push --no-verify`.** If a pre-commit/pre-push hook fails, report the failure and let the user decide - don't bypass it.
- **Never commit directly on the default branch** (detected live, see "Detecting the real default/base branch"). If the current branch is the default branch, create and switch to a new feature branch first (`git checkout -b <name>`) rather than stopping to ask - creating a *local* branch is safe and cheap to undo, so it doesn't need confirmation the way push/PR do. Derive `<name>` from an explicit ticket ID if one was mentioned in the request (`<TICKET-ID>-<slug>`), otherwise from the change itself (`<type>/<slug>`, matching the commit's own Conventional Commits type) - never leave it generic like `patch` or `update`.
- **Never auto-rebase or auto-retry a rejected push.** If `git push` is rejected (e.g. non-fast-forward), report the exact error and stop - don't run `git pull --rebase` or anything else that rewrites history without being asked. Unprompted history-rewriting recovery is exactly the kind of automation that's easy to regret. (This is about *reacting* to a rejection - see the proactive pull below, which is different: it avoids the rejection in the first place without rewriting anything.)

## Upstream-aware push

```bash
git rev-parse --abbrev-ref --symbolic-full-name "@{u}"
```
If that fails with an error (no upstream yet - first push of this branch), use `git push -u origin HEAD`, nothing to pull first. If it succeeds (upstream exists - e.g. a prior run already pushed this branch), **pull before pushing**: `git pull --ff-only`, then `git push`. `--ff-only` catches a genuinely diverged remote (something else moved it) without silently merging or rebasing - if it fails, that's a real conflict: report it and stop, same as a rejected push, don't force through it.

## Detecting the real default/base branch

Never hardcode `main`/`master`/`develop`. Ask the remote, live, every time, and use the first form that works:

1. `git remote show origin` and read its `HEAD branch:` line (queries the remote, so it is current).
2. `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` if the GitHub CLI is authenticated.
3. `git symbolic-ref --short refs/remotes/origin/HEAD` (local record, prints `origin/<branch>`; drop the `origin/` prefix).
4. Last resort: whichever of `main` / `master` exists (`git rev-parse --verify --quiet refs/remotes/origin/main`).

Don't cache the result across runs; re-derive it each time in case it changed. `commit-and-push` (branch check) and `create-pr` (base branch) both use this one rule.

## Commit messages and PR bodies: use a file

Heredocs and `$(...)` differ between Git Bash, PowerShell and cmd, so never build a multi-line message inline. Write the message to a file under `qa-kit-artifacts/` (the folder ignores itself, so the file never gets staged), then pass the file:

| Need | File | Command |
|---|---|---|
| Commit | `qa-kit-artifacts/commit-message.txt` | `git commit -F qa-kit-artifacts/commit-message.txt` |
| Pull request | `qa-kit-artifacts/pr-body.md` | `gh pr create --base <branch> --title "<title>" --body-file qa-kit-artifacts/pr-body.md` |

Overwrite the file each time. Attribution (a co-author trailer or a PR-description line) goes in the file only as the running environment instructs; if it specifies none, add none.
