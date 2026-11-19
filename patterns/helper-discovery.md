# Helper Discovery

Shared rule for `plan-tests`, `write-tests` and `review-tests`. Skills in this plugin describe *concerns* a test needs handled (waiting on a condition, asserting a count, attaching Allure metadata, generating random input, pressing modifier keys, calling the API with auth, building test data). The org's reference repo happens to implement them as `WaitHelpers`, `AssertionHelpers`, `AllureHelpers`, `randomString`, `KeyboardHelpers`, `BaseApiClient`, factories and so on. **Other repos implement the same concerns under other names, in other folders, or not at all.** Names used in the skills are examples of a concern, never a guarantee that the symbol exists.

## Procedure (match first, create only as a last resort)

1. **Read the overrides.** If `.qa-kit/project/conventions.md` names the helper, fixture, constant or util for a concern, use that and stop searching for that concern.
2. **Find the concern's existing implementation, by purpose, not by name.**
   - Locate the support folders: take them from `conventions.md`; otherwise `Glob` for the usual homes listed in the "Reference catalog" below (`**/helpers`, `**/utils`, `**/support`, `**/constants`, `**/factories`, `**/fixtures`, `**/pages`, `**/api/clients`) outside `node_modules`. Read `tsconfig*.json` `paths` too: the aliases show where the repo keeps each kind of code.
   - `Grep` the exported symbols (`export (class|const|function|enum)`) and read the signatures of anything whose name or doc matches the concern's *Search aliases* in the catalog.
   - Look at two or three existing specs in the same feature area and see what they import. What the repo's own tests already use wins over what this plugin's examples name.
3. **Match.** Use the repo's equivalent exactly as the repo uses it (same import alias, same call shape). Do not wrap it, rename it, or add a second copy.
4. **If no equivalent exists, do not invent it silently and do not drop the requirement.** Record the gap and handle it by stage:
   - **Planning (`plan-tests`)**: list it in the plan's *Proposed Support Additions* section (concern, what was searched, proposed name and location, which scenarios need it). A human approves or edits that list with the rest of the plan.
   - **Writing (`write-tests`)**: create only the support code the approved plan lists (or, for a plan-less request, the minimum the requested test needs), in the repo's support folder, using the catalog's suggested name and folder and the naming rules below, and following the alias and export style of the neighbouring files. Keep it small and generic (one concern per helper, no feature-specific logic). Create it **before** the spec that uses it, and name every created file in the report. If a concern is needed but is not in the plan, add it to the report under "Support added beyond plan" rather than leaving it out.
   - **Reviewing (`review-tests`)**: before raising an R11 "reinvented helper" finding, run steps 1-2; flag only if an equivalent was actually found. A newly added helper that the plan listed is expected, not a finding; one the plan did not list goes in the report for the reviewer's judgement (Nit by default).
5. **Plain Playwright is the floor.** Where the concern is small enough that a helper would be one line over Playwright's own API (`expect(locator).toHaveCount(n)`, `expect.poll`, `locator.waitFor`), prefer the plain call over creating a helper, and say so in the report.

## Reference catalog (what to look for, and what to call it when you must create it)

Used in two ways, always **after** `conventions.md` and the repo's own content (precedence: `conventions.md` > what the repo already contains > this catalog):

- **Search**: for each concern, look under the folder names and grep the alias terms in the *Search aliases* column. Run the same searches every time, in the same order (folder first, then aliases, then what neighbouring specs import), so two runs on one repo find the same thing.
- **Create**: only when nothing was found. Use the *Suggested name* and *Suggested folder*, adjusted to the repo's casing and alias style (see "Naming rules"). Do not use the catalog to rename or move something that already exists.

Layout of the org reference repo (it is the shape the suggested names assume; a repo may use a different root than `src/`):

```
src/tests/{ui,api,e2e}/<feature>/*.spec.ts
src/support/{pages,api/clients,fixtures,helpers,utils,factories,constants,types,config,setup}/
```

| Concern | Suggested name | Suggested folder / file | Search aliases (folder names and grep terms) |
|---|---|---|---|
| Waiting / synchronisation | `WaitHelpers` (`waitForElementStable`, `waitForNetworkIdle`, `waitForSave`) | `helpers/wait-helpers.ts` | `wait`, `waitFor`, `sync`, `retry`, `poll`, `stable`, `idle`, `expect.poll` |
| Assertions with context | `AssertionHelpers` (`assertCount`, `assertUuidFormat`) | `helpers/assertion-helpers.ts` | `assert`, `verify`, `check`, `matchers`, `expect*` wrappers |
| Allure / report metadata | `AllureHelpers` (`suite` = feature + story + the test's own tags and severity in one call, plus `feature`, `story`, `tags`, `description`, `step`) | `helpers/allure-helpers.ts` | `allure`, `report`, `step`, `attachment`, `annotation` |
| Critical-failure guard | `createCriticalFailureGuard` (`skipIfBlocked`, `record`), one instance per fixture file; reference code in `patterns/critical-failure-guard.md` | `helpers/critical-failure-guard.ts` | `critical`, `skip`, `blocked`, `hasFailure`, `worker`, `test.skip` |
| Test metadata and tags | `PlaywrightHelpers.testDetails`; enums `TestLevel`, `TestPriority`, `TestType`, `TestFeature`, `TestTag` | `helpers/playwright-helpers.ts`, `types/test-metadata.types.ts` | `testDetails`, `tag`, `@smoke`, `severity`, `level`, `priority`, `annotations` |
| Locator utilities | `LocatorHelpers` | `helpers/locator-helpers.ts` | `locator`, `getBy`, `testId`, `selector` |
| Keyboard / platform | `KeyboardHelpers` | `helpers/keyboard-helpers.ts` | `keyboard`, `modifier`, `shortcut`, `process.platform`, `Meta`, `Control` |
| Random / generated input | `randomString(length)` | `utils/string-helpers.ts` | `random`, `faker`, `uuid`, `generate`, `unique`, `nanoid` |
| Test-data builders | `<Entity>Factory` with `create(overrides)` | `factories/<Entity>Factory.ts` | `factory`, `builder`, `mock`, `seed`, `testData`, `payload` |
| Test IDs | `TEST_IDS` | `constants/test-ids.ts` | `testid`, `data-testid`, `selectors`, `ids` |
| Timeouts | `TIMEOUTS` | `constants/timeouts.ts` | `timeout`, `delay`, `duration` |
| API endpoints | `API_ENDPOINTS` | `constants/endpoints.ts` | `endpoint`, `routes`, `urls`, `paths` |
| UI texts / messages | `UI_MESSAGES` | `constants/ui-messages.ts` | `messages`, `labels`, `copy`, `strings` |
| Page objects | `<Page>Page` extending a base page | `pages/<Page>Page.ts`, `pages/base/` | `page`, `screen`, `component`, `po` |
| API clients | `<Resource>ApiClient` extending a base client (`assertStatus`, `assertHasField`) | `api/clients/<Resource>ApiClient.ts`, `api/clients/base/` | `client`, `service`, `request`, `api`, `APIRequestContext` |
| Fixtures | `ui-fixtures`, `api-fixtures` (via `test.extend`) | `fixtures/` | `test.extend`, `base.extend`, `fixtures` |
| Domain enums / types | `<Domain>Type`, `<Domain>Category`; `HttpStatus` | `types/<domain>.types.ts` | `enum`, `types`, `models`, `interfaces`, `dto` |
| Environment config | `Environment` | `config/environment.ts` | `env`, `process.env`, `config`, `baseURL`, `headless` |
| Auth / global setup | `auth-setup` | `setup/auth-setup.ts` | `globalSetup`, `storageState`, `auth.setup`, `login` |
| Path aliases | `@helpers/*`, `@factories/*`, `@constants/*`, `@app-types/*`, `@pages/*`, `@api/*`, `@fixtures/*`, `@support/*`, `@tests/*`, `@setup/*` | `tsconfig.json` `paths` | `paths` in `tsconfig*.json` (read it; never invent an alias) |

### Naming rules for anything you create

- Mirror the casing of the neighbouring files. In the reference repo: **kebab-case files** for helpers, utils, constants, types, fixtures, config and setup (`wait-helpers.ts`, `test-ids.ts`, `string-helpers.ts`); **PascalCase files** for classes that represent one thing (`OrdersPage.ts`, `OrderFactory.ts`, `OrdersApiClient.ts`).
- Helper classes are plural nouns ending in `Helpers`; constants are `UPPER_SNAKE_CASE`; enums and types are `PascalCase`; spec files are `kebab-case.spec.ts`.
- One concern per file. Put a new function in the existing file for that concern (found by the search above) before creating a new file; create a new file only when the concern has no home at all.
- Use the repo's import alias, not a relative path across support folders. If the alias for the folder does not exist, say so in the report instead of adding one silently.

## Never

- Never import a symbol you did not see exported in this repo.
- Never create a helper that duplicates one you found, even if its name differs from the one a skill example uses.
- Never create support code during `review-tests` (it is read-only) or `heal-tests` (a heal that needs a new helper is `write-tests` territory, report it blocked in a pipeline).
