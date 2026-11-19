---
name: heal-tests
description: Runs a test suite (via execute-tests) and heals what fails - locator/timing/state/API fixes, deduped by root cause, with a full regression re-run before reporting done. Asks the user for guidance (or reports blocked, inside a pipeline) when auto-healing can't resolve something. Use when asked to fix a failing test/suite, or to run tests "and heal/fix" whatever fails.
argument-hint: '<suite, tag, or file to run and heal>'
allowed-tools: Read, Edit, Glob, Grep, Bash, Skill
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`. If invoking another skill by its bare name (as this document does) fails, retry as `qa-kit:<name>`, or read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it directly.

# Heal Tests

**Purpose**: Take a classified failure set (from `execute-tests`, which this skill composes) and fix it - deterministically, deduped by root cause, never by loosening an assertion or a timeout.

**Composes**: `execute-tests` (for the initial run+classification, every re-run to confirm a fix, and the final regression re-run), `discover-locator` (for live-DOM locator candidates), `fix-lint` (on whatever it edits).

**Project overrides**: if the repo has `.qa-kit/project/conventions.md`, read it first. Its *Helpers* table names the wait helper, constants and API client to heal with (otherwise find them per `${CLAUDE_PLUGIN_ROOT}/patterns/helper-discovery.md` - a heal never creates a new helper; that is `write-tests` territory), and its *Commands* table replaces the test commands used for re-runs.

---

## How this skill is invoked

- **On demand, by a human**: `/qa-kit:heal-tests` plus what to run and heal, e.g. `/qa-kit:heal-tests fix the smoke suite` or `/qa-kit:heal-tests heal src/tests/ui/orders/order-creation.spec.ts`.
- **Chained from `execute-tests`**: an `/qa-kit:execute-tests ... --heal` request (or the plain-language equivalent, e.g. "run and heal any failures") makes `execute-tests` invoke this skill directly after classification, passing its grouped failure list - see `execute-tests`'s `SKILL.md` -> "Step 4: Heal?".
- **From the `test-executor` agent**: inside `feature-implement`, when that run's `args.heal` isn't explicitly `false` (the pipeline default - see `${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md` §7 "Feature Pipeline"), the agent invokes this skill instead of `execute-tests` alone.

This skill always heals - that's its entire purpose. If you don't want anything fixed, use `execute-tests` alone instead (its default is report-only).

---

## Workflow

### Step 0: Get a classification

If you were handed a grouped failure list already (from `execute-tests` chaining forward, or from the calling agent), start from that. Otherwise, invoke `execute-tests` yourself first (no `--heal` - you only want its classification, not recursion) to get one.

### Step 1: Resolve any gating hook failure first, before touching anything else

If Step 0's classification reports a gating `beforeAll`/`beforeEach` failure (several/all currently-failing tests sharing one hook-level root cause):
- Treat the hook itself as a single healing unit - classify and heal *it* with whichever approach below matches its error (locator/timing/state/API).
- Fix it, then re-run the *entire originally-requested scope* via `execute-tests` again - you have zero information about what each test's own body does once it's no longer blocked at the hook; guessing would be wasted or wrong work.
- Repeat this step on the new classification (a hook can gate a second, deeper hook problem) until no gating hook failure remains - each round should shrink the failing set. If a round doesn't shrink it at all, that's a real problem, not a mechanical one - escalate (Step 4) rather than looping again.

### Step 2: Heal body-level failures, one healing unit at a time

By the time you're here, Step 1 has run to completion. Everything below heals Step 0/1's body-level groups, deduped by root cause - same principle as the hook, one layer down.

**Locator healing** - live, via `discover-locator`. Do this **once per healing unit** (one root-cause locator), not once per failing test:
1. Ask `discover-locator` for a working selector for the target element, in the same app state the failing test was in - it owns the live-inspection procedure and the canonical "Locator Strategy Priority" order (navigate, snapshot, try candidates in that order - see its own `SKILL.md`) and reports back what resolved, or what it tried and couldn't resolve.
2. If it found one: edit the Page Object (or spec, if one-off) via the `Edit` tool - never leave the fix only in a chat message. If the locator carried a `// UNVERIFIED` marker (see `write-tests`'s "Locator Discovery"), remove it now - this run *is* the verification.
3. Re-run the one test you were diagnosing (via `execute-tests`) to confirm. Don't separately re-diagnose the other tests in this healing unit - they call the same Page Object method, so this one fix already covers them; they're confirmed together in the final regression re-run (Step 3), not by repeating this per test.
4. If `discover-locator` found nothing: report what was tried and ask the user for the correct selector, or offer `test.fixme` pending their decision.
5. If the fix needs more than a selector/wait swap (a missing Page Object method, a new fixture, a restructured test) - that's `write-tests` territory, not a heal. Hand off explicitly: standalone, tell the user what's missing; inside `feature-implement` (no human mid-run), return blocked per Step 4 below.
6. **Systemic locator gap** - if `discover-locator` reports the *whole* Page Object's test-id contract is missing (not just the one locator - every `[data-testid]` the class references is absent, real elements use a different scheme entirely), stop healing locator-by-locator. Report the scope and ask whether this is a stale/wrong local build or a real product regression before rewriting selectors.

**Timing healing:**
1. Identify what the test was actually waiting for.
2. Replace the failing wait with the matching `WaitHelpers` method (`waitForElementStable`, `waitForNetworkIdle`, `waitForResponse`, etc.) rather than increasing a timeout.
3. Re-run (via `execute-tests`) to confirm.

**State healing:**
1. Check whether `beforeEach`/`afterEach` exist and actually clean up what this test created.
2. Check whether the test passes in isolation (`npx playwright test <file> --grep "<test name>"`) but fails in the full run - if so, this is cross-test pollution, not a fix to this test.

**API healing** - same `npx playwright test`/`npm run test:*` execution and the same Allure reporting as UI, just no browser or Playwright MCP involved. Read the attached request/response from the Allure/JSON report first, then:
1. **5xx / network error / connection refused**: environment issue, not a code fix - check `TARGET_ENVIRONMENT_URL`/`API_BASE_URL` (`src/support/config/environment.ts`) actually resolves and the target is up. Don't retry blindly.
2. **4xx the test didn't expect**: read the attached request body/headers - most often a stale `API_ENDPOINTS` constant, a missing `setAuthToken` call, or a factory (`@factories/*`) producing a payload the API now rejects. Fix the client/constant/factory, not the assertion.
3. **Response shape mismatch**: confirm against a fresh manual call before editing - this can also be a real regression to flag rather than heal.
4. Re-run (via `execute-tests`) to confirm.

**Assertion failures**: never "heal" these by changing the expected value to whatever the app returned - that hides real bugs. Flag it and ask (Step 4).

### Step 3: Final regression re-run

Once every healing unit from Steps 1-2 has been addressed, invoke `fix-lint` scoped to exactly the files you touched, then re-run the *entire original scope* (the whole file/tag/suite from Step 0) one more time via `execute-tests`. This is the only place that actually confirms (1) every test in a shared healing unit is fixed, not just the one diagnosed directly, and (2) nothing that was passing before your edits broke as a result of them. If this run turns up a *new* failure that wasn't in the original classification, treat it as fresh - back to Step 1 first, not silently folded into what you already reported fixed.

### Step 4: Escalation

- **Interactive** (a human is present): ask directly - "Cannot find element X. Suggested alternatives: A, B, C. Which should I use?" or the equivalent for the failure type. Ask before changing test files with anything beyond a locator/wait swap.
- **Inside a pipeline** (no one to ask mid-run): return a result indicating you're blocked and why (e.g. `{ blocked: true, blockReason: "..." }` per the calling stage's schema) so the workflow can surface it as one consolidated question after all features finish. This is the same path a "needs `write-tests`" hand-off takes.

### Step 5: Report Results

Pass/fail counts at each round (initial classification, after each gating-hook fix + re-run, after individual body-level heals, after the final regression re-run - call out explicitly if the last two differ, since that means a heal-induced regression was caught); exactly which fixes were applied and where (file:line), grouped by shared root cause; and which failures still need a human decision.

---

## Healing Success Criteria

**Healing is successful only if:**
1. The test passes after the fix, re-run to confirm (not assumed)
2. The fix is deterministic (a real selector/wait condition, not a longer timeout or a retry loop)
3. The fix follows the project's conventions (Page Object methods, `WaitHelpers`, constants where they're actually correct)
4. No other test broke as a result - confirmed by Step 3's final regression re-run, not assumed from each fix's own targeted re-run
5. `fix-lint` passes on the files you touched
6. A gating hook failure was fixed and re-confirmed **before** any of its tests' own body-level failures were individually diagnosed or healed - never the other way around

**Always defer to the user instead of auto-fixing when:**
- The failure is an assertion mismatch (possible real product bug)
- No locator strategy resolves even with `discover-locator`'s live inspection
- The fix would require changing test intent/expected behavior, not just mechanics

---

## MCP Integration

See `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md` for the shared rule. This skill never calls the Playwright MCP tools directly - all live DOM inspection goes through `discover-locator`, so there's exactly one place that procedure lives. Optional Jira reporting is handled by `execute-tests`, not here.

---

**Note**: This skill heals what `execute-tests` finds. Use `execute-tests` alone for a report-only run, `write-tests` when a fix needs more than a locator/wait swap, and `review-tests` before/during PR review.
