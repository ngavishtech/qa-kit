---
name: verify-coverage
description: Read-only coverage cross-check in two modes. Plan mode compares candidate plan scenarios with the specs and TestRail cases that already exist and marks each one new, partial or duplicate, so a plan never re-plans what is covered. Implementation mode compares the written specs with the approved plan and reports missing, weak, extra and duplicate tests as review findings. Use when asked whether something is already covered or whether the tests match the plan; plan-tests and the Review stage call it.
argument-hint: 'plan <plan path or scenario list>  |  implementation <plan path> [level=smoke|sanity|regression]'
allowed-tools: Read, Glob, Grep, Bash
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`. If invoking another skill by its bare name (as this document does) fails, retry as `qa-kit:<name>`, or read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it directly.

# Verify Coverage

**Purpose**: Answer one question with evidence - "is this scenario already tested, and do the tests we wrote match the plan?" - before a plan is saved (plan mode) and before the tests are delivered (implementation mode). Strictly read-only: it has no edit tool, never touches git, never writes to TestRail.

**Project overrides**: if the repo has `.qa-kit/project/conventions.md`, read it first: it names the test directory, the feature-tag enum and how tests are titled. Where it is silent, find the test directory from `playwright.config.ts` (`testDir`, project `testMatch`), never from a fixed path.

**One rule for every verdict**: cite the evidence - `file:line` and the test title of the existing test, or the TestRail case ID. A verdict with no evidence is not allowed; when nothing is found say `new` and name what you searched.

---

## How this skill is invoked

- **From `plan-tests`**: Step 3 (Map to Existing Coverage) invokes it in **plan mode** with the scenarios from Step 2 and any TestRail cases already fetched. Planning stays read-only, so this skill only returns verdicts and `plan-tests` writes them into the plan.
- **From the `test-reviewer` agent's Review step**: when its prompt names the approved plan, the agent invokes it in **implementation mode** right after `review-tests` and treats the result as extra review findings.
- **On demand, by a human**: `/qa-kit:verify-coverage plan qa-kit-artifacts/ABC-1234-test-plan.md` ("which of these scenarios already exist?") or `/qa-kit:verify-coverage implementation qa-kit-artifacts/ABC-1234-test-plan.md level=smoke` ("do the specs on this branch cover the plan?").

It asks no questions. If an input is missing (no plan file, no specs found) it says so and stops.

---

## Matching rule (both modes)

Two tests are **the same test** when they exercise the same behavior, not when their titles look alike: same area of the product, same user or API action, same observable outcome. Titles are the first clue, never the verdict - read the candidate spec's steps and assertions before deciding.

| Verdict | Meaning |
|---|---|
| **duplicate** | An existing test performs the scenario's action and asserts every one of its Expected Results (or the equivalent) |
| **partial** | Same journey exists but the scenario adds something: an Expected Result no test asserts, a different data class, a negative or boundary variant |
| **new** | Nothing covers it |

Search order for a scenario, **index first, grep to confirm**:
1. **The test index.** Once per run, run the *List tests* command from `.qa-kit/project/conventions.md` (default `npx playwright test --list --reporter=json`; it needs no browser, and `--grep @feature-tag` keeps the output small in a large repo). It gives every existing test's file, line, title path, tags and annotations exactly, so candidates are looked up there, not guessed. If the command fails or prints nothing usable, say so in the report and fall back to step 2 alone.
2. **Grep over the test directory** for the area words from the scenario's `Tags`/`Test`/`Description`, then the Page Object or API client methods its steps would call (a test that calls the same method with the same data is a strong candidate).
3. **Read the 1-3 best candidate specs in full** before giving a verdict. The index finds candidates; only reading the steps and assertions decides `duplicate`, `partial` or `new`.

---

## Plan mode

**Input**: the scenario list (a plan file, or the Scenario Blocks `plan-tests` has just generated) and, optionally, TestRail cases the caller already fetched (title, ID, section). This skill never calls TestRail itself.

1. For each scenario, find candidates in the repo (matching rule above) and, if TestRail cases were given, in them. A TestRail case with a matching title and steps counts as `partial` at most when no automated test exists: it proves the case is documented, not that it is automated.
2. Give every scenario a verdict with evidence.
3. Return a table, one row per scenario:

| Scenario ID / Test | Verdict | Evidence | Suggested handling |
|---|---|---|---|
| TC-003 Export empty order list | duplicate | `src/tests/ui/orders/export.spec.ts:41` "exports an empty order list" | Drop from the plan; list under Existing Coverage |
| TC-004 Export 10k rows | partial | `export.spec.ts:58` covers 10 rows, no large-volume case | Keep; Description says it extends that test |
| TC-005 Export as XLSX | new | searched `export*`, `OrdersPage.exportTo*`, TestRail section "Orders" | Keep |

4. Add a one-line summary: `Coverage check: N scenarios - D duplicate, P partial, W new`.

**How the caller must use it** (the rules `plan-tests` follows):
- **Never drop silently.** A `duplicate` is removed from Test Scenarios only if its row (with evidence) is listed in the plan's Existing Coverage section, so the reviewer can put it back.
- `partial` stays a normal scenario; its Description names the existing test it builds on, so `write-tests` adds the missing part instead of copying the whole test.
- When unsure between `duplicate` and `partial`, say `partial`. A wrongly dropped scenario is a hidden gap; a wrongly kept one is caught at review.

---

## Implementation mode

**Input**: the plan file, the spec files this run wrote or changed (from the prompt; otherwise the diff against the base branch per `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md` "Detecting the real default/base branch"), and optionally a level (`smoke`, `sanity` or `regression`).

1. **Scenarios to expect**: every Scenario Block in the plan. With a level, only those whose `Level` field equals it (exact, not cumulative), because a level run deliberately implements nothing else.
2. **Map each scenario to a test in the changed specs.** A generated test carries no TC ID in its title (`review-tests` R4), so match by the `Test` name first, then by steps and Expected Results. The scenario-to-test mapping exists only in this report.
3. **Classify each scenario**:
   - **covered**: a test performs the steps and asserts every Expected Result;
   - **weak**: a test exists but an Expected Result is not asserted, is asserted too loosely to fail (`toBeTruthy()`, `toBeGreaterThan(0)`), or the Test Data the plan names is not used;
   - **missing**: no test in the changed specs performs it. A scenario that only has a `test.fixme`/`skip` or a commented-out body is missing.
4. **Extra tests**: a changed test that maps to no scenario.
5. **Duplicates**: a changed test that matches an existing test outside this diff (matching rule above). Compare against the rest of the test directory, not only the diff.
6. **Report** a summary line, a per-scenario table with the test it maps to, then findings in the severity vocabulary of `review-tests` so `apply-review-fixes` can act on them:

`Coverage: planned P, covered C, weak W, missing M; extra E; duplicate D`

| Finding | Severity | Concrete fix (specific enough to apply) |
|---|---|---|
| missing scenario | **Blocking** | Name the scenario and say it needs `write-tests` (a new test, possibly a new Page Object method); `apply-review-fixes` hands this off, it never invents the test |
| weak scenario | **Should fix** | Name the Expected Result with no assertion and the exact assertion to add in that test (`file:line`) |
| duplicate of an existing test | **Should fix** | Name the existing test and say which to delete or merge, usually delete the new one and extend the old |
| extra test | **Nit**, or **Should fix** when it is large or touches new data | Say whether it belongs in the plan (add it via `/qa-kit:plan-tests --update`) or should be removed |

A scenario the plan itself marks with an unresolved `<UI-TBD: ...>` is judged on whether the test exists, not on the unresolved detail.

---

## Quality criteria

1. Every verdict and finding has evidence (`file:line` and test title, or a TestRail ID).
2. Report the whole picture in one pass: every scenario gets a row, not only the problems.
3. Never suggest weakening a plan scenario to make the numbers match.
4. Never edit anything, never write to TestRail, never commit.

---

**Note**: This skill only verifies. Use `plan-tests` to change a plan (`--update`), `write-tests` for a missing scenario, `apply-review-fixes` for the weak, duplicate and extra findings.
