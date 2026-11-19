---
name: write-tests
description: Generates production-ready Playwright UI, API or combined E2E tests from a test plan (.txt/.md/.json), a Jira story or a plain-text description, following the project's page-object/factory/constants/Allure conventions. Use when asked to write, add or implement a new test or test file. For several features in parallel use /qa-kit:feature-implement.
argument-hint: '<plan path, Jira key, or description> [ui|api|both]'
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Skill, mcp__atlassian__*, mcp__glean_default__*
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`. If invoking another skill by its bare name (as this document does) fails, retry as `qa-kit:<name>`, or read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it directly.

# Write Tests

**Purpose**: Generate production-ready Playwright tests from requirements, test plans, or Jira stories

**Supports**: UI tests, API tests, or both (E2E)
**Plan Formats**: `.txt`, `.md`, `.json`, or direct Jira story, or just a description in the prompt - see `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md` for the exact field structure and worked examples of each
**Locator Discovery**: Playwright MCP-assisted, at authoring time (see "Locator Discovery" below)

**Conventions (shared plugin)**: the aliases, helper names, feature enum and Allure/tag rules in this skill are the org's default Playwright conventions. If the repo has `.qa-kit/project/conventions.md`, read it first - anything it states (path aliases, directory layout, tag enums, helper names) overrides the defaults here. **Helper discovery (mandatory, before writing any code)**: every helper, util, fixture, constant, enum or base class this skill names (`AllureHelpers`, `WaitHelpers`, `AssertionHelpers`, `PlaywrightHelpers.testDetails`, `KeyboardHelpers`, `randomString`, `TEST_IDS`, `TIMEOUTS`, `BaseApiClient`, `API_ENDPOINTS`, `TestFeature` ...) is an example of a *concern*, not a promise that the symbol exists. Follow `${CLAUDE_PLUGIN_ROOT}/patterns/helper-discovery.md`: find the repo's own equivalent by purpose and use it as the repo uses it; if none exists, create it as part of this implementation (only what the approved plan's *Proposed Support Additions* lists, plus the minimum the requested tests need), before the spec that uses it, and list every file created in the report.

## Project Context

Before writing or modifying a test, consult:
- `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md` - the field structure of an incoming plan (`.txt`/`.md`/`.json`)
- `${CLAUDE_PLUGIN_ROOT}/patterns/testing-patterns.md` - the algorithm for designing/writing the actual test code (case selection, assertions, determinism)

---

## How this skill is invoked

- **On demand, by a human**: `/qa-kit:write-tests` plus what to generate, e.g. `/qa-kit:write-tests generate a UI test from test-plan.txt` or `/qa-kit:write-tests add an API test for DELETE /api/orders/:id`.
- **Autonomously, by the agent**: when the user asks to write/add a test and this skill's description matches.
- **From the `test-writer` agent**: when running inside the `feature-implement` workflow (see `${CLAUDE_PLUGIN_ROOT}/workflows/feature-implement.js`), the `test-writer` agent (`${CLAUDE_PLUGIN_ROOT}/agents/test-writer.md`) invokes this skill directly against an approved plan `plan-tests` produced (via the separate, prior `feature-plan` workflow run).

Pass the plan as a file path, pasted content, or a plain description in the same message - there's no separate flag syntax; describe the test type (`ui`, `api`, or `both`) and the source in natural language. To implement only part of a plan, name a level the same way (e.g. "only the Smoke scenarios"); see "Implementing a single level" below. The `feature-implement` workflow does this when it is run with a level.

**Parallel test-writing only exists through `feature-implement`, not this skill directly.** A single `/qa-kit:write-tests` call is one linear pass over your current checkout. Don't try to parallelize it yourself by firing off several `Agent({ subagent_type: 'test-writer', ... })` calls (or several `/qa-kit:write-tests` invocations) against the same working directory at once - unlike `test-planner` (read-only, safe to fan out per `${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md`'s "J. Ad hoc parallel work" in `${CLAUDE_PLUGIN_ROOT}/patterns/usage-examples.md`), `test-writer` edits files, so concurrent unisolated runs risk two agents writing to the same spec/Page Object at once. `/qa-kit:feature-implement` is the only place this is actually parallel-safe: when given several plans it creates a separate worktree/branch per plan, so N features' Write stages can run concurrently with zero collision risk (a lone plan just runs in your current checkout).

**This is the second half of the manual track** (`${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md` §7 "Feature Pipeline" -> "Two tracks, never mixed") - it consumes whatever standalone `/qa-kit:plan-tests` produced in `qa-kit-artifacts/`. There's no batch mode here either: to implement several manually-planned features, run `/qa-kit:write-tests` again for each one, serially - that's fine, since nothing runs concurrently in this track. What doesn't work is switching a feature from this track onto `/qa-kit:feature-implement` partway through; that requires having started it with `/qa-kit:feature-plan`.

---

## Capabilities

1. **Multi-Type Test Generation**
   - ✅ UI tests (browser-based)
   - ✅ API tests (REST API)
   - ✅ Both UI and API in the same test (E2E)

2. **Input Flexibility**
   - Read test plans from `.txt` files
   - Read test plans from `.md` files
   - Parse JSON test specifications
   - Fetch directly from Jira stories (via `mcp__atlassian__*`, or `mcp__glean_default__*` as a read-only fallback if Atlassian isn't authenticated locally - see `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md`)
   - Work from a plain-language description with no file at all

3. **Locator Discovery**
   - **Reuse before inventing, always** - if the same conceptual element already has a Page Object locator/method (from this plan's earlier scenarios or from existing code), route every scenario that needs it through that one method. Never duplicate an equivalent locator inline per-scenario - this isn't just cleanliness, it's what makes healing efficient later (see the placeholder rule just below): one fix to one shared method fixes every test that calls it, instead of `heal-tests` rediscovering the same root cause N times.
   - When a new locator is genuinely needed and the specific state this element appears in is actually reachable right now, invoke the `discover-locator` skill - it owns the live-inspection procedure and the canonical "Locator Strategy Priority" tier order (see `discover-locator`'s `SKILL.md`) so this skill doesn't keep its own copy of either. Write the locator it reports back into the Page Object, with no marker needed (it's verified). The generated test/page-object code itself never calls MCP; MCP is only used here, at write time, via `discover-locator`.
   - **If it can't be verified live right now** (app not running, MCP not connected, or - the common case - the state this element only appears in isn't reachable without actually running the test, e.g. an error banner, a specific details tab, a post-checkout confirmation) - don't stop and ask the user for every one of these; that doesn't scale across a plan with many scenarios, and don't bother invoking `discover-locator` either, since there's nothing live to inspect yet. A Scenario Block step carrying a `<UI-TBD: ...>` marker (see `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`) is the same case by construction - `plan-tests` already couldn't ground it, so treat it identically rather than re-litigating it. Instead, write your best-effort locator (same priority order, reasoned from naming conventions/similar existing elements/`TEST_IDS`) into the Page Object method as normal, but mark it explicitly unverified: a one-line comment directly above it, `// UNVERIFIED - not confirmed live during authoring, see write-tests SKILL.md; heal-tests must verify/heal before this is done`. This is not the same as fabricating and hiding it - the marker is what keeps it honest. `heal-tests` resolving this against the real page (via `discover-locator`), the first time this test actually runs and reaches that state, **is** the verification step, not a fallback for one - see `heal-tests`'s `SKILL.md` -> "Locator healing" step 2 for what it does with the marker.
   - Only fall back to asking the user when you genuinely have nothing to reason a placeholder from at all (e.g. the target isn't described anywhere in the plan/design and you'd be guessing blind, not applying a convention) - that's still rare, not the default reaction to "can't verify right now."

4. **Production-Ready Code**
   - Uses existing Page Objects/API clients
   - Imports via path aliases
   - Smart assertions with business context
   - Deterministic waits
   - Proper cleanup
   - Full Allure metadata

---

## Workflow

### Step 1: Parse Input

- `.txt`/`.md` plan: read it (Read tool) and extract each **Scenario Block** per `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md` (ID/Test/Type/Level/Priority/Tags/Description/Preconditions/Steps/Expected Results/Test Data/Cleanup).
- `.json` plan: read and parse it directly against the schema in `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md` (`tests[].id/name/type/level/priority/tags/steps/expectedResults`), adapting field names if the given plan diverges.
- Reviewed plan in `qa-kit-artifacts/`: read the approved Markdown file produced by `plan-tests` (this is the expected default source - check `qa-kit-artifacts/` for a matching plan before asking the user to paste one). It's the full document envelope from `test-plan-format.md` - pull out each Scenario Block under "Test Scenarios" rather than treating the whole file as one test.
- Jira story: call `mcp__atlassian__*` to fetch it (or `mcp__glean_default__*` if Atlassian isn't authenticated locally), then derive scenarios from its acceptance criteria/description/comments - same as the `plan-tests` skill's Step 1. This is a **blocking dependency** (per `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md`) when a bare story ID is the only source given - if neither server resolves it, stop and ask the user to authenticate one of them or paste the story details directly, rather than writing tests from a guessed/incomplete story.
- Plain description in the prompt: use it directly, ask a clarifying question only if the test type (ui/api/both) or target feature is genuinely ambiguous.

Use the `Test`/`name` field verbatim as the generated `test()` title. The `ID` field (`TC-NNN`) is parsed only for optional TestRail/Coverage cross-referencing elsewhere in this skill's output - never prepend, append, or otherwise concatenate it into the title string. If an incoming plan is sloppy and already has a stray `TC-NNN:` baked into the `Test`/`name` text itself (e.g. pasted straight from a ticket), strip that prefix before using it as the title. The title stays the plan's wording so it does not change when plans are renumbered.

### Existing tests: skip what is covered, extend what is partial

These two rules apply to every run, whether or not a level was named, so that running the same plan twice writes nothing new.

1. **Look before you write.** For each scenario, find out whether a test for it already exists. Start from the repo's test index: run the *List tests* command from `.qa-kit/project/conventions.md` (default `npx playwright test --list --reporter=json`, which needs no browser; add `--grep` with the feature tag in a large repo) and compare titles, files and tags with the scenario's `Test` name. Then read the best candidate spec to confirm it performs the same steps and asserts the same results. If the command fails, fall back to `Grep`/`Glob` over the test directory. A scenario that is already covered is **skipped** and named in the notes, with the existing test's `file:line`.
2. **Extend, never copy.** A scenario whose Description starts with `Extends <file> "<test>"` (the shape `plan-tests` writes for a `partial` scenario, see `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`) is added as a new test inside that existing spec and `describe`, reusing its setup, fixtures and Page Object calls. Do not copy the original test or its setup into a new file. If the named file or test no longer exists, say so in the notes and treat the scenario as new. Never delete or rewrite the existing test.

List every file you created or changed, including support code, in the structured result's `filesWritten` (paths relative to the git root, as git prints them), so the next stages know exactly what this run produced.

### Implementing a single level

When the request names one level (Smoke, Sanity or Regression), for example "implement only the Smoke scenarios of this plan":

- Select scenarios by their `Level` field, exactly that value (not cumulative: asking for Sanity does not include Smoke). Do not infer or change a scenario's level to make it fit; if a scenario has no `Level`, leave it out and say so in the notes.
- Skip scenarios that existing specs already implement (see "Existing tests" above), so a later run at another level adds only what is missing. Add to an existing spec file when it is the right home; list every file you created or added to.
- In Step 2, count only the selected scenarios when deciding what is needed. Create a `Proposed Support Additions` entry, or perform an `Existing (renamed)` move, only if a selected scenario is in its `Needed by`; defer the rest and say so in the notes.
- The Level rules below still apply to the selected scenarios (Smoke: at most 5 per feature, Critical, production-safe).
- If nothing is left to write at that level (none in the plan, or all already implemented), write nothing and report that clearly (inside the pipeline: `blocked` with the reason) instead of falling back to other levels.

### Step 2: Identify Required Components

**For UI Tests:**
- Which Page Objects are needed? (check `src/support/pages/`)
- **Search before you create**: run the discovery in `${CLAUDE_PLUGIN_ROOT}/patterns/helper-discovery.md` (the repo's helpers/utils/constants/factories/fixtures folders, from `conventions.md` or found by `Glob`) and read the signatures of anything that sounds related *before* adding any helper, constant, enum, or platform/keyboard/wait/random-data logic of your own. If an existing helper owns the concern (in the org reference repo: `KeyboardHelpers` for modifier keys and `process.platform`, `WaitHelpers` for waits, `randomString` for random typed-in strings), extend it and call it - a second copy of that logic anywhere else, or a new constant nothing imports, is a `review-tests` R11 finding. Only when discovery finds nothing, create the support code per that file's step 4.
- Which elements need interacting with?
- Which assertions to perform?
- Does the plan's `Scope` name an `Existing (renamed): <old-path> -> <new-path>` entry? If so, rename/move the existing spec and merge its tests into the new file instead of leaving both - the plan already identified the naming conflict, this step resolves it.

**For API Tests:**
- Which API clients are needed? (find the repo's API client folder per helper discovery - in the org reference repo `src/support/api/clients/`, e.g. a `<Resource>ApiClient extends BaseApiClient`; if the repo has no client layer, call Playwright's `APIRequestContext` through a small client you add per the plan's *Proposed Support Additions*)
- Which endpoints to call? (the repo's endpoint constants - reference repo: `@constants/endpoints` -> `API_ENDPOINTS`)
- Which response validations? (the repo's status/field assertion helpers - reference repo: `assertStatus`/`assertHasField`/`assertFieldValue` on `BaseApiClient`; otherwise plain `expect`)

Same underlying stack as UI tests, not a different one: API tests run through Playwright's own `APIRequestContext` (`@playwright/test`, injected into `BaseApiClient`), execute via the same `npx playwright test`/`npm run test:*` scripts, and report through the same `AllureHelpers` (`BaseApiClient.executeRequest` wraps every call in `AllureHelpers.step(...)` and attaches request/response JSON). The only thing genuinely absent is the browser/Playwright MCP - there's no DOM to inspect or heal.

**For Both (E2E):**
- Combination of UI + API
- Proper sequencing
- Data flow between layers
- Written to `src/tests/e2e/<flow-name>.spec.ts` - create the `e2e/` folder if this is the first E2E test in the repo

### Step 3: Generate Test Code

**UI Test Template:**

```typescript
import { test, expect } from '@fixtures/ui-fixtures'
import { AllureHelpers } from '@helpers/allure-helpers'
import { PlaywrightHelpers } from '@helpers/playwright-helpers'
import { TestPriority, TestLevel, TestType, TestFeature } from '@app-types/test-metadata.types'
// Import AssertionHelpers / WaitHelpers / constants only when the test body actually uses them.
// Every import and every helper name in these templates is an example of a concern - resolve the repo's
// real equivalent first (see "Helper discovery" below), never import a symbol you have not seen exported.

test.describe('[Feature Name]', () => {
  test.beforeEach(async ({ ordersPage }) => {
    // Once per describe, first line (above any test.skip): feature (same enum as the Feature tag below), story,
    // this test's own tags and the Allure severity derived from its TestPriority - one call, no per-test tags() line
    AllureHelpers.suite(TestFeature.[FEATURE], '[Story Name]')

    await ordersPage.clearCart()
    await ordersPage.reload()
  })

  test(
    '[Test Name]',
    PlaywrightHelpers.testDetails(TestLevel.[LEVEL], TestPriority.[PRIORITY], TestType.UI, TestFeature.[FEATURE_TAG]),
    async ({ [pageName] }) => {
    AllureHelpers.description('[Description with business context]')

    await AllureHelpers.step('[Setup step]', async () => {
      // Setup code
    })

    await AllureHelpers.step('[Action step]', async () => {
      // Action code using Page Object methods
    })

    await AllureHelpers.step('[Verification step]', async () => {
      expect([value]).toBe([expected]) // Comment: why this value?
    })
  })

  test.afterEach(async ({ ordersPage }) => {
    await ordersPage.clearCart()
  })
})
```

**API Test Template:**

```typescript
import { test, expect } from '@fixtures/api-fixtures'
import { AllureHelpers } from '@helpers/allure-helpers'
import { PlaywrightHelpers } from '@helpers/playwright-helpers'
import { AssertionHelpers } from '@helpers/assertion-helpers'
import { [Factory] } from '@factories/[FactoryName]'
import { API_ENDPOINTS } from '@constants/endpoints'
import { HttpStatus } from '@app-types/api.types'
import { TestPriority, TestLevel, TestType, TestFeature } from '@app-types/test-metadata.types'

test.describe('API: [Resource Name]', () => {
  let resourceId: string

  test.beforeEach(() => {
    // TestFeature.[FEATURE] - reuse an existing member if the resource matches one (e.g. an API
    // suite for orders reuses TestFeature.ORDERS, same as the UI orders suite); add a new member to
    // TestFeature in test-metadata.types.ts if this resource genuinely has no match yet - never a
    // raw string, suite() does not accept one. The story is optional for API suites.
    AllureHelpers.suite(TestFeature.[FEATURE])
  })

  test.afterEach(async ({ [clientName] }) => {
    if (resourceId) {
      await [clientName].[deleteMethod](resourceId)
    }
  })

  test(
    '[HTTP Method] [endpoint] - [Description]',
    // testDetails' 4th param (feature) is optional - but the suite() call above is not: it
    // always takes a real TestFeature member
    PlaywrightHelpers.testDetails(TestLevel.[LEVEL], TestPriority.[PRIORITY], TestType.API),
    async ({ [clientName] }) => {
    AllureHelpers.description('[Description with business context]')

    await AllureHelpers.step('[Step description]', async () => {
      const data = [Factory].create([overrides])
      const response = await [clientName].[method](data)

      resourceId = response.id

      AssertionHelpers.assertUuidFormat(response.id, '[Resource] ID')
      expect(response.name).toBe(data.name)
    })
  })
})
```

**E2E Test (Both UI + API), in `src/tests/e2e/`:**

```typescript
import { test, expect } from '@fixtures/ui-fixtures'
import { AllureHelpers } from '@helpers/allure-helpers'
import { PlaywrightHelpers } from '@helpers/playwright-helpers'
import { OrderFactory } from '@factories/OrderFactory'
import { API_ENDPOINTS } from '@constants/endpoints'
import { AssertionHelpers } from '@helpers/assertion-helpers'
import { TestPriority, TestLevel, TestType, TestFeature } from '@app-types/test-metadata.types'

test.describe('E2E: [Flow Name]', () => {
  let orderId: string

  test.beforeEach(() => {
    AllureHelpers.suite(TestFeature.[FEATURE], '[Story Name]')
  })

  test(
    '[E2E Scenario]',
    // No dedicated "E2E" type - carrying both UI and API already says this test spans both layers
    PlaywrightHelpers.testDetails(TestLevel.[LEVEL], TestPriority.[PRIORITY], [TestType.UI, TestType.API]),
    async ({ [pageName], request }) => {
    AllureHelpers.description('[Description with business context]')

    await AllureHelpers.step('Create order via API', async () => {
      const orderData = OrderFactory.createApiPayload()
      const response = await request.post(API_ENDPOINTS.ORDERS.CREATE, { data: orderData })
      orderId = (await response.json()).id
    })

    await AllureHelpers.step('Verify order visible in UI', async () => {
      await [pageName].open(orderId) // navigation lives in the Page Object, never page.goto in a spec
      await [pageName].waitForReady()
    })

    await AllureHelpers.step('Modify order in UI', async () => {
      await [pageName].[addItemMethod]([ITEM_TYPE]) // position comes from the live element, no coordinate literals
    })

    await AllureHelpers.step('Verify changes via API', async () => {
      const response = await request.get(API_ENDPOINTS.ORDERS.GET(orderId))
      const order = await response.json()
      AssertionHelpers.assertCount(order.items, expectedItemCount, '[Items]') // expectedItemCount: baseline read before the UI step + 1
    })
  })

  test.afterEach(async ({ request }) => {
    if (orderId) {
      await request.delete(API_ENDPOINTS.ORDERS.DELETE(orderId))
    }
  })
})
```

### Step 4: Lint Before Finishing

Report the support files you created under "Support added" (and any needed-but-not-in-plan ones under "Support added beyond plan") so the next stage and the reviewer can see them.

Invoke the `fix-lint` skill, scoped to exactly the file(s) you just wrote/edited - specs **and** any support files you created (pass the file list, don't run it whole-repo) before reporting done - a freshly generated spec landing with lint/format/typecheck errors just pushes the same cleanup onto `execute-tests` or `review-tests` downstream instead of catching it where it was introduced.

---

## Code Quality Rules

### 1. Imports

✅ **ALWAYS use path aliases:**
```typescript
import { AllureHelpers } from '@helpers/allure-helpers'
import { OrderFactory } from '@factories/OrderFactory'
import { TEST_IDS } from '@constants/test-ids'
```

❌ **NEVER use relative paths** across package boundaries (`../../../support/helpers/...`).

### 2. Assertions

✅ Smart, specific, business-aware:
```typescript
expect(itemCount).toBe(3) // We added 3 items: keyboard, mouse, monitor
AssertionHelpers.assertUuidFormat(orderId, 'Order ID')
AssertionHelpers.assertRecentTimestamp(createdAt, 60000, 'Created Timestamp')
```

❌ Generic, meaningless: `expect(count).toBeGreaterThan(0)`, `expect(true).toBeTruthy()`.

**Performance assertions measure with the browser's own timing, never wall-clock code around the action:**
```typescript
// ✅ GOOD: real rendering metrics from the Navigation Timing API
const timing = await page.evaluate(() => performance.getEntriesByType('navigation')[0])
expect(timing.domInteractive).toBeLessThan([threshold_ms]) // add a TIMEOUTS entry if this becomes a recurring check

// ❌ BAD: wall-clock around the action - fails on CI/runner hiccups that have nothing to do with the UI
const start = Date.now()
await ordersPage.open()
expect(Date.now() - start).toBeLessThan(500)
```

### 3. Waits

✅ Deterministic, condition-based: `WaitHelpers.waitForNetworkIdle(page)`, `WaitHelpers.waitForElementStable(locator, 'Order Row')`, `locator.waitFor({ state: 'visible' })`.

❌ Hardcoded timeouts: `page.waitForTimeout(5000)`.

❌ A swallowed best-effort wait: `await page.waitForLoadState('networkidle', { timeout: 1000 }).catch(() => {})` is a 1-second sleep with the failure hidden, not a deterministic wait (`review-tests` R10). Wait on a real condition, or put the best-effort wait in a `WaitHelpers` method that logs when it times out.

❌ Empty `catch {}` / `.catch(() => {})` / a try/catch that silently retries with a different locator, anywhere. Log it, rethrow it, or remove it.

### 4. Test Data

✅ Factory-generated: `OrderFactory.create({ customer: 'Jane Doe' })`, `OrderFactory.createWithItems(3)`.

❌ Hardcoded inline objects.

✅ **Typed-in / free-text values are generated, not stored as constants:** `randomString(length)` from `src/support/utils/string-helpers.ts` (`@support/utils/string-helpers`) for any value a test types into a field. ❌ A `TEST_*` string constant for that (`TEST_FIELD_VALUES.TEXT_INPUT = 'Test input value'`) - `review-tests` R3. A string that is itself the asserted domain term (an order status label, a UI message) is a domain value, see rule 8, not test data.

### 5. Cleanup

✅ Always clean up in `afterEach`.

✅ **Shared setup/cleanup lives in a Page Object method.** When two or more specs repeat the same `beforeEach`/`afterEach` body (capture a baseline, restore to it, clear state), add one Page Object method and call it from the hooks (`baseline = await ordersPage.captureBaseline()` / `await ordersPage.restoreTo(baseline)`). ❌ Pasting the same multi-line hook body into each spec (`review-tests` "Duplicated logic").

### 6. Tags

✅ **Every test gets Playwright's native `tag` option, built from five dedicated enums in `test-metadata.types.ts` via `PlaywrightHelpers.testDetails(...)` - never a raw string, never `TestTag` for anything that has its own category:**

| # | Category | Enum | Cardinality |
|---|---|---|---|
| 1 | Test Level | `TestLevel` (SMOKE/SANITY/REGRESSION) | **exactly one** - never combine (Smoke > Sanity > Regression precedence if a test would qualify for more than one) |
| 2 | Test Priority | `TestPriority` (CRITICAL/HIGH/MEDIUM/LOW) | exactly one |
| 3 | Test Type | `TestType` (UI/API/PERFORMANCE/A11Y) | one or more (e.g. an a11y test carries both UI and A11Y; a test spanning both layers carries both UI and API - there is no separate "E2E" type) |
| 4 | Test Feature | `TestFeature` (ORDERS/CHECKOUT/.../SECURITY) | zero or more |
| 5 | Test Tag | `TestTag` (catch-all - currently just the unused `TBD` placeholder; don't tag a real test with `TBD`) | zero or more |

**`PlaywrightHelpers.testDetails(level, priority, type, feature?, tag?)`** returns the whole
`{ tag: [...] }` details object - pass it straight as `test()`'s second argument, no `{ tag: ... }`
wrapper needed. `level`/`priority`/`type` are required params matching the exactly-one/exactly-one/
one-or-more cardinality above; `feature`/`tag` are optional (zero-or-more). Any of `type`/`feature`/
`tag` that need more than one value take an array (`[TestType.UI, TestType.A11Y]`) - a single value
doesn't need wrapping. The method always assembles the resulting array in the canonical
Level -> Priority -> Type(s) -> Feature(s) -> Tag(s) order regardless of what order you pass things in:
```typescript
test(
  'name',
  PlaywrightHelpers.testDetails(TestLevel.SMOKE, TestPriority.CRITICAL, TestType.UI, TestFeature.ORDERS),
  async (...) => {
    // No per-test tags() call: AllureHelpers.suite(feature, story) in the describe's beforeEach applies this test's own tags
    // (test.info().tags), sets the tag chips AND derives Allure severity from the TestPriority value above. For a one-off
    // override call AllureHelpers.tags('@x', ...) with an explicit list inside that test.
    ...
  }
)
```

**Allure metadata is set once per describe, not per test.** Feature, story, tags and severity come from one `AllureHelpers.suite(feature, story?)` call as the first line of the describe's `beforeEach` (above any `test.skip(...)`, so a skipped test still carries its metadata). Do not set `owner`; the kit does not generate it (a repo that wants it says so in `.qa-kit/project/conventions.md`). If the repo's Allure helper has no `suite()` (or its `tags()` needs an explicit list), treat it as a missing support helper per `${CLAUDE_PLUGIN_ROOT}/patterns/helper-discovery.md`: it is listed under the plan's *Proposed Support Additions* and created during implementation. Until it exists, call the repo's `feature()`, `story()` and `tags(...)` together in that same `beforeEach`, never per test.

Playwright's own `tag` option is typed as `string | string[]` - it has no idea `AnyTestTag` exists,
so a bare array literal (`{ tag: ['@random-junk'] }`) typechecks with zero warning. Routing every
test through `testDetails(...)` closes that gap - a string that isn't a genuine
TestLevel/TestPriority/TestType/TestFeature/TestTag value fails to compile there.

**Choosing the level**: follow the `Level` rule in `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md` (Smoke > Sanity > Regression; Smoke is max 5 per feature, always `@critical` and production-safe; when in doubt choose Sanity). Priority correlates with level but isn't automatic - `@critical` is always paired with `@smoke`; for `@sanity`/`@regression` judge by the area/content. There is no separate Allure severity concept and no separate call to set it - `suite()` (through `tags()`) scans the tags it applies - the running test's own `test.info().tags` when `tags()` is called with no arguments, or the explicit list if you pass one - for a `TestPriority` value, maps it through `PRIORITY_TO_ALLURE_SEVERITY` in `allure-helpers.ts` to one of Allure's real `Severity` values (not just the `@`-stripped word - `@critical`->`critical` matches exactly, but `@high`->`normal`, `@medium`->`minor`, `@low`->`trivial`, since Allure's fixed vocabulary doesn't share TestRail's words past "critical"), calls `allure.severity()` with it, and excludes that value from the tag chips so it isn't reported twice. Don't call `AllureHelpers.priority()` yourself alongside `tags()` - that would set the same severity label a second time for no reason; `priority()` exists only for the rare test that sets priority without going through the `tag` option at all.

**If a plan calls for shared cross-test/cross-file state where some failures should skip subsequent tests and others shouldn't**, any fixture implementing that must decide "critical vs. non-critical" by reading `testInfo.tags` for a `TestPriority`/`TestLevel` value (e.g. `@critical`+`@smoke` blocks the rest of the run), never by matching the test's title text, `ID`, or its position/order in the file - a title/ID/order match silently stops working the moment a test is renamed, renumbered, or reordered, while a tag match doesn't. Implement the rule **once** as a shared guard helper (`createCriticalFailureGuard()` returning `skipIfBlocked()` and `record(testInfo)`, see `${CLAUDE_PLUGIN_ROOT}/patterns/critical-failure-guard.md`, which also holds the code to create in the repo) and create **one guard per fixture file**, so a critical failure in one suite does not skip another. Never copy the criticality logic into each fixture.

**The same instability applies to `AllureHelpers.story(...)`.** The describe-level `beforeEach` sets one default `story()` for the whole file (per the UI Test Template above). If a handful of tests in that file genuinely cover a distinct story, override it explicitly inside that specific test (`feature()`/`story()`/`tags('@x')` stay available for this; a per-test call that only repeats the describe default is a `review-tests` R5 finding) - never by having the fixture/beforeEach inspect `test.info().title` and branch on a substring match:
```typescript
// ✅ GOOD: explicit override in the one test that needs it
test('Clears all applied filters at once', PlaywrightHelpers.testDetails(...), async ({ ordersPage }) => {
  AllureHelpers.story('Clear Filters') // overrides the describe-level default just for this test
  ...
})

// ❌ BAD: beforeEach guesses the story by parsing the title
test.beforeEach(async ({}, testInfo) => {
  AllureHelpers.story(testInfo.title.includes('clear') ? 'Clear Filters' : 'Search')
})
```
If a whole file is really split between two distinct stories, that's usually a sign to split it into two spec files instead of overriding test-by-test.

❌ Embedding `@tag` literally in the title string, or calling `AllureHelpers.tags(...)` with a hand-typed list that doesn't match the `tag` option - `--grep` only sees the `tag` option, not the title or the Allure call, so a mismatch here silently breaks tag-based test selection. ❌ Two `TestLevel` values on one test, or a feature tag repurposed as a type or vice versa. ❌ Calling both `AllureHelpers.priority()` and `AllureHelpers.tags()` for the same test - `tags()` alone already sets both. ❌ A bare `{ tag: [...] }` array literal instead of `PlaywrightHelpers.testDetails(...)` - Playwright's own `tag` type doesn't restrict it to real tag values, `testDetails(...)` does. ❌ Passing a plain string to `AllureHelpers.suite()` or `feature()` - their feature parameter type is `TestFeature`, not `TestFeature | string`; if the resource genuinely has no matching `TestFeature` member yet, add one instead of falling back to a string.

### 7. Descriptions

`AllureHelpers.description(...)` is read by an external/business audience in the Allure report, not just engineers - it's the one line that has to stand on its own without the test code next to it.

✅ **One plain sentence, one string literal, no `+` concatenation:**
```typescript
AllureHelpers.description(
  'Verify that adding an item to the cart updates the cart total and opens the order summary automatically.'
)
```
- Follow the established house style: `'Verify that <action>, <observable outcome>.'` - present tense, states what the test checks and what should happen, in language a non-engineer reading the report can follow (no internal method/variable names, no test-id strings).
- Target roughly a sentence's worth (~80-150 characters is the norm) - long enough to be genuinely informative, short enough to read at a glance. If the test covers several distinct outcomes, use one sentence with a comma/semicolon clause rather than stacking three separate sentences.
- If a description is long enough that it's tempting to wrap it, that's a signal to *shorten* it (drop restated setup detail, keep only the verified outcome), not to split it with `+`. A single string literal never needs manual wrapping - Prettier does not reformat string contents, so a long one-line literal is not a style violation.

❌ **Never build it with string concatenation** (`'First part. ' + 'Second part.'`) to keep source lines short - this reads as several bolted-together sentences in the report. ❌ Restating the test title or step names inside the description - it should add the *why/outcome*, not repeat what's already visible elsewhere in the report. ❌ Internal jargon (locator names, page-object method names, `data-testid` values) - an external reader has no context for those.

### 8. Domain Values & Comments

✅ **Represent domain values, don't inline them - and extend the representation when it's missing.** Before writing any literal that represents a stable domain concept (order status, category, UI message, etc.), check the relevant enum (`OrderStatus`, `OrderCategory`, ...) for a matching member:
```typescript
// ✅ GOOD: existing member
await ordersPage.searchOrders(OrderStatus.SHIPPED)
```
**If no matching member exists yet, but the value is a genuine, reusable domain concept** (not a synthetic/one-off test value) - add it to the existing enum, or define a new enum in `src/support/types/` if the domain genuinely has none yet, then use that member. Don't inline the literal just because today's enum happens not to cover it. (If the app itself just introduced new statuses/categories - check `src/support/types/order.types.ts` for the current member names before assuming one exists or picking a name yourself; don't guess at a member name that reads plausibly but was never actually added.)

**If a Page Object already maintains its own local list of these values** (an array/const of category or status names declared inside e.g. `OrdersPage.ts` instead of imported from `src/support/types/`) - that's the same violation one level removed: consolidate it into the shared enum and have the Page Object import it, don't let a second, duplicate source of truth live inside the page class just because it's convenient there.

❌ Only values that are intentionally synthetic/random per run (a generated search substring, a randomized character sample) are exempt - those are computed test data, not enum candidates:
```typescript
// ❌ BAD: stable domain value inlined instead of represented
await ordersPage.searchOrders('Shipped')
```

✅ **What counts as a domain value - and what does not.** Constants/enums are for values the test *depends on*: product text the app renders (labels, accessible names, error messages - `UI_MESSAGES`), ids, URLs, timeouts, node types/categories. ❌ Do **not** extract report prose into constants: `AllureHelpers.step('...')` titles, `AssertionHelpers` element-name arguments, and the failure label of `expect(x, 'label')` / `expect.poll(fn, { message: 'label' })`. They are read once, next to the assertion they describe, and nothing compares against them - moving them away only hides what failed. Keep them consistent instead: name the thing being measured, plus the moment when it matters - `'<What is measured>[ after <action>]'` (`'Nodes on canvas after paste'`, `'Rendered node width after zoom in'`), not a statement of the expectation (`'voiceName should be visible'`).

✅ **No file-header summary comments, no comments on self-evident code, no unflagged speculative comments** - see `${CLAUDE_PLUGIN_ROOT}/patterns/testing-patterns.md` -> "Step 3.1a: Comment Hygiene" for the full rule (this skill generates the code, so it's the first place these have to be enforced, not just caught later in review). A comment describing hypothetical/placeholder behavior must be removed or marked `// UNVERIFIED` per that same section - never left as an unflagged implication of future work.

### 9. Page Object Structure & Layout-Independence

✅ **Every static locator is a `readonly` field assigned in the Page Object's constructor** - all of a page's locators sit together at the top, and methods only *use* them. A locator that needs a runtime argument (an id, an index, a name) is built by ONE named factory method (`orderRowById(id)`), reused by every caller. ❌ `this.page.locator('.order-details-drawer[open]')` written inside a method body, and ❌ the same selector rebuilt in two methods (`review-tests` R8). Before adding a locator, check whether the page already has one for the same element and reuse it.

✅ **Page Objects hold atomic locators and single-purpose actions - no assertions.** Assertions (`expect(...)`, `AssertionHelpers.*`) live in specs and fixtures. An action method does one thing and is named with one verb (`clickSubmit()`, `selectShippingMethod()`); a method that hides several steps or branches on state ("get the order, or create it if missing", `doXAndY`) is a multi-step flow, and flows belong in fixtures, which compose Page Object actions (`review-tests` R14).

✅ **Never encode screen layout.** Pick elements by locator + index (`ordersTable.getAllRows().nth(1)`), and derive any position from the live element or its container (`boundingBox()` offsets/ratios). ❌ `{ x: 400, y: 300 }` as a constant, default parameter, or inline literal - the same coordinate lands on a different element on a different viewport (`review-tests` R9).

✅ **Keyboard shortcuts go through `KeyboardHelpers`** (extend it for new combos). ❌ `process.platform` checks or hardcoded `'Control+a'` / `'Meta+z'` anywhere outside it (`review-tests` R11).

---

## Locator Strategy Priority

Owned by `discover-locator`, not here - see `discover-locator`'s `SKILL.md` -> "Locator Strategy Priority" for the canonical tier order (Test ID -> Role -> Label -> Placeholder -> Text -> CSS selector -> derived from a related element), the rationale for promoting a verified test-id above Playwright's own default order, and what happens when nothing resolves. This skill only *applies* that order (via `discover-locator`, per "Locator Discovery" above) and *authors* around its result - it doesn't redefine the tiers.

---

## Success Criteria

✅ **Generated test must:**
1. Compile without TypeScript errors
2. Use path aliases for all imports
3. Include full Allure metadata
4. Use factories for test data
5. Use constants for endpoints/timeouts
6. Use assertion helpers where they fit
7. Use wait helpers (no hardcoded waits)
8. Include proper cleanup
9. Have smart, specific assertions with business context
10. Follow Page Object Model (no direct `page.` interaction in UI tests; locators declared once as constructor-assigned fields - see rule 9)
11. Carry a real, grep-functional `tag` option built from `TestLevel`/`TestPriority`/`TestType`/`TestFeature`/`TestTag` in that order - see Code Quality Rules #6
12. Pass `fix-lint` (lint/format/typecheck) before being reported done - see Step 4

---

## Error Handling

**If element not found (can't verify live right now):** write a best-effort locator per the priority order and mark it `// UNVERIFIED` per "Locator Discovery" above - don't stop to ask the user for this by default, `heal-tests` (via `discover-locator`) verifies it when the test actually runs. **Only** ask the user for guidance when there's genuinely nothing to reason a placeholder from (not described anywhere in the plan/design) - and in that case, still don't fabricate a guess just to have something.

**If a Page Object is missing:** list available Page Objects, suggest creating a new one, ask the user before doing so.

**If a factory method is missing:** list available factories, suggest adding a method, ask the user for the shape of the data needed.

---

**Note**: This skill generates tests from a plan produced by `plan-tests`. Use `execute-tests` to run them, `heal-tests` to fix any failures, and `review-tests` before/during PR review.
