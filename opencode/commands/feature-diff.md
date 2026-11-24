---
description: Read-only, starts from the code that changed (not from a ticket like feature-plan) - look at a set of changes (this branch against another branch, local or remote, the last N days, pull requests, or pull requests of a separate GitHub app repo), cross them with the existing tests, mark every affected area covered, partial or none, and write one reviewable plan per coverage gap plus the execution scope for the affected existing tests. Stops at plan review. Items are pull request numbers or base..head ranges. Flags - --min-confidence=high|medium, --base=REF, --head=REF, --since=DAYS, --repo=ORG/APP (repeatable), --fetch, --no-select, --run-affected, --no-smoke, --threshold=PERCENT, --parallel=N.
---

Run the qa-kit feature-diff pipeline with the Node runner. From the repository root, run this with the bash tool and wait for it to finish:

```
node "@QA_KIT_ROOT@/runner/qa-kit.mjs" feature-diff --agent opencode --args-stdin <<'QA_KIT_ARGS'
$ARGUMENTS
QA_KIT_ARGS
```

Use exactly this heredoc form, with the quoted `'QA_KIT_ARGS'` delimiter, so the shell never interprets the user's text; do not build the command line from the arguments yourself. If the shell is PowerShell (no heredoc), write the user's text unchanged to a file under `qa-kit-artifacts/` (create the folder if needed) and run the same command with `--args-file <that path>` instead of `--args-stdin` and the heredoc. No items is fine: the current branch is compared with the default branch. Give one source only: pull requests or ranges, `--since`, or `--base`/`--head`.

Do not reorder the arguments or add flags. `@QA_KIT_ROOT@` is replaced when the command is installed: leave it as is.

Exit code 1 means the arguments were invalid: show the printed message and stop, and do not read any earlier report (there is no new one). Otherwise, when it exits, read `qa-kit-artifacts/latest/feature-diff.json` (the `report` array) and report: the `gaps` (area and coverage), one line per plan (`planPath`, `testType`, `blockReason` if blocked), `implementCommand`, then `mode` and `fallbackReason`, `selectedFiles` of `suiteFiles`, `confidence`, `selectionFile` and `argsFile`, `affectedRun` when `--run-affected` was given, and `blockReason` if blocked. Exit code 2 means the run is blocked: surface each `blockReason`. Exit code 3 means the runner detected a safety violation (a file outside `qa-kit-artifacts/` changed, or git state moved): show its output verbatim and stop.

The run never commits, pushes, writes or heals a test. End by telling the user to review the plans and then run `/qa-kit-feature-implement` on them; do not run it yourself, that is a deliberate human checkpoint.
