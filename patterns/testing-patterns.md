# Testing Patterns: Algorithm

Follow this linear algorithm to generate high-signal Playwright tests (UI, API, or both) for the behavior a requirement or plan describes.
If a test would still pass after introducing a real bug, it is not testing anything useful.

Paths, helper names and file names below are the org reference repo's. Treat them as examples of a concern and resolve the real ones per `${CLAUDE_PLUGIN_ROOT}/patterns/helper-discovery.md` and `.qa-kit/project/conventions.md`.

## Phase 1: Read & Orient

**Action:** Before writing any test, gather context.

- **Read the requirement or plan** to understand the user flow, the inputs a user can give, the states the UI can be in, and the API request/response contracts involved. Where the behavior is observable, confirm it against the running app (see `discover-locator`) instead of assuming it.
- **Check for existing spec files** for the same feature - extend them instead of creating duplicates.
- **Check for existing support** (page objects, API clients, factories, helpers, constants, fixtures) in the repo's support folders or the spec's `test.describe` block - reuse before creating new ones.

## Phase 2: Case Design

**Action:** Generate test cases using ISTQB techniques. Apply sequentially.

### Step 2.1: Domain Mapping

- Identify the **input domain**: valid ranges, required/optional/nullable fields, form constraints in the UI, request fields in the API, functionality by requirements.
- Identify the **output behaviors**: success, failure, user flow; what the user sees (UI state, messages, navigation), what the API returns (status, body) and what is persisted.

### Step 2.2: Case Generation

- **Happy path**: one representative valid case.
- **Equivalence partitioning**: one case per distinct behavior class.
- **Boundary value analysis**: for each threshold, test one value just below it, exactly at it, and one just above it (e.g., a name limit of 30 characters -> test 29, 30, 31).
- **Decision table / branch coverage**: cover each meaningful branch combination.

  | isActive | hasLicense | expected |
     | -------- | ---------- | -------- |
  | true     | true       | allow    |
  | true     | false      | deny     |
  | false    | true       | deny     |
  | false    | false      | deny     |
- **Edge cases**:
  - Collections: empty list, single element, duplicates.
  - Numbers: `0`, negatives (if domain allows).
  - Nullability: missing field, `null`, empty string (if the contract permits).
  - The UI and API must never show or return `NaN`, `undefined` or `Infinity` unintentionally - assert concrete results.
- **Error guessing**: double submit, casing/whitespace, unknown tokens, out-of-range values, expired or missing auth, 4xx/5xx from the API, reload in the middle of a flow.

## Phase 3: Implementation

**Input:** List of test cases from Phase 2.
**Action:** Write test code following Arrange-Act-Assert conceptual order, not necessarily in-code.

### Step 3.1a: Comment Hygiene

- **No file-header "summary" comment blocks** at the top of spec files - the `describe`/test titles already say this; a summary just adds a second place to maintain.
- **No comments on self-evident code** - a locator declaration or a method whose name already states what it does doesn't need one.
- **A comment describing hypothetical/placeholder behavior** (e.g. "in a real implementation this would...") must either be removed or explicitly flagged for verification using the same `// UNVERIFIED` convention `discover-locator`'s `SKILL.md` uses for unconfirmed locators - never left as an unflagged implication of future work.
- Comments earn their place only when they capture a non-obvious *why* (a workaround, a hidden constraint, a subtle invariant) - if removing the comment wouldn't confuse the next reader, don't write it.
- **No commented-out code** - a disabled line (`// storageState: 'auth.json'`) is dead code wearing a comment; either implement it, delete it, or if the behavior is genuinely deferred, use `test.skip`/`test.fixme` with a tracking annotation (Jira ID, reason), never a silently commented block with no decision attached.

```typescript
// ❌ BAD: narrates an obvious action, one line per step
// Click the save button
await saveButton.click()
// Wait for the dialog to close
await dialog.waitFor({ state: 'hidden' })

// ✅ GOOD: no narration needed, the calls already say this
await saveButton.click()
await dialog.waitFor({ state: 'hidden' })
```

### Step 3.1: Location & Naming

- **File path**: mirror the repo's test tree by type and feature (reference repo: `src/tests/ui/<feature>/`, `src/tests/api/<resource>/`, `src/tests/e2e/`). Support code goes in the repo's support folders (reference repo: `src/support/...`).
- **File names**: follow the neighbouring files' casing. Reference repo: spec files `kebab-case.spec.ts`; page objects, API clients and factories PascalCase (`OrdersPage.ts`); helpers, constants and types kebab-case. See the naming rules in `${CLAUDE_PLUGIN_ROOT}/patterns/helper-discovery.md`.
- **Describe block**: `test.describe('functionality')` or `test.describe('area - functionality')`. Nest one level only.
- **Test name**: `test('Add item to cart', async ({`. Happy path can omit condition. Short and precise, focus on functionality; user-story style ("displays X", "navigates to Y", "filters by Z"). No case IDs in the title.
- Extend the repo's base page class for pages that share navigation (reference repo: `BasePage`), if it has one.
- **Page Object structure**: every static locator is a `readonly` field assigned in the constructor, grouped at the top of the class; methods only use them. A locator that needs a runtime argument goes through ONE named factory method reused by all callers - never the same selector rebuilt inline in several methods (`review-tests` R8). A Page Object contains no assertions and only single-purpose, one-verb action methods; multi-step or state-branching flows (e.g. get-or-create an order) belong in fixtures, which compose Page Object actions (`review-tests` R14).
- **Page Object Model applies to fixtures too, not just test files** - a fixture that needs an element reaches it through a Page Object method like everything else; a locator inlined in a fixture is the same violation as one inlined in a test, just in a file that isn't named `*.spec.ts`.
- Locator strategy (strength tiers, verify against the live app before writing one): see `discover-locator`'s `SKILL.md` -> "Locator Strategy Priority" - that's the one canonical copy, not duplicated here.

### Step 3.2: Setup (Arrange)

- **Factories**: override only fields relevant to the test.
  - always check existing exports/files in the repo's factories folder before creating new factories.
  - Hoist shared factories to top of `describe` block. Never duplicate the same factory across `describe` blocks.
- **Determinism**: prefer dependency injection for time/random/locale. For time-based thresholds, construct dates relative to `Date.now()`, never hardcoded ISO strings. Prefer a reference-date parameter over mocking `Date.now()`. Ensure deterministic sort order before asserting.
- **Determinism applies to content, not just time/random/locale**: don't hardcode an expected collection size, search term, or character sample when it can be computed from the actual seed/response data (e.g. track an initial count and assert against `initialCount + delta`, not a literal total) or sampled randomly from a defined domain set (e.g. a random substring of a real product name, a random character from a defined special-character set). Hardcode only when the value is a true invariant of the system under test, not a convenient example.
- **This and the ENUM rule (`write-tests`'s `SKILL.md` -> "8. Domain Values & Comments") are two different fixes for the same smell, not competitors**: if the value is a *stable domain concept* (an order status, a category), represent it with an enum member. If it's a *selection* from data that already exists in the current fixture/seed (e.g. "search using one of the products already listed"), reach for that live instance dynamically instead of hardcoding which one by name - don't invent a new enum member just to name something you could have picked up live.
- **Determinism applies to layout too**: never hardcode pixel coordinates, drag deltas, or viewport-dependent positions as constants, default parameters, or inline literals - the same `{ x: 400, y: 300 }` hits a different element on a different screen size. Select by locator + index (`getAllProductCards().nth(i)`) and derive any position from the live element or container (`boundingBox()` offsets/ratios) (`review-tests` R9).
- **Typed-in values are generated**: use the repo's random-string helper (reference repo: `randomString(length)`, found per `${CLAUDE_PLUGIN_ROOT}/patterns/helper-discovery.md`) for free-text input rather than a `TEST_*` string constant (`review-tests` R3).
- **Isolation**: no shared mutable state between tests. Each test creates the data it needs and cleans it up in `afterEach`; no test depends on another having run first. A setup/cleanup body repeated across specs (capture a baseline, restore to it) is one Page Object method, not a pasted hook (`write-tests` -> "5. Cleanup"). When shared fixture state must skip later tests after a critical failure, use one shared guard per fixture file: `${CLAUDE_PLUGIN_ROOT}/patterns/critical-failure-guard.md`.
- **Waits are conditions, never delays**: wait on a locator state, a response or a poll (`expect(locator)...`, `locator.waitFor`, `expect.poll`), never `page.waitForTimeout`.

### Step 3.3: Parameterized Tests

Playwright has no `it.each`. When 3+ cases share setup and assertion shape, generate one `test()` per case from a typed array. Titles must be unique, so put the case value in the title. Each generated test still carries the full tag and Allure metadata `write-tests` requires.

```ts
const invalidNames = [
  { customerName: '', reason: 'empty' },
  { customerName: ' '.repeat(3), reason: 'whitespace only' },
  { customerName: randomString(CUSTOMER_NAME_MAX_LENGTH + 1), reason: 'above the length limit' },
]

for (const { customerName, reason } of invalidNames) {
  test(`POST /orders rejects a customer name that is ${reason}`, async ({ ordersClient }) => {
    const response = await ordersClient.create(OrderFactory.createApiPayload({ customerName }))
    expect(response.status()).toBe(HttpStatus.BAD_REQUEST)
  })
}
```

Use separate `test()` blocks when setup/assertions differ.

### Step 3.4: Assertions (Assert)

**Strong matchers:**

- `toBe`: primitives (status codes, counts read from the page or response)
- `toEqual`: response bodies and other objects/arrays
- `toStrictEqual`: when `undefined` fields matter
- `toBeCloseTo(n, decimals)`: floating point (e.g. `expect(score).toBeCloseTo(66.67, 1)`)
- `toHaveLength`: collection size
- Web-first locator assertions that retry until the condition holds: `toBeVisible`, `toBeHidden`, `toHaveText`, `toHaveValue`, `toHaveCount`, `toHaveURL`, `toBeEnabled`/`toBeDisabled`
- `expect.poll(...)` for state that settles asynchronously (async saves, background jobs)

**Prohibited:** `.toBeTruthy()`, `.toBeFalsy()`, `.not.toBeNull()` as primary checks.

**Assertion scope:** On the happy path, assert the full observable result (the whole response body, or every element of the visible state the requirement names). On edge-case tests, assert only the field(s) relevant to the specific behavior being tested.

### Step 3.5: Known Bugs

Do not encode broken behavior as a passing test. If fix is deferred, mark as `test.fixme` and add annotations (test level, Jira ID, etc..)

```ts
test.fixme('rejects an empty customer name', async ({ ordersClient }) => {
  // TODO(ABC-404): enable after bug fix in order validation
})
```

## Phase 4: Self-Check Gate

**Action:** Verify all answers are **Yes** before finalizing.

- [ ] Does each test validate behavior (not type shape or internals)?
- [ ] Are assertions specific and strong?
- [ ] Are time/random/locale effects controlled?
- [ ] Are tests isolated and deterministic, with condition-based waits only?
- [ ] Would at least one test fail if a realistic bug is introduced?
- [ ] Are known-bug tests marked `test.fixme` (not passing wrong behavior)?
- [ ] Did I extend existing spec files and reuse existing factories, helpers and page objects (found per helper discovery) instead of creating duplicates?
- [ ] Is every behavioral assumption the test relies on - not just locators - either verified against the live app or explicitly marked `// UNVERIFIED` for `heal-tests` to confirm? ("Why does this assume that?" with no answer in the code is the signal something here was guessed, not checked.)
