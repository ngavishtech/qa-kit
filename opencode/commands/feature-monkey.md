---
description: Monkey-test (AI-driven exploratory testing) one or more areas of the running app with the qa-kit runner. Understands each page first, explores within a time budget, removes its own data, and writes a report and a findings plan to qa-kit-artifacts/monkey/. Areas are feature tags, test folders, plan files, routes or quoted words. Flags - --minutes=N (default 5, max 30), --unit-minutes=N, --guidance="text", --read-only, --seed=N, --no-cache, --parallel=N.
---

Run the qa-kit feature-monkey pipeline with the Node runner. From the repository root, run this with the bash tool and wait for it to finish (it takes at least as long as the budget, per area):

```
node "@QA_KIT_ROOT@/runner/qa-kit.mjs" feature-monkey --agent opencode --args-stdin <<'QA_KIT_ARGS'
$ARGUMENTS
QA_KIT_ARGS
```

Use exactly this heredoc form, with the quoted `'QA_KIT_ARGS'` delimiter, so the shell never interprets the user's text; do not build the command line from the arguments yourself. If the shell is PowerShell (no heredoc), write the user's text unchanged to a file under `qa-kit-artifacts/` (create the folder if needed) and run the same command with `--args-file <that path>` instead of `--args-stdin` and the heredoc. Keep free text quoted exactly as the user typed it: unquoted multi-word text becomes separate areas. If there are no areas, the command fails with a message: tell the user to name one, never pick one.

Do not reorder the arguments or add flags. `@QA_KIT_ROOT@` is replaced when the command is installed: leave it as is.

When it exits, read `qa-kit-artifacts/latest/feature-monkey.json` (the `report` array) and report, per area: `task`, `slug`, `reportPath`, `findingsPlanPath`, `findingsSummary`, minutes used against the budget, `cleanup`, `leftBehind` and `blockReason` if blocked. If `cleanup` is anything other than `clean` or `none`, say so first and name `leftBehind`: that data may still be in the app. Exit code 2 means one or more areas are blocked: surface each `blockReason` clearly. Exit code 3 means the runner detected a safety violation (a file outside `qa-kit-artifacts/` or the `.env` file changed, or git state moved): show its output verbatim and stop.

The run never commits, pushes or opens a pull request. End by telling the user to read `monkey-report.md`, and to run `/qa-kit-feature-implement` on `findings-plan.md` to turn confirmed findings into regression tests. Parallel areas share one app and one test account and are not isolated from each other.
