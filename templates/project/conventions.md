# Project Conventions (overrides for qa-kit)

Lives at `.qa-kit/project/conventions.md`. These skills read this file first when it exists: `plan-tests`, `write-tests`, `review-tests`, `fix-lint`, `execute-tests`, `heal-tests`, `write-commit-message` and `commit-and-push` (plus the helper search in `patterns/helper-discovery.md`). Each uses the sections named in its own "Project overrides" line. **Anything stated here overrides the kit's defaults.** Delete any section that matches the defaults; keep only real differences. This file is yours to edit: when the kit adds rows or sections to this template, `/qa-kit:init` merges them in next to your edits and shows you any clash to resolve (it never overwrites your values).

## Layout

- Test source root: `src/`
- UI tests: `src/tests/ui/<feature>/`
- API tests: `src/tests/api/<resource>/`
- Page objects / API clients / factories / helpers / constants: `src/support/{pages,api/clients,factories,helpers,constants}/`
- Artifacts folder (everything qa-kit writes, plans today; must be gitignored - it creates a self-ignoring `.gitignore` inside): `qa-kit-artifacts/`

## Path aliases

`@support/*`, `@helpers/*`, `@factories/*`, `@constants/*`, `@app-types/*`, `@pages/*`, `@api/*`, `@fixtures/*`, `@tests/*`, `@setup/*` (edit to match `tsconfig.json`).

## Feature tags / metadata

- Feature enum: `TestFeature` in `src/support/types/test-metadata.types.ts` (or: none - write the enum name, or "none")
- Tag order on `test()`: Level, Priority, Type, Feature, then free tags
- Allure helpers used: `AllureHelpers.suite/feature/story/tags/description` (`suite` once per describe in `beforeEach`; add `owner` here only if your team wants it)
- Ticket link in tests (optional; `triage-failure` uses it to tie a failing test to a Jira issue): how a test names its ticket, for example a `test.info().annotations` entry of type `issue`, a tag like `@ABC-123`, or none

## Helpers (optional - skips discovery for the concerns you name)

Skills find your existing helpers by purpose (see the plugin's `patterns/helper-discovery.md`). Name a concern here only to pin it to a specific symbol; leave the rest to discovery. Delete rows you do not need.

| Concern | Symbol and import path in this repo |
|---|---|
| Waiting on a condition | (e.g. `WaitHelpers` from `@helpers/wait-helpers`) |
| Assertions with context | (e.g. `AssertionHelpers`) |
| Allure / tag metadata | (e.g. `AllureHelpers`, `PlaywrightHelpers.testDetails`) |
| Random typed-in input | (e.g. `randomString`) |
| API client base class | (e.g. `BaseApiClient`) |
| Test IDs / timeouts constants | (e.g. `TEST_IDS`, `TIMEOUTS`) |

## Commands (package scripts)

| Purpose | Command |
|---|---|
| Run all tests | `npm run tests` |
| Smoke only | `npm run test:smoke` |
| List tests (exact index of existing tests; no browser needed; add `--grep @feature-tag` in a large repo) | `npx playwright test --list --reporter=json` |
| Lint | `npm run lint` |
| Lint (auto-fix) | `npm run lint:fix` |
| Format (auto-fix) | `npm run format` |
| Format (check only) | `npm run format:check` |
| Typecheck | `npm run typecheck` |
| Package manager | `npm` (or `yarn` / `pnpm` - decides the install command for worktrees) |

## Git

- Default branch: only a fallback; the skills detect the real one live from the remote (`patterns/git-safety.md`). Set it here if detection fails in your setup.
- Branch naming (used by `commit-and-push` when it has to create a branch; `feature-implement` always names its own branches `feature/<slug>`): `feature/<slug>`
- Commit message format (used by `write-commit-message`): Conventional Commits by default, with a `[TICKET-ID]` prefix when the branch name has one; note any team-specific prefix or scope list here

## Monkey rules (used by `monkey-test` and `feature-monkey`)

| Rule | Value |
|---|---|
| Never run against (host names or fragments; any host with a `prod`, `production` or `live` label is already refused) | (none yet) |
| Areas, routes or controls to avoid (billing, user administration, anything that sends real messages) | (none yet) |
| Known console and network noise to ignore (messages, third-party origins) | (none yet) |
| Test accounts and data the monkey may use | (none yet) |
| Protected data: names, tags, folders or ids it must never change or copy, in addition to the built-in markers (NOT, SOURCE, SEED, TEMPLATE, KEEP, FIXTURE, GOLDEN, BASELINE, MASTER, MAIN, DEFAULT, locked or read-only items, and every name or id the tests use) | (none yet) |

## Anything else the skills should know

- (Known flaky areas, required env vars, test data rules, etc.)
