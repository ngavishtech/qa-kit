---
name: execute-tests
description: Runs Playwright test suites (by tag, file, or last-failed) and classifies failures by type (locator/timing/state/API/assertion) - read-only, makes no edits and never invokes healing on its own. Add "--heal" (or ask in plain language to heal/fix failures) to chain into the heal-tests skill afterward. Use when asked to run tests or investigate a failure without necessarily changing anything.
argument-hint: '<suite, tag, or file> [--heal]'
allowed-tools: Read, Glob, Grep, Bash, Skill, mcp__atlassian__*
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`. If invoking another skill by its bare name (as this document does) fails, retry as `qa-kit:<name>`, or read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it directly.

# Execute Tests

**Purpose**: Execute tests and classify failures - a read-only probe, never an editor. Use `heal-tests` (which composes this skill) when you also want failures fixed.

**Project overrides**: if the repo has `.qa-kit/project/conventions.md`, read its *Commands* table first. Its test commands and package manager replace the `npm run test:*` / `npx playwright test` examples below, and anything it says about env vars or the report location wins over the defaults here.

**Features**:
- Execute specific test suites or individual tests via the real `npm`/`playwright` scripts in `package.json`
- Failure-type analysis from Playwright's own reporter output
- **Groups failures sharing one root cause before reporting them** - a gating `beforeAll`/`beforeEach` failure that fails many/all tests at once is reported as *one* root cause with N affected tests, not N separate problems; likewise several body-level failures pointing at the same shared Page Object method/locator are reported as one group
- Makes **no edits of any kind** - it has no edit tool. If healing is wanted, this skill hands off to `heal-tests`, it never does it inline
- Can report results to Jira (`mcp__atlassian__*`) - **optional** per `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md`'s blocking-vs-optional rule

---

## How this skill is invoked

- **On demand, by a human**: `/qa-kit:execute-tests` plus what to run, e.g. `/qa-kit:execute-tests run the smoke suite` (report only) or `/qa-kit:execute-tests run the smoke suite --heal` (report, then also heal via `heal-tests`).
- **Autonomously, by the agent**: when asked to run tests or investigate a failure and this skill's description matches.
- **From `agent-executor`**: when running inside the `feature-implement` workflow (see `${CLAUDE_PLUGIN_ROOT}/workflows/feature-implement.js`), the agent decides whether to invoke this skill alone or `heal-tests` (which composes it) based on that run's `args.heal` - see `${CLAUDE_PLUGIN_ROOT}/agents/agent-executor.md` and `${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md` §7 "Feature Pipeline".

**Flag syntax**: `--heal` / `--no-heal` are recognized literally, but plain language works just as well ("run and heal any failures" ≡ `--heal`; "just run it, don't touch anything" ≡ `--no-heal`). **Default when neither is present or implied: `--no-heal`** - the whole point of this skill is that a bare "run the tests" request never edits anything unless asked. This is a different default than `heal-tests` (which always heals - that's its entire purpose) and different from the `feature-implement` pipeline (which defaults to healing, since the pipeline exists to deliver passing tests - see §7).

There's no separate CLI syntax beyond the flag above - describe the suite/file/tag in the same message. Underneath, this skill runs real `npm run test:*` scripts (see `package.json`) or `npx playwright test <args>` directly via Bash.

---

## Capabilities

1. **Test Execution**
   - `playwright.config.ts` defaults `use.headless` to `Environment.headless` (`src/support/config/environment.ts`), which is headed unless `CI=true` or `HEADLESS=true` is set - so a plain run is already headed, no `--headed` flag needed. Only pass `HEADLESS=true` as an env prefix when the user explicitly asks for a headless run.
   - Run by tag (`@smoke`, `@regression`, `@api`, `@ui`) via `npx playwright test --grep "@tag"`
   - Run by file path via `npx playwright test <path>`
   - Re-run only last-failed via `npx playwright test --last-failed`
   - Headless on request: `HEADLESS=true npx playwright test <path>`
   - **Inside the `feature-implement` workflow, headless depends on how many features are in that invocation**, not "any pipeline run is headless": the workflow tells you explicitly in your prompt - one feature running through it stays headed (nothing to contend with), several running at once go headless (no one's watching any single one of them, and they'd fight over the same machine). Standalone usage (not through the workflow at all) always keeps the normal headed-by-default behavior above.

2. **Failure Analysis**
   - Read the Playwright HTML/JSON report (`playwright-report/results.json`) and/or console output
   - Classify each failure:
     - Locator issues (element not found / timeout waiting for locator)
     - Timing issues (timeout on an assertion, race condition)
     - State issues (wrong state, missing cleanup, test isolation)
     - API issues (4xx/5xx, network error)
     - Assertion issues (values genuinely don't match - likely a real bug, not a test problem)
   - Note **where** each failure happened, not just the error text: inside a `beforeAll`/`beforeEach` hook (the error's stack trace points at code in the hook, not inside any `test(...)` callback - and a hook failure typically shows near-zero duration for the test body, since it never ran) versus inside the test's own body - this distinction is what the grouping below checks first.

3. **Root-Cause Grouping** (report-time only - no fixing here)
   - **Gating hook check first**: if several - especially most or all - currently-failing tests share the identical error with a stack trace pointing inside a `beforeAll`/`beforeEach` block, report that as **one** root cause ("N tests fail at this one hook") rather than classifying each downstream symptom separately. Don't guess what each test's own body would have done past the hook - that's unknown until the hook is actually fixed (which `heal-tests` does, not this skill).
   - **Shared body-level locator check next**: among what's left, if several failing tests' bodies point at the same Page Object method/locator (same file:line in the failure trace, or visibly the same selector), report that as one group too - `write-tests` is expected to route same-element scenarios through one shared method, so this is the common case once a plan has more than a couple of scenarios touching the same UI.
   - This grouping is exactly what makes `heal-tests` efficient later (one fix per group, not per test) - it's produced here at report time so it doesn't need to be re-derived downstream.

4. **Results Reporting**
   - Console/conversation summary always: total run, pass/fail/skip counts, each failure's classification and group
   - Jira comments via `mcp__atlassian__*` (configured; a write-back, so `glean_default` - read-only - can't substitute here) if asked - don't claim to have posted if the integration isn't actually there

---

## Workflow

### Step 1: Execute Tests

Run the real command for what was asked, e.g.:
```bash
npx playwright test --grep "@smoke"
npx playwright test src/tests/ui/orders/order-creation.spec.ts
npx playwright test --last-failed
```
Runs headed by default (see Test Execution above) - don't add `--headed`, and don't add `HEADLESS=true` unless the user asked for a headless run.

### Step 2: Parse Results

Read `playwright-report/results.json` (JSON reporter output configured in `playwright.config.ts`) for structured pass/fail/error data, or parse the console/dot-reporter output if the JSON report isn't available. For each failure, note where it happened per Capability 2 above - this is what Step 3's grouping checks first.

### Step 3: Group and Classify

**Apply the Root-Cause Grouping check (Capability 3) before anything else** - don't classify N hook-gated symptoms as N separate problems, and don't classify several same-locator body failures as unrelated. Once grouped, classify what's left per test/group:

| Error looks like | Type | Notes |
|---|---|---|
| `Locator.click: Timeout ... waiting for locator(...)` | locator | Candidate for `heal-tests`'s live locator discovery |
| `expect(locator).toBeVisible() ... Timeout` | timing | Candidate for a `WaitHelpers` swap |
| `expect(received).toBe(expected)` value mismatch | assertion | Likely a real bug - flag, never auto-fix |
| `APIResponse: 5xx` / network error | api | Check API/environment health first |
| Passes alone, fails in the full run | state | Test isolation / cleanup issue |

### Step 4: Heal? (only if requested)

- **`--heal` / plain-language heal request present**: invoke the `heal-tests` skill, passing it this run's grouped classification directly (so it doesn't need to re-run/re-classify from scratch) - see `heal-tests`'s `SKILL.md` for what happens next. Relay its result as part of this skill's own report rather than reporting twice.
- **Otherwise (default)**: stop here. Report the pass/fail counts, every failure's classification and group, and say explicitly that no edits were made - add `--heal` to have them fixed.

### Step 5: Report Results

Summarize: pass/fail/skip counts, each failure's classification, and any root-cause groupings found (e.g. "12 tests failed - all at one `beforeEach` locator; 2 further failures are independent"). If Step 4 chained into `heal-tests`, fold its report in rather than duplicating it. Only mention Jira reporting if that integration is actually configured and was actually used.

---

## MCP Integration

See `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md` for the shared rule. This skill itself does not use the Playwright MCP browser tools - live DOM inspection/locator discovery only happens inside `heal-tests` (via `discover-locator`), once healing is actually requested.

Jira reporting (`mcp__atlassian__*`, configured - a write-back, so `glean_default`'s read-only access doesn't cover it) is done through live tool calls from this skill, not code committed to the repo.

---

**Note**: This skill runs and classifies, never edits. Use `heal-tests` to fix what it finds, `plan-tests` to plan, `write-tests` to create new tests, and `review-tests` before/during PR review.
