# Test Plan Format

The single source of truth for test plan shape in this repo. Three skills depend on this file agreeing with itself:
- **`plan-tests`** produces a full plan document in this shape, saved to `qa-kit-artifacts/`. For a Jira-sourced plan, it gets the `Requirements Summary`/`Scope`/`Open Questions` sections from `read-ticket`'s digest(s) rather than deriving them itself - a feature can merge more than one ticket (plus a Figma link, plus free text), in which case `plan-tests` calls `read-ticket` once per ticket and merges every digest together (see `plan-tests`'s `SKILL.md` Step 1). When a UI journey is genuinely unclear from every source given, it either grounds it live (opt-in only, see `plan-tests`'s `SKILL.md` -> "Live UI Journey Grounding") or marks the gap inline with `<UI-TBD: ...>` (see "Marking Unverified UI Journey Details" below) rather than guessing. An already-saved plan can also be merged with new sources in place instead of regenerated - see `plan-tests`'s `SKILL.md` -> "Update Mode".
- **`read-ticket`** doesn't write this format directly - it produces one Summary/Acceptance-Criteria/Scope/Questions digest per ticket, which `plan-tests` maps (merging, if there's more than one) into the matching envelope sections below.
- **`write-tests`** parses a plan in this shape (either the full document, or a lone scenario block with no envelope) to generate specs. Treats a `<UI-TBD: ...>` marker the same as a target it can't verify live right now - see "Marking Unverified UI Journey Details" below.

Field values for `Level`/`Priority`/`Type`/`Tags` below must match the real enums in `src/support/types/test-metadata.types.ts` (`TestLevel`, `TestPriority`, `TestType`, `TestFeature`, `TestTag`) - the Level rule is under "Choosing the Level" below and the Level -> Priority -> Type -> Feature -> Tag ordering is in `write-tests`'s `SKILL.md`. If you change one section here, check whether the other skill's `SKILL.md` references it and needs updating too.

## Document Structure (`plan-tests` output)

```markdown
# Test Plan: [Feature Name]

**Jira Story**: ABC-1234
**Created**: [date]
**Priority**: Critical
**Estimated Tests**: 12
**Test Type**: ui | api | both   <!-- required, exactly one value; feature-implement and write-tests read this to know what to build -->


---

## Requirements Summary

[Brief summary of feature/story]

### Acceptance Criteria

1. [AC 1]

---

## Scope

**Product area** (inferred from the ticket/requirement text - which parts of the product are likely affected, e.g. API, frontend, workflows, DB - this repo doesn't check out the product codebase, so this is inference from what the ticket says, not a live grep):
- [area 1]

**Automation codebase area** (grounded in this repo's real structure - which existing Page Objects/API clients/specs are relevant, found via `Glob`/`Grep` over `src/support/`/`src/tests/`, not guessed):
- [e.g. `src/support/pages/OrdersPage.ts`, `src/tests/ui/orders/`]

---

## Proposed Support Additions

<!-- Produced per ${CLAUDE_PLUGIN_ROOT}/patterns/helper-discovery.md. Omit this whole section if every concern the scenarios need already has an equivalent in the repo. -->

| Concern | Searched | Found | Proposed addition (name -> location) | Needed by |
|---|---|---|---|---|
| [e.g. waiting for an async save] | [folders/symbols grepped] | none | [e.g. `waitForSave` -> existing wait helper file, or a new file] | [scenario IDs] |

---

## Open Questions

- [ambiguity that needs a human/PM/eng decision before implementation - omit this whole section if there are none, don't pad it]

---

## Test Scenarios

### 1. Positive Scenarios (Critical-High)

[one Scenario Block per test - see "Scenario Block" below]

### 2. Negative Scenarios (High-Medium)
### 3. Boundary Conditions (Medium)
### 4. Edge Cases (Low)

---

## Coverage Summary

| Scenario Type | Count | Priority | Status |
|--------------|-------|----------|--------|
| Positive | 4 | Critical-High | ❌ Not implemented |
| **Total** | **12** | | |

---

## Existing Coverage

| Feature Area | Existing Tests | Gaps |
|-------------|----------------|------|
| Order creation | ✅ 3 tests | Need negative scenarios |

**Coverage cross-check** (from `verify-coverage` in plan mode, one row per scenario that was `duplicate` or `partial`; `new` scenarios need no row):

| Scenario | Verdict | Evidence | Handling |
|---|---|---|---|
| TC-003 Export empty order list | duplicate | `src/tests/ui/orders/export.spec.ts:41` "exports an empty order list" | Removed from Test Scenarios |
| TC-004 Export 10k rows | partial | `export.spec.ts:58` covers 10 rows only | Kept; its Description says "Extends `export.spec.ts` ..." |

A `duplicate` is removed from Test Scenarios only with a row here, so a reviewer can put it back. A `partial` scenario's Description starts with the existing test it extends.

**The `Extends` sentence** (read by `write-tests`, so keep the shape): the Description of a `partial` scenario begins

```
Extends <file> "<test title>": <what this scenario adds>.
```

for example `Extends src/tests/ui/orders/export.spec.ts "exports 10 rows": adds a 10,000-row case and asserts the file has every row.` `write-tests` then adds the scenario as a new test inside that spec and `describe`, reusing its setup, instead of writing a copy. The file is the path shown in the Evidence column, the title is the existing test's title verbatim. A scenario without this sentence is treated as new.

**Naming/grouping conflicts**: if an existing spec file covers the same feature area this plan is about but sits under a name/location that doesn't match the grouping this plan introduces (e.g. a pre-existing `product-search.spec.ts` when this plan's new files are all `product-catalog-*.spec.ts`), don't leave it as a same-purpose duplicate alongside the new files. Call for a rename/consolidation instead: list it in `Scope`'s automation-codebase area as `Existing (renamed): <old-path> -> <new-path>`, and route its existing test cases into the new file's Coverage Type bucket rather than describing them as separate "already covered" work off to the side.

---

## TestRail Mapping

```json
{
  "project": "Shop",
  "suite": "Checkout Tests",
  "testCases": [
    { "id": "TC-001", "title": "Add item to cart", "priority": "Critical", "type": "Functional", "automatable": true }
  ]
}
```

---

## Implementation Priority

**Phase 1 (Critical - Must Have):**
1. TC-001: Add item to cart

**Phase 2 (High/Medium - Should Have):**
**Phase 3 (Low - Nice to Have):**

---

## Notes

- All UI tests should use Page Object Model
- All test data should use Factories
- All assertions should use AssertionHelpers
- Cleanup required in afterEach
- Full Allure metadata required

**Never add a bullet naming concrete locator constants** (e.g. "Use `TEST_IDS.SIDEBAR.*`") or otherwise prescribe locator strategy here - that's `discover-locator`'s job entirely, applied at `write-tests`/`heal-tests` time (verified-live-first, `TEST_IDS`-if-current, best-effort-`UNVERIFIED`-otherwise; see `discover-locator`'s `SKILL.md` -> "Locator Strategy Priority"). A plan naming a specific constant is a claim that it's current, which this skill has no way to verify - leave it out and let the methodology that owns it decide at implementation time.

**Any execution-order/state-continuity/parallelism proposal must be grounded in the real `playwright.config.ts` (read it, don't assume)**, and expressed through Playwright's own existing mechanisms - never a hand-rolled scheme. Both execution modes are legitimate and this repo's config already has a place for each:
- **Full-regression / shared-state (serial)**: this repo already runs fully sequential by default (`fullyParallel: false`, `workers: 1`) - a plan needing cross-file state continuity gets this for free. Don't propose a redundant new project just to re-achieve what's already the default.
- **Isolated / parallel (per-file or per-feature)**: equally legitimate - e.g. faster local iteration, independent debugging, CI parallelism. Support it the same way this repo's config already splits work by `project` (see the existing `setup`/`chromium` entries): an additional named `project` in `playwright.config.ts`, scoped via `testMatch`/`testDir` to just the relevant spec files, with its own `fullyParallel`/`workers` - never a parallel-execution scheme invented outside the `projects` array.
- **Order and relations between scenarios/files**, when genuinely required (not just "some deterministic order"), get described *declaratively* - which scenario/file needs which prior state, and why - using Playwright's own `test.describe.configure({ mode: 'serial' })` for within-file order and project `dependencies` for cross-file/cross-project relations (the same mechanism a `setup`-style project already uses to run before the main suite). Don't encode order into numbered filename prefixes - that breaks the moment the order changes - or a bespoke annotation-parsing scheme this repo doesn't already have.
- Don't write out the actual `playwright.config.ts` diff or fixture implementation code in the plan itself - that's `write-tests`' job at implementation time; the plan states the *requirement* (which mode, which files, which dependencies), not the code. See `plan-tests`'s `SKILL.md` -> "Quality Criteria" for the tag-based-determinism rule that applies if the requirement includes any notion of "critical" vs "non-critical" test failures.

---

## Next Steps

1. Resolve any `Open Questions` above, if the section is present - before, not during, implementation
2. Review and approve test plan (in `qa-kit-artifacts/`, shared with the team - not tracked by GitHub)
3. Create TestRail test cases (if using)
4. Implement tests with the `write-tests` skill
5. Execute tests with the `execute-tests` skill
```

## Scenario Block

This is the one format both skills read and write - it appears under each `### N. ... Scenarios` heading inside the full document above, **and** stands alone (no envelope) when a plan is just a lone `.txt`/`.md`/`.json` handed to `write-tests` directly.

```
ID: TC-001                    (optional - only needed for cross-referencing Coverage Summary/TestRail Mapping/Implementation Priority - never carry it into the `Test` field or any generated test() title)
Test: <name>
Type: UI | API | Performance | A11y (one or more, space-separated - matches TestType; e.g. "UI A11y" for an accessibility test, "UI API" for a test spanning both layers - there is no separate "E2E" type)
Level: Smoke | Sanity | Regression (exactly one - never combine; see "Choosing the Level" below)
Priority: Critical | High | Medium | Low (TestRail-aligned; a Smoke test is always Critical)
Tags: @tag1 @tag2 (reuse an existing `TestFeature` member whenever one fits - e.g. @checkout @security - the smallest set genuinely relevant, not every loosely-related keyword. This is the typical, default case. Level/Priority/Type each have their own field above, never repeat them here. **Only when a plan's feature genuinely has no matching `TestFeature` member yet (rare)**, write the proposed new value directly and mark it as new, e.g. `@wishlist (new TestFeature member)` - `write-tests` adds it to `TestFeature` in `test-metadata.types.ts` as part of implementation, exactly as it already does for a new API resource (see `write-tests`'s `SKILL.md` -> Step 3 API template comment). This is an implementation task, not a business ambiguity - don't route it through `Open Questions`. `TestTag` (currently just the unused `@tbd` placeholder) is a separate, rarer fallback for a tag that doesn't fit any `TestFeature` area's semantics at all - reach for a new `TestFeature` member first. Omit the Tags line entirely if no tag applies)

Description:
<what this test verifies and why>

Preconditions:
- <state required before the test starts>

Steps:
1. <action>

Expected Results:
- <observable outcome>

Test Data:
- <concrete values used>

Cleanup:
- <what must be torn down after>
```

### JSON equivalent

```json
{
  "id": "TC-001",
  "name": "Add Item to Cart",
  "type": ["ui"],
  "level": "smoke",
  "priority": "critical",
  "tags": ["@checkout"],
  "steps": ["Open product page", "Click Add to cart", "Verify cart badge updates"],
  "expectedResults": ["Cart badge shows 1", "Mini-cart opens"]
}
```

Field names mirror the plain-text fields (`id` <-> `ID`, `name` <-> `Test`, `type` <-> `Type`, `level` <-> `Level`, `priority` <-> `Priority`, `tags` <-> `Tags`, `steps` <-> `Steps`, `expectedResults` <-> `Expected Results`) - map rather than inventing a third naming scheme if a plan uses different names. A `tests: [...]` array wraps multiple blocks in one JSON file. Same rule as the plain-text `ID` field above applies here: `id` is cross-reference-only, never concatenated into `name`/the generated title.

## Choosing the Level

The one definition of `Level`; skills and agents point here. Exactly one value per test; when a test qualifies for more than one, take the highest precedence: Smoke > Sanity > Regression.

| Level | Meaning |
|---|---|
| Smoke | Component and main base functionality works: core operations via the primary path, base mechanisms with no workaround. Max 5 per feature, always Critical priority, and fully production-safe (creates and removes only its own data, no dependency on seeded data). |
| Sanity | Happy paths, usability and the main flows customers use regularly: redo counterparts, alternative entry points such as keyboard shortcuts, everyday operations like move/paste, UI presence, initial-state and tooltip checks. |
| Regression | Everything else, including negative and edge cases. |

When in doubt between two levels, choose Sanity.

`/qa-kit:feature-implement --level=<level>` selects scenarios by this field (exact level), so the value written here decides which run implements the scenario.

## Worked Examples

### UI test

```
ID: TC-001
Test: Add Item to Cart
Type: UI
Level: Smoke
Priority: Critical
Tags: @checkout

Description:
Verify that a user can add an in-stock product to the cart from the product page.
The cart badge should update and the mini-cart should open automatically.

Preconditions:
- User is logged in
- Product page is loaded
- Cart is empty

Steps:
1. Open the product page for an in-stock product
2. Select quantity 1
3. Click "Add to cart"
4. Wait for the cart to update

Expected Results:
- Cart badge shows 1
- Mini-cart opens automatically with the product, its price and quantity 1

Test Data:
- Product: any in-stock product
- Quantity: 1
- Expected cart count after: 1

Cleanup:
- Empty the cart after test
```

### API test

```
ID: TC-010
Test: API - Create Order
Type: API
Level: Smoke
Priority: Critical

Description:
Verify that POST /api/orders creates a new order in the pending state.

Preconditions:
- Valid authentication token
- API is accessible

Steps:
1. Generate order data with a unique customer name
2. Send POST request to /api/orders
3. Validate response structure
4. Fetch GET /api/orders/{orderId} to verify the order was persisted

Expected Results:
- Response status: 201 Created
- Response body has a valid UUID id, matching customerName, status "pending"
- Fetched order matches the created one and has no line items

Test Data:
- Customer name: "Test Customer {timestamp}"

Cleanup:
- Delete created order via DELETE /api/orders/{orderId}
```

### Combined UI + API test

```
ID: TC-020
Test: E2E - Create Order via API and Verify in UI
Type: UI API
Level: Regression
Priority: High

Description:
Create an order via API, then verify it appears and is editable in the UI.

Preconditions:
- Valid authentication token
- User is logged in in browser

Steps:
1. [API] Create an order via POST /api/orders
2. [UI] Navigate to /orders/{orderId} and verify the order page loads with status "pending"
3. [UI] Add an item to the order, wait for the save to complete
4. [API] Fetch GET /api/orders/{orderId} and verify it contains the added item

Expected Results:
- API creates the order; UI reflects it without errors; item data is consistent between UI and API

Test Data:
- Customer name: "E2E Test Customer {timestamp}"
- Item to add: any in-stock product

Cleanup:
- Delete order via API: DELETE /api/orders/{orderId}
```

## No Per-Scenario Ticket Field

A Scenario Block carries no `Story: <ticket-id>` field; provenance lives in the document-level `**Jira Story**` header. A grouping label for Allure is chosen by `write-tests` at implementation time (free text, never a raw ticket ID).

## Marking Unverified UI Journey Details

`plan-tests` sometimes has to describe a UI journey (which screen, which navigation step) without a screenshot/Figma link/live-app check to confirm it against - a bare Jira ticket describes *intent*, not necessarily the exact path through the current UI. Mark exactly that kind of gap inline, inside a Scenario Block's `Preconditions`/`Steps`/`Expected Results`, with:

`<UI-TBD: what needs confirming>` - e.g. `<UI-TBD: confirm whether the export action lives in the toolbar or the order details panel>`

**Angle brackets, not square brackets** - this repo's `[placeholder]` square-bracket convention (see the Document Structure template above, e.g. `[Feature Name]`, `[AC 1]`) means "fill this template field in," and `[...]` is sometimes valid, literal text inside the product's own UI (e.g. bracketed labels/badges) - `<UI-TBD: ...>` can't collide with either.

This is deliberately narrower than the `Open Questions` section:
- **`Open Questions`** = something only a human/PM can decide (a business/requirements ambiguity).
- **`<UI-TBD: ...>`** = a *mechanical* journey detail that live-inspecting the app would resolve, not something requiring a judgment call - via `discover-locator` at `write-tests` time, or `plan-tests`'s own optional live grounding (see `plan-tests`'s `SKILL.md` -> "Live UI Journey Grounding").

`write-tests` treats any `<UI-TBD: ...>` it encounters the same as a step whose target state genuinely isn't reachable right now: write the scenario/locator using the best-effort description and mark it `// UNVERIFIED` per its own convention (see `write-tests`'s `SKILL.md` -> "Locator Discovery"), letting `discover-locator`/`heal-tests` ground it for real the first time the test actually runs. Don't strip the marker on the way into generated code as if it had been resolved.

## Generation Rules

Once a Scenario Block is parsed, generation follows `write-tests`'s own Code Quality Rules and Success Criteria (Page Objects/API clients, factories, constants, Allure metadata, deterministic waits, cleanup, and the Level -> Priority -> Type -> Feature -> Tag ordering in the `tag` option) - not repeated here to avoid the two drifting out of sync.

## See Also

- `plan-tests`'s `SKILL.md` for the workflow that produces a document in this shape (requirement analysis, gap analysis, MCP calls, optional live UI grounding, Update Mode)
- `read-ticket`'s `SKILL.md` for how the `Requirements Summary`/`Scope`/`Open Questions` sections actually get sourced for a Jira-driven plan
- `write-tests`'s `SKILL.md` for the workflow that consumes a Scenario Block (locator discovery, code generation)
- `testing-patterns.md` for how to design/write the actual test code once a scenario is turned into a spec
- `write-tests`'s `SKILL.md` for the Level -> Priority -> Type -> Feature -> Tag ordering
