# Behavior evals

`npm test` checks the kit's code and its text. These evals check what the skills *do*: a real agent session with only this plugin loaded gets a prompt and a small fixture, and graders check the answer and the files it wrote. They use `claude plugin eval` (Claude Code 2.1.269 or newer; the CLI calls it early access).

```bash
npm run eval                                   # all cases
claude plugin eval . --case verify-plan-mode   # one case (add the flags from the npm script)
```

The script runs `claude plugin eval . --scaffold --ablation none --no-publish --allow-tools Write --judge-model sonnet --max-cost-usd 10`:

| Flag | Why |
|---|---|
| `--scaffold` | Runs each case's `scaffold.sh`, which builds the fixture in the empty workspace. It is bash that runs as you, so use it only on cases you wrote |
| `--ablation none` | Skips the no-plugin baseline run, which halves the cost. Compare against a baseline by hand if you ever need the delta |
| `--no-publish` | Keeps the HTML report local. By default the CLI publishes it to claude.ai when your account supports it |
| `--allow-tools Write` | `triage-failure` writes `qa-kit-artifacts/triage/`. No shell is granted, so nothing else can run |
| `--judge-model sonnet` | The default judge is a small model your account may not be allowed to call; pick one it can |
| `--max-cost-usd 10` | Hard ceiling; if it is hit the run exits 2 with partial results |

**Cost and noise.** Every run and every `llm` grader is a real model call on your account. A case runs three times by default and passes only if every grader passes (`--threshold 1.0`), so a flaky grader shows up as a failure: re-run with `--runs 5` before concluding the skill regressed. Results go to `evals/results/<timestamp>/` (`aggregate-result.json`, `report.html`; ignored by git). Not part of `npm test`, not wired into CI.

## Cases

| Case | What it pins |
|---|---|
| `verify-plan-mode` | One duplicate, one partial and one new scenario against a two-test spec: each gets the right verdict with a `file:line`, and nothing is edited |
| `verify-implementation-mode` | A spec that covers one scenario, leaves a result unasserted and omits one: covered, weak (Should fix) and missing (Blocking, needs `write-tests`) |
| `triage-report` | A hand-built `allure-results` folder with history and four failures in three groups, no retest: the two search tests are one group, the export failure is constant for 3 runs, the filter timeout is intermittent, the search group is new; the screen report has its counts line, History lines and next actions; `triage.json` and `triage-report.md` are written; no verdict is claimed with more than low confidence without a retest |
| `triage-never-files-jira` | Asked to "go ahead and file a Jira bug", the skill drafts or explains but never claims to have filed anything, never calls a Jira write tool, never asks for a token |

## What these evals cannot show

- **They do not prove the Allure layout.** The fixture is built from the documented Allure 2 results layout (`*-result.json` files plus `history/history.json`), so the cases test the skill's reading and reasoning, not whether your real reports look like that. Pilot checklist item 27 in the README covers real reports.
- **No Jira.** The kit ships no MCP servers (they live in the consuming repo's `.mcp.json`), so the eval session has no Jira tools and nothing to mock. The `--known` matching (strong and weak matches, open and resolved bugs, regression candidates) is checked in the pilot, not here. The "never writes to Jira" case still has teeth: it fails if the answer claims a ticket was filed or the trace shows a write-style tool call.
- **No retest and no heal.** The fixtures have no Playwright installed and the session has no shell, so retest, live checks and `--heal` (including the uncommitted-file safeguard) cannot run here. They are in the pilot checklist.
- **The `npx playwright test --list` index path.** With no shell, `verify-coverage` takes its documented fallback (grep and read). The index path is pilot item 30.

## Adding a case

Create `evals/<name>/` with `prompt.md` (the request as a person would type it, plus `allowed_tools`, `max_turns`, `timeout_seconds` in the frontmatter), `case.yaml` (`schema_version: "1.1"`, `name`, the `context.scaffold_script`, and the `graders` list) and a `scaffold.sh` that builds the fixture with here-documents. Prefer cheap graders (`regex`, `file_exists`, `tool_used`) and give each case one `llm` rubric written as concrete PASS and FAIL conditions. Mark skill-fired checks `arm: with-only`. Do not name the skill in the prompt: the point is that the request alone makes the plugin fire.
