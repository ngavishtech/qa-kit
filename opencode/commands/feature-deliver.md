---
description: Review (with a confirming re-review) and deliver branches that already have tests, using the qa-kit runner - this is how tests that feature-implement left uncommitted get committed. Always commits. With no target it uses the branches from the last feature-implement run, else the current branch. Name a target by task (ABC-1234) or branch. Flags - --push, --pr (implies --push), --parallel=N, --apply/--no-apply.
---

Run the qa-kit feature-deliver pipeline with the Node runner. From the repository root, run this with the bash tool and wait for it to finish:

```
node "@QA_KIT_ROOT@/runner/qa-kit.mjs" feature-deliver --agent opencode --args-stdin <<'QA_KIT_ARGS'
$ARGUMENTS
QA_KIT_ARGS
```

Use exactly this heredoc form, with the quoted `'QA_KIT_ARGS'` delimiter, so the shell never interprets the user's text; do not build the command line from the arguments yourself. If the shell is PowerShell (no heredoc), write the user's text unchanged to a file under `qa-kit-artifacts/` (create the folder if needed) and run the same command with `--args-file <that path>` instead of `--args-stdin` and the heredoc. Keep free text quoted exactly as the user typed it: unquoted multi-word text becomes separate items. If the arguments above are empty, run the command with an empty heredoc body. `@QA_KIT_ROOT@` is replaced when the command is installed: leave it as is.

Never add `--push` or `--pr` yourself: they only apply when the user typed them above. Without them every branch is committed and left unpushed.

When it exits, read `qa-kit-artifacts/latest/feature-deliver.json` (the `report` array) and report, per target: `task`, `branch`, `stage`, `reReviewed`, `scope`, `handChanges` (files the user changed or added by hand that went into the commit, including files modified before the implement run and files that are not tests; say so plainly), `skippedPaths` (changed files left unstaged by a staging safety rule, such as another package manager's lockfile), `committed`, `pushed`, `prUrl`, and `blockReason` if blocked. Exit code 2 means one or more targets are blocked on a human decision: surface each `blockReason` clearly. Exit code 3 means the runner detected a safety violation: show its output verbatim and stop.
