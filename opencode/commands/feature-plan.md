---
description: Plan one or more features in parallel with the qa-kit runner (read-only, writes plans to qa-kit-artifacts/ for review). Sources per feature - Jira key, Figma link, testrail:<project>/<suite>/<section>, free text. Flags - --plan <src, ...> (merge sources into one feature), --update <plan path>, <src, ...> (revise an existing plan), --parallel=N.
---

Run the qa-kit feature-plan pipeline with the Node runner. From the repository root, run this with the bash tool and wait for it to finish (it can take several minutes):

```
node "@QA_KIT_ROOT@/runner/qa-kit.mjs" feature-plan --agent opencode --args-stdin <<'QA_KIT_ARGS'
$ARGUMENTS
QA_KIT_ARGS
```

Use exactly this heredoc form, with the quoted `'QA_KIT_ARGS'` delimiter, so the shell never interprets the user's text; do not build the command line from the arguments yourself. If the shell is PowerShell (no heredoc), write the user's text unchanged to a file under `qa-kit-artifacts/` (create the folder if needed) and run the same command with `--args-file <that path>` instead of `--args-stdin` and the heredoc. Keep free text quoted exactly as the user typed it: unquoted multi-word text becomes separate items. If the arguments above are empty, run the command with an empty heredoc body. `@QA_KIT_ROOT@` is replaced when the command is installed: leave it as is.

Do not reorder the arguments or add flags.

When it exits, read `qa-kit-artifacts/latest/feature-plan.json` (the `report` array) and report, per feature: `task`, `planPath`, `testType`, whether it was updated, and `blockReason` if blocked. Exit code 2 means one or more features are blocked on a human decision: surface each `blockReason` clearly. Exit code 3 means the runner detected a safety violation: show its output verbatim and stop.

Planning is read-only. End by telling the user to review the plan files, then run `/qa-kit-feature-implement` on the approved ones.
