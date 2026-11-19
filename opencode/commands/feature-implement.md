---
description: Write, run/heal and review tests for approved plans with the qa-kit runner - one plan in the current checkout, several in parallel git worktrees. Nothing is committed unless --commit, --push or --pr is given; the feature-deliver command delivers later. Name plans by path (qa-kit-artifacts/<name>-test-plan.md) or omit to use the last feature-plan run. Flags - --commit, --push (implies --commit), --pr (implies --push), --parallel=N, --heal/--no-heal, --apply/--no-apply, --level=smoke|sanity|regression, --base=, --worktree-dir=, --install=.
---

Run the qa-kit feature-implement pipeline with the Node runner. From the repository root, run this with the bash tool and wait for it to finish (it can take a long time):

```
node "@QA_KIT_ROOT@/runner/qa-kit.mjs" feature-implement --agent opencode --args-stdin <<'QA_KIT_ARGS'
$ARGUMENTS
QA_KIT_ARGS
```

Use exactly this heredoc form, with the quoted `'QA_KIT_ARGS'` delimiter, so the shell never interprets the user's text; do not build the command line from the arguments yourself. If the shell is PowerShell (no heredoc), write the user's text unchanged to a file under `qa-kit-artifacts/` (create the folder if needed) and run the same command with `--args-file <that path>` instead of `--args-stdin` and the heredoc. Keep free text quoted exactly as the user typed it: unquoted multi-word text becomes separate items. If the arguments above are empty, run the command with an empty heredoc body. `@QA_KIT_ROOT@` is replaced when the command is installed: leave it as is.

Never add `--commit`, `--push` or `--pr` yourself: they only apply when the user typed them above. Without them nothing is committed: the tests stay uncommitted at each `worktreePath` (say so in your report) and the feature-deliver command delivers them later. With `--commit` alone every branch is committed and left unpushed.

When it exits, read `qa-kit-artifacts/latest/feature-implement.json` (the `report` array) and report, per feature: `task`, `level` (if set), `branch`, `worktreePath`, `stage`, `coverageGaps` (planned scenarios the Review stage found missing or weak, if any), `skippedPaths` (changed files Deliver left unstaged because the pipeline did not produce them, if any; with --commit), `committed`, `pushed`, `prUrl`, and `blockReason` if blocked. Exit code 2 means one or more features are blocked on a human decision: surface each `blockReason` clearly. Exit code 3 means the runner detected a safety violation: show its output verbatim and stop.
