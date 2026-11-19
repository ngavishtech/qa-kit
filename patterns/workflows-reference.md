# AI-Assisted Workflows - Detailed Reference

> Reference for the `qa-kit` plugin's skills, agents, commands and workflows. It holds the Flags & Composition table (fast lookup), the PR Review SLA note, and the full purpose/usage/output/composition narrative for all skill stages plus the Feature Pipeline. Section numbers (§1-§17) are cross-referenced from the skills.

**PR Review SLA**: target one review round, resolved in hours, not days. The lever is moving mechanical/convention catches out of TL review time entirely: `write-tests` enforces conventions at authoring time, and `create-pr`'s self-review gate (`review-tests` + `apply-review-fixes`, see its `SKILL.md` Step 1-2) clears Blocking/Should-fix findings before a PR is ever opened. A PR that reaches a human should only need judgment calls on genuine design/business-logic trade-offs. If a TL comment on an open PR is just restating something already documented in the project's `AGENTS.md` or this plugin's `${CLAUDE_PLUGIN_ROOT}/patterns/*.md`, that's a signal the self-review gate was skipped (or an authoring-time rule needs strengthening) - not a normal part of review.

### Flags & Composition Reference

Fast lookup for "what can I control, from where, with what default". This is the one canonical flag and argument table: the commands (`${CLAUDE_PLUGIN_ROOT}/commands/*.md`), the workflow header comments (`${CLAUDE_PLUGIN_ROOT}/workflows/*.js`) and the usage examples point here. Keep it in sync whenever a flag, agent or skill is added or its default changes.

**Workflow arguments**

A command (or the runner, see "Running without the Workflow tool") parses its flags into the workflow's `args`. Only fields the user actually gave are passed; a flag that matches the default (`--heal`, `--apply`, or no `--level`) adds nothing.

| `args` field | Flag | Workflows | Default | Effect |
|---|---|---|---|---|
| `features[]` | positional items (one feature each) and `--plan <src, src, ...>` blocks (one merged feature per block) | feature-plan | none | Each entry is `{ jiraKeys?, planFiles?, figmaLinks?, testrailLocations?, descriptions? }`, every field an array, classified by shape in any order. A TestRail location overrides `.qa-kit/project/testrail-mapping.md` for that plan |
| `updates[]` | `--update <path>, <src, ...>` | feature-plan | none | Revise an already-planned feature in place: `{ plan: { planPath, task?, testType? }, ...new sources }`. Blocked if the plan file is gone. Never mixed with `--plan` in one block |
| `plans[]` | positional: Jira key or plan file name; none = all approved plans of the latest `feature-plan` run | feature-implement | latest `feature-plan` report | `{ task, planPath, testType, priorOwned? }` entries a human approved; `priorOwned` (the files an earlier run of the same plan left uncommitted) is attached for you from the previous report |
| `targets[]` | positional: task or branch; none = all targets of the latest `feature-implement` run, else the current branch | feature-deliver | latest `feature-implement` report, else current branch and cwd | `{ task, branch, worktreePath, baselineChanges?, ownedFiles? }` entries (the last two come from the implement report; `ownedFiles` limits Review and Deliver to what the pipeline produced) |
| `commit` | `--commit` | feature-implement (accepted but redundant on feature-deliver) | false | Run the Deliver stage and commit. With none of `commit`, `push` and `createPr` the stage is skipped and the tests stay uncommitted. feature-deliver always commits |
| `push` | `--push` (implies commit) | implement, deliver | false | Push each branch after its Deliver step; false leaves it committed and unpushed |
| `createPr` | `--pr` (implies push) | implement, deliver | false | Deliver runs `create-pr` instead of `commit-and-push` |
| `areas[]` | positional items: a feature tag, test folder, plan file, route or quoted words (one area each) | feature-monkey | none (required) | One monkey run per area: its own slug, `mk-<runid>-` data prefix and time budget. Up to `maxParallel` areas explore at the same time |
| `minutes` | `--minutes=N` | feature-monkey | 5 (at most 30) | Exploration budget per area, enforced by the workflow's own clock. Understanding the pages counts inside it; Map, Finalize and each unit's cleanup grace (2 minutes) are outside it |
| `unitMinutes` | `--unit-minutes=N` | feature-monkey | 5 (never more than `minutes`) | Longest a single page unit may take; each unit is a fresh agent call |
| `guidance` | `--guidance="text"` | feature-monkey | none | Free text about what to focus on or avoid. Quoted into every stage prompt as data, never as instructions |
| `readOnly` | `--read-only` | feature-monkey | false | No data is created: navigate, read and type without saving |
| `noCache` | `--no-cache` | feature-monkey | false | Ignore cached page understanding cards under `qa-kit-artifacts/monkey/_cache/` |
| `seed` | `--seed=N` | feature-monkey | random, printed in the report | Seeds the tour, action weights and fuzz picks |
| `maxParallel` | `--parallel=N` | all four | 3 (feature-monkey: 2) | Features (targets, areas) running concurrently. Areas share one app and one test account |
| `heal` | `--heal` / `--no-heal` | feature-implement | true | Execute stage heals (`heal-tests`); false only runs and classifies (`execute-tests`) |
| `apply` | `--apply` / `--no-apply` | implement, deliver | true | Review stage applies its findings (`apply-review-fixes`); false only reviews and reports. feature-deliver also runs a confirming `review-tests` re-review when a fix changed anything |
| `level` | `--level=smoke|sanity|regression` | feature-implement | unset (every level) | Write stage implements only the plan scenarios whose `Level:` field equals this value (exact level, not cumulative), skipping those an earlier run already implemented. Applies to every plan in the run. See "Level is scoped" in section 7 |
| `baseRef` | `--base=<ref>` | feature-implement | `origin/HEAD` | Ref isolated worktrees branch from (needs `git remote set-head origin -a` once if `origin/HEAD` is unset) |
| `worktreeDir` | `--worktree-dir=<dir>` | feature-implement | `../worktrees` | Parent folder of the per-feature worktrees (a relative path is relative to the git root; when qa-kit lives in a subfolder, work happens in `<worktree>/<that subfolder>`) |
| `installCommand` | `--install="<command>"` | feature-implement | auto-detected from the lockfile | Dependency install run inside a new worktree |
| `agentPrefix` | `--agent-prefix=<p>` | all four | the kit's namespace for the running agent, set for you | Namespace placed before agent names; `--agent-prefix=` means none. Only needed as the remedy for "unknown agent type" |

**Workflow composition**

| Name | Calls | Called by |
|---|---|---|
| `feature-plan.js` | `test-planner` (Plan; Update for `args.updates[]`) | `/qa-kit:feature-plan` |
| `feature-implement.js` | `test-writer` (Write) -> `test-executor` (Execute: `heal-tests`/`execute-tests`) -> `test-reviewer` (Review: `apply-review-fixes`/`review-tests`) -> `test-deliverer` (Deliver: `commit-and-push`/`create-pr`; only with `--commit`, `--push` or `--pr`) | `/qa-kit:feature-implement` |
| `feature-deliver.js` | `test-reviewer` (Review: `apply-review-fixes`/`review-tests`, + re-review) -> `test-deliverer` (Deliver: `commit-and-push`/`create-pr`; always commits) | `/qa-kit:feature-deliver` |
| `feature-monkey.js` | `test-monkey` (Map) -> `test-monkey` per page unit until the budget is spent (Explore) -> `test-monkey` (Finalize: ledger sweep, report); never git | `/qa-kit:feature-monkey` |

**Running without the Workflow tool**

Claude Code runs the workflows through the `Workflow` tool, started by the four `feature-*` commands. OpenCode (and CI, or any shell) runs the same workflow scripts through the Node runner, which takes the same flags:

```
node <kit>/runner/qa-kit.mjs <feature-plan|feature-implement|feature-deliver|feature-monkey> [items and flags] --agent opencode|claude
```

Value flags are written `--name=value`. Run options: `--agent` (required), `--model ID`, `--cwd DIR`, `--timeout MINUTES` (minutes), `--dry-run`; `--args-stdin` or `--args-file PATH` read the items and flags from standard input or a file, so user text is never interpreted by a shell (the OpenCode wrapper commands use a quoted heredoc with `--args-stdin`). Exit codes: `0` ok, `2` at least one entry blocked on a human decision, `3` a safety violation was detected. Each run saves its report under `qa-kit-artifacts/runs/` and the newest one as `qa-kit-artifacts/latest/<workflow>.json` (an envelope `{workflow, startedAt, args, report, violations, warnings}`; `report` is the workflow's own result); with no plan or target named, `feature-implement` and `feature-deliver` read the latest `feature-plan` / `feature-implement` report from there (OpenCode has no chat history to carry it).

**Agents**

| Name | Own flags (default) | Calls | Called by |
|---|---|---|---|
| `test-planner` | none | `plan-tests` (-> `read-ticket`, Figma/TestRail MCP) | `feature-plan.js` Plan stage; ad hoc |
| `test-writer` | none | `write-tests` (-> `discover-locator`, `fix-lint`) | `feature-implement.js` Write stage; ad hoc |
| `test-executor` | `--heal`/`--no-heal` (**heal**) | `heal-tests` (default) or `execute-tests` alone | `feature-implement.js` Execute stage (passes it via `executePrompt`'s heal note); ad hoc |
| `test-reviewer` | `--apply`/`--no-apply` (**apply**, own branch only; always report-only on someone else's PR regardless); confirming re-review after a fix, only when the prompt explicitly asks (feature-deliver only); coverage check against the plan, only when the prompt names the plan (feature-implement only) | `review-tests` (+`verify-coverage` in implementation mode when a plan is named, +`apply-review-fixes` by default, + a confirming `review-tests` re-review when asked); never touches git | `feature-implement.js` Review stage (passes it via `reviewPrompt`'s apply and coverage notes); `feature-deliver.js` Review stage (same apply note, plus the re-review ask); ad hoc |
| `test-triager` | `--known`, `--heal` (off), `--no-retest`, `--from`/`--groups`; no questions | `triage-failure` (-> `execute-tests`, `discover-locator`, `heal-tests` only with `--heal`) | direct use; a CI step later (not a workflow stage) |
| `test-monkey` | `--minutes`, `--guidance`, `--read-only`, `--seed`, `--no-cache`, `--stage=map`, `unit` or `finalize` with `--slug`/`--page` (the workflow passes these; never add `--stage` yourself); no questions; no `Edit` tool, writes only under `qa-kit-artifacts/monkey/` | `monkey-test` | `feature-monkey.js` Map, Explore and Finalize stages; direct use |
| `test-deliverer` | push/PR pre-auth (from caller, not self-decided); no edit tool | `commit-and-push`, or `create-pr` when PR creation was authorized | `feature-implement.js` Deliver stage (only with `--commit`/`--push`/`--pr`); `feature-deliver.js` Deliver stage (always); ad hoc |

**Skills**

| Name | Own flags (default) | Composes | Called by |
|---|---|---|---|
| `help` | optional name of a flow or skill (no argument = the overview, printed verbatim) | nothing (detail mode reads this file, the usage examples and the skill's own text) | `/qa-kit:help` |
| `init` | `--user`, `--path <folder>`, `--servers`, `--kit-url`, `--agents`, `--dry-run` | `tools/merge.mjs` (plan, apply, status) | `/qa-kit:init` |
| `read-ticket` | none | Atlassian/Glean MCP | `plan-tests`; `/qa-kit:read-ticket` |
| `verify-coverage` | mode: `plan` or `implementation` (first word of the request); optional `level=` in implementation mode; always read-only | nothing forward (repo specs; TestRail cases only if the caller fetched them) | `plan-tests` (Step 3 and Update Mode, plan mode); `test-reviewer` Review stage (implementation mode, when the plan is named); `/qa-kit:verify-coverage` |
| `triage-failure` | `--known=<keys or JQL>`, `--heal` (off), `--triage-only`, `--no-retest`, `--from=<triage.json>` + `--groups=`; input = report URL or local folder | `execute-tests` (the retest), `discover-locator` (read-only live check), `heal-tests` (only with `--heal`, `test-fix` groups), read-only Atlassian and Glean lookups | `test-triager`; `/qa-kit:triage-failure` (a person; CI later) |
| `monkey-test` | `<area>`, `--minutes=N` (5, max 30), `--guidance`, `--read-only`, `--seed`, `--no-cache`; staged form `--stage=map`, `unit` or `finalize` (workflow use); writes only under `qa-kit-artifacts/monkey/` | Playwright MCP; reads plans, tests and conventions; never `heal-tests`, `write-tests` or git | `test-monkey`; `/qa-kit:monkey-test` |
| `plan-tests` | `--update <path>` (Update Mode: merge new sources into an existing plan, non-default); *not a flag* - an ask-first prompt: live UI grounding via Playwright MCP (opt-in, interactive-only, non-default) | `read-ticket`, Figma MCP, TestRail MCP (optional), Playwright MCP (optional, interactive-only) | `test-planner`; `/qa-kit:plan-tests` |
| `write-tests` | test type ui/api/both (NL, inferred/asked - not a toggle) | `discover-locator` (if reachable), `fix-lint` | `test-writer`; `/qa-kit:write-tests` |
| `discover-locator` | none | Playwright MCP | `write-tests`, `heal-tests`; `/qa-kit:discover-locator` |
| `execute-tests` | `--heal`/`--no-heal` (**no-heal**) | chains to `heal-tests` if `--heal` | `test-executor` (when `--no-heal`); `heal-tests` (Step 0); `/qa-kit:execute-tests` |
| `heal-tests` | none (always heals); auto-pulls from `execute-tests` if no classification given | `execute-tests`, `discover-locator`, `fix-lint` | `test-executor` (default); `execute-tests` (chained); `/qa-kit:heal-tests` |
| `review-tests` | none (always read-only) | nothing forward | `test-reviewer`; `apply-review-fixes` (Step 1, if no findings exist - including when `apply-review-fixes` itself runs from `create-pr`'s self-review gate); `/qa-kit:review-tests` |
| `apply-review-fixes` | none (always applies); auto-pulls from `review-tests` if no findings exist | `review-tests` (conditionally), `fix-lint`, `execute-tests` | `test-reviewer` (default, own branch only); `create-pr` (self-review gate, Step 2); `/qa-kit:apply-review-fixes` |
| `fix-lint` | implicit: file-list given -> scoped, none -> whole-repo (default) | npm scripts | `write-tests`, `heal-tests`, `apply-review-fixes`; `/qa-kit:fix-lint` |
| `write-commit-message` | none (explicit-only) | git | `commit-and-push`, `create-pr`; `/qa-kit:write-commit-message` |
| `commit-and-push` | push pre-auth (from caller; standalone default = ask) | `write-commit-message` | `create-pr`, `test-reviewer` Deliver; `/qa-kit:commit-and-push` |
| `create-pr` | push+PR pre-auth (from caller; standalone default = ask both); self-review gate (**on** by default, skippable only if explicitly told to) | `apply-review-fixes` (self-review gate, own branch - which composes `review-tests` itself, conditionally), `commit-and-push` | `test-reviewer` Deliver (only if `args.createPr`); `/qa-kit:create-pr` |


---


### 1. Read Ticket

**Skill**: `read-ticket`

**Purpose**: Fetch a Jira ticket (and its linked Confluence pages/subtasks) and produce a structured digest - summary, acceptance criteria, product/automation scope, open questions. Fetches via the `atlassian` MCP, or `glean_default` (enterprise search) as a read-only alternative when Atlassian isn't authorized locally - see `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md`. **This is a blocking dependency, not optional**: a bare ticket ID has no other source of content, so if neither server is authorized, this skill stops rather than guessing - it asks the user to authenticate one of them or paste the ticket details directly (or, run non-interactively inside `feature-plan`, reports `blocked`/`blockReason` instead of a digest). Narrower and faster than full planning - the single source of truth for *fetching* a ticket, composed by `plan-tests` (see "2. Plan Tests" -> Step 1) rather than duplicated there.

**Usage**: `/qa-kit:read-ticket ABC-4021` - useful standalone for a quick "what's this ticket about" without running full planning, or automatically as `plan-tests`'s first step for a Jira-sourced plan.

**Output**:
- Summary (1-2 sentences) and bulleted, testable Acceptance Criteria
- Scope: product area (inferred from the ticket text) and automation-codebase area (grounded in real `Glob`/`Grep` results over `src/support/`/`src/tests/`, never assumed)
- Open Questions (only when there's genuine ambiguity - omitted otherwise)
- Linked References: any Figma link and/or TestRail location genuinely present in the ticket's own text (never inferred from a feature name) - omitted when none are found. `plan-tests` folds these into whatever Figma links/TestRail locations were already given directly, **in addition to** them, never instead - see "2. Plan Tests" below.

**Not a bypass of the review gate**: this digest is occasionally enough on its own for a human to hand a trivial, obviously-scoped fix straight to `write-tests` - but that's a deliberate, occasional human call each time, not this skill's default expectation. `plan-tests`'s "never skip the review step" rule still holds.

---

### 2. Plan Tests

**Skill**: `plan-tests` - **Agent**: `test-planner`

**Purpose**: Analyze Jira/Confluence stories (via `read-ticket`, which itself uses `atlassian` or falls back to `glean_default`) and Figma designs, cross-check against existing TestRail/repo coverage -> generate a comprehensive test plan. **Supports multiple sources merged into one plan** - e.g. an epic plus its subtasks plus a Figma link plus extra free text, all for the same feature (see "7. Feature Pipeline" -> the `--plan` divider, or just describe them together in one `/qa-kit:plan-tests` prompt outside the pipeline). Which sources are blocking and which optional follows `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md` (Jira/Figma are blocking, TestRail's cross-check is optional). The cross-check is always scoped via `.qa-kit/project/testrail-mapping.md`'s exact project/suite/section per `TestFeature` rather than an unscoped search (a feature with no mapping entry there just skips the cross-check, same as TestRail being unauthenticated).

**Usage**: `/qa-kit:plan-tests` plus what to analyze, e.g. `/qa-kit:plan-tests ABC-1234` or `/qa-kit:plan-tests plan tests for this Figma design: <url>`. Also invoked automatically when a request matches (e.g. "plan test coverage for ABC-1234").

**Update Mode**: point it at an existing `qa-kit-artifacts/*.md` plan plus new sources (a Figma link, screenshots, extra text) instead of starting fresh via the `--update` flag - `/qa-kit:plan-tests --update qa-kit-artifacts/ABC-3702-test-plan.md with <new source>` - same `--flag` convention as `--heal`/`--apply`/`--push`/`--pr` elsewhere. It merges into that file in place, resolving `<UI-TBD>` markers/`Open Questions` the new source answers, rather than regenerating and losing prior team review. See `plan-tests`'s `SKILL.md` -> "Update Mode".

**Live UI Journey Grounding (opt-in, not default)**: when a UI feature's journey is genuinely unclear from ticket/Figma/text alone and no screenshot was given, this skill can ask to open a **headed** Playwright MCP session and wait for you to log in/navigate to the right starting point, then explore read-only to ground the plan - never triggered automatically, and never available inside the non-interactive `feature-plan` workflow (no one to log in mid-pipeline). Ambiguity that isn't grounded this way is marked `<UI-TBD: ...>` inline in the affected Scenario Block instead of guessed - see `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md` and `plan-tests`'s `SKILL.md` -> "Live UI Journey Grounding".

**Output**:
- Test scenarios (positive, negative, boundary, edge cases)
- Priority assignments via `TestPriority` (Critical/High/Medium/Low, TestRail-aligned) - the only "how important" concept; there is no separate Allure severity
- Tag recommendations
- TestRail test case stubs
- A coverage cross-check (`verify-coverage`, section 15): scenarios an existing test already covers are not planned again, and each one dropped is listed in Existing Coverage with its evidence
- Unverified UI-journey details marked inline with `<UI-TBD: ...>` - distinct from `Open Questions`' business-level ambiguity, see `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`
- Saved as a Markdown file under the gitignored `qa-kit-artifacts/` folder for team review before implementation begins

---

### 3. Write Tests

**Skill**: `write-tests` - **Agent**: `test-writer`

**Purpose**: Generate production-ready Playwright tests from requirements/plans

**Features**:
- ✅ Supports **UI, API, or both**
- ✅ Reads **.txt/.md/.json** plan files, a Jira story, or a plain-text description
- ✅ Composes the **`discover-locator`** skill (see §11) at authoring time, when the target state is actually reachable, to confirm real locators via the Playwright MCP before writing them into a Page Object - when that state genuinely isn't reachable yet, writes a clearly `// UNVERIFIED`-marked best-effort locator instead of stopping to ask, and lets `heal-tests` (see §12, itself composing `discover-locator`) verify/heal it the first time the test actually runs (see `write-tests`'s "Locator Discovery")
- ✅ Always routes scenarios needing the same element through one shared Page Object method, never a duplicated inline locator per scenario - this is what makes a later heal (or a placeholder's first real verification) apply to every test that uses it, instead of `execute-tests` rediscovering the same fix once per test
- ✅ Generates tests with full Allure metadata
- ✅ Uses factories, constants, helpers automatically
- ✅ Includes proper cleanup
- ✅ Skips scenarios that already have a test and adds an `Extends <file> "<test>"` scenario inside that existing spec (reusing its setup) instead of copying it, on every run, so running a plan twice writes nothing new. It finds existing tests through the repo's *List tests* command first (default `npx playwright test --list --reporter=json`), then grep

**Usage**: `/qa-kit:write-tests` plus the source and type, e.g. `/qa-kit:write-tests generate a UI test from test-plan.txt`, `/qa-kit:write-tests add an API test for the plan-delete endpoint`, or `/qa-kit:write-tests generate an E2E (both) test from plan.md`.

**Parallel usage**: `/qa-kit:write-tests` itself is single-threaded, one linear pass over your current checkout - there's no flag or mode that parallelizes it. Writing tests for several features concurrently is only safe via `/qa-kit:feature-implement`, whose Write stage runs `test-writer` per plan inside that plan's own isolated worktree/branch whenever more than one plan runs at once (see "7. Feature Pipeline"'s "Isolation") - not by fanning out `/qa-kit:write-tests` or bare `test-writer` `Agent` calls yourself against one shared checkout, which risks two writes colliding on the same file.

**Generated Code Quality**:
- Uses existing Page Objects/API clients
- Imports from path aliases (`@helpers/*`, `@factories/*`)
- Smart assertions with business context
- Deterministic waits
- Proper test isolation

Before finishing, this skill also runs `fix-lint` on what it wrote, so a generated spec doesn't hand off to `execute-tests`/`review-tests` with lint/format/typecheck errors already in it.

API tests run on the same stack as UI tests, not a different one - Playwright's own `APIRequestContext` (`@playwright/test`), wrapped by `BaseApiClient`/its subclasses (e.g. `OrdersApiClient`), executed via the same `npx playwright test`/`npm run test:*` scripts, and reported through the same `AllureHelpers` (every request/response is already attached via `AllureHelpers.step`/`attachJson` inside `BaseApiClient.executeRequest`). The only thing missing is the browser/Playwright MCP - there's no DOM to inspect or heal.

---

### 4. Review Tests

**Skill**: `review-tests` - **Agent**: `test-reviewer`

**Purpose**: Review a PR's (or local branch's) test changes against the Code Review checklist in `review-tests`'s `SKILL.md` and the project's `AGENTS.md` standards, and triage existing PR feedback - **strictly read-only**, `allowed-tools` has no `Edit` at all. Use `apply-review-fixes` (§13) to act on what it finds.

**Usage**: `/qa-kit:review-tests` plus what to review, e.g. `/qa-kit:review-tests review PR #123` or `/qa-kit:review-tests triage the review comments on PR #123`.

**Output**:
- Findings grouped by severity (Blocking / Should fix / Nit), each with `file:line` and a suggested fix specific enough for `apply-review-fixes` to apply directly
- Naming violations, missing/weak assertions, duplicated logic, oversized files flagged before a human reviewer looks at it
- Feedback triage: each existing PR comment classified as already-addressed / needs-a-code-change (handed to `apply-review-fixes`) / needs-a-reply (summarized for a human)
- A finding that needs a genuinely new file (not an edit to an existing one) is `write-tests` territory - `apply-review-fixes` hands it off explicitly rather than forcing an in-place hack

---

### 5. Execute Tests

**Skill**: `execute-tests` - **Agent**: `test-executor`

**Purpose**: Run tests and classify failures - **strictly read-only**, `allowed-tools` has no `Edit` at all. Never heals on its own; add `--heal` (or ask in plain language to heal/fix) to chain into `heal-tests` (§12) afterward.

**Features**:
- ✅ Executes specific test suites via the real `npm`/`playwright` scripts
- ✅ Analyzes failure patterns (locator, timing, state, API, assertion)
- ✅ **Checks for a gating `beforeAll`/`beforeEach` failure before classifying anything else** - reports one broken hook failing many/all tests as a single root cause, not N separate problems
- ✅ **Groups body-level failures sharing one root-cause locator** into a single reported group - the actual fixing of any of this is `heal-tests`'s job, not this skill's
- ✅ `--heal` chains into `heal-tests` with this run's classification already attached, so healing doesn't need to re-run/re-classify from scratch
- ✅ Reports results to Jira when asked (via `mcp__atlassian__*` - writing back requires Atlassian; `glean_default` is read-only and can't post comments)

**Usage**: `/qa-kit:execute-tests` plus what to run, e.g. `/qa-kit:execute-tests run the smoke suite` (report only, default), `/qa-kit:execute-tests run the smoke suite --heal` (report, then heal via `heal-tests`), `/qa-kit:execute-tests run src/tests/ui/checkout/add-to-cart.spec.ts`.

**Default is `--no-heal`** - a bare "run the tests" request never edits anything unless `--heal` (or its plain-language equivalent) is present. This is deliberately a different default from `heal-tests` (§12, which always heals) and from the `feature-implement` pipeline's Execute stage (§7, which defaults to healing).

See §12 "Heal Tests" for what happens once healing is actually requested.

---

### 6. Fix Lint

**Skill**: `fix-lint`

**Purpose**: Run ESLint/Prettier auto-fix, then manually resolve whatever remains, verified against this repo's real npm scripts

**Usage**: `/qa-kit:fix-lint` (no arguments needed - it operates on the current working tree)

**Output**: `npm run lint`/`format:check`/`typecheck` all passing, with any manual fixes applied via `Edit` and re-verified

---

### 7. Feature Pipeline (parallel, multi-stage, two-phase)

**Workflows**: `${CLAUDE_PLUGIN_ROOT}/workflows/feature-plan.js` (Plan only) and `${CLAUDE_PLUGIN_ROOT}/workflows/feature-implement.js` (Write -> Execute/heal -> Review -> commit -> push-if-authorized), run via the `Workflow` tool in Claude Code or the Node runner elsewhere (see "Running without the Workflow tool"); `feature-deliver.js` is covered in §14

**Two tracks, never mixed** - there are exactly two supported ways to get from a requirement to delivered tests, and from the Write stage onward a feature must stay on one track:
- **Manual track**: `/qa-kit:plan-tests` (standalone skill) -> `/qa-kit:write-tests` -> `/qa-kit:execute-tests` -> `/qa-kit:review-tests` -> `/qa-kit:commit-and-push`/`/qa-kit:create-pr` - see `${CLAUDE_PLUGIN_ROOT}/patterns/usage-examples.md` -> A. Runs directly in your current checkout, entirely interactively. Works one feature at a time; to do several, just repeat it per feature - there's no batch mode, but nothing stops you running it several times in a row.
- **Pipeline track**: `/qa-kit:feature-plan` -> `/qa-kit:feature-implement` (both run as workflows) - see usage-examples.md examples B (one feature) and E (several in parallel). Handles 1-by-1 and N-by-N equally; concurrency is just a matter of how many features you hand it.
- **Where they meet**: neither `/qa-kit:plan-tests` nor `feature-plan` touches git - no worktree, no branch - so the plan file (`qa-kit-artifacts/<slug>-test-plan.md`, gitignored) is the only artifact either one produces, and it is interchangeable: a plan from standalone `/qa-kit:plan-tests` can be handed to `feature-implement` as `{ task, planPath, testType }` exactly like a `feature-plan` one. `feature-implement` is what creates any git state (see "Isolation" below). What you can't do is move a feature between tracks *partway through implementation* - don't hand-write half the tests and then give the plan to the pipeline.

**Why two separate workflows, not one** (within the pipeline track): `plan-tests`'s own `SKILL.md` is explicit that a generated plan must be reviewed/approved by a human before anything gets implemented ("Don't skip this step..."). A workflow cannot pause for a question mid-run, so that approval has to be a real stop between two invocations, not a step inside one continuous script that would otherwise silently blow past it. Run `feature-plan` first, review its output (and the `qa-kit-artifacts/*.md` files it wrote) yourself, then hand only the approved subset to `feature-implement`.

**Isolation**: `feature-plan` creates no git state at all - it only writes `qa-kit-artifacts/<slug>-test-plan.md` into your current checkout (distinct filenames, so parallel plans never collide). Git isolation is decided by `feature-implement`, once per invocation, from the plan count (`ISOLATED` in the script): **one plan** runs directly in your current checkout - on a new `feature/<slug>` branch (`git checkout -b`, or `git checkout` if that branch already exists) if you're on the default branch, or on the feature branch you're already on - with no worktree to create or clean up; **two or more plans** each get their own git worktree and branch, created by the Write stage (`git worktree add <worktreeDir>/<index>-<slug> -b feature/<index>-<slug> <baseRef>` - defaults `../worktrees` and `origin/HEAD`, see "Workflow arguments" above) and reused by every later stage for that feature. The worktree path is a sibling of your repo (e.g. `GIT/worktrees/0-abc-3702`), and it's what actually makes concurrent features safe to run together - different features never touch the same working directory or branch, so there's no file-write collision between them and no cross-feature noise in `review-tests`'s `git diff` (it naturally only ever sees its own branch's changes). Each new worktree also gets the main checkout's gitignored `.env` copied in and the frozen-lockfile install for the repo's package manager (or `installCommand`) run by the Write stage (a fresh worktree has neither, so tests and lint couldn't run); `feature-plan` does none of that, and a single-plan run uses your already-installed checkout. The plan stays in the main checkout's gitignored `qa-kit-artifacts/` either way; the worktree-based Write stage reads it from there by absolute path. What's still **not** isolated yet, deliberately deferred: the target application/environment and test account (`TARGET_ENVIRONMENT_URL`, `TEST_USER_EMAIL`) are shared across every feature and every user running this - per-feature/per-user environment or account provisioning is a later piece of work, not yet built. Until then, don't run this against a shared environment at the same time as someone else without expecting possible cross-talk in app-level state (e.g. cart or order data).

**Concurrency cap**: both workflows default to **3 features in parallel** (`MAX_PARALLEL_FEATURES` in each script, overridable per-run via `args.maxParallel`) - a deliberate starting point, not a measured optimum. Raise it only after reviewing real cost/usage/effects; this is exactly the kind of default that should stay visible in the "Workflow arguments" table above rather than buried in the script. Every workflow exposes it the same way: `--parallel=N` anywhere in the command's arguments.

**Headless policy**: decided once per `feature-implement` invocation from the total plan count, not per-batch - one feature running through it stays **headed** (nothing to contend with, and a human may well be watching that one deliberately-scoped run); several running at once go **headless** (no one's watching any single one of them, and N headed browsers would fight over the same machine). Standalone `/qa-kit:execute-tests` (not through the workflow at all) always stays headed-by-default for interactive debugging.

**Usage** - Phase 1, plan:

```
/qa-kit:feature-plan ABC-3702, qa-kit-artifacts/csv-export-plan.md, "Add a keyboard shortcut to remove the selected cart item"
```

which resolves to this `Workflow` call (the runner builds the same `args`):

```js
Workflow({
  name: 'feature-plan',
  args: {
    features: [
      { jiraKeys: ['ABC-3702'] },
      { planFiles: ['qa-kit-artifacts/csv-export-plan.md'] },
      { descriptions: ['Add a keyboard shortcut to remove the selected cart item'] },
    ],
  },
})
```
Each `features[]` entry's fields are always arrays (`jiraKeys`/`planFiles`/`figmaLinks`/`testrailLocations`/`descriptions`), and can be given in **any order** - classification is by shape, never position. Here each feature happens to have exactly one source, but a single feature can combine several (multiple Jira IDs, a Figma link, a TestRail location override, extra free text, any mix) into one merged plan instead of one plan per source. `testrailLocations` is different from the other four: it's not requirements content, it's an override for `plan-tests`'s TestRail cross-check that **wins over `.qa-kit/project/testrail-mapping.md` entirely** for that plan, even if the mapping file has no entry at all for the `TestFeature`(s) involved - see "2. Plan Tests" above and `plan-tests`'s `SKILL.md` -> Step 3. Any Figma link or TestRail location already embedded in a fetched Jira ticket's own text is folded in too, **in addition to** whatever was given here directly - see `read-ticket`'s "Linked References" output (§1 above). The `/qa-kit:feature-plan` shortcut command exposes multi-source merging as a `--plan <src, src, ...>` divider - see `${CLAUDE_PLUGIN_ROOT}/patterns/usage-examples.md` -> E (one source per feature, the shape above) and F (multiple sources merged into one feature) for exactly what to type for each case.

Returns one entry per feature: `{ task, planPath, testType, blocked?, blockReason?, updated? }` (no worktree or branch yet - `feature-implement` decides that). **Stop here and review** the `qa-kit-artifacts/*.md` plan(s) before continuing.

**Revising an already-planned feature instead of starting fresh**: once new information arrives for a feature this workflow already planned (a Figma link/screenshot that showed up after the ticket was planned, an answer to an `Open Questions`/`<UI-TBD>` item), pass its **unmodified** prior report entry back in via `args.updates` instead of re-running it as a fresh `args.features` entry:
```js
Workflow({
  name: 'feature-plan',
  args: {
    updates: [
      {
        plan: { task: 'ABC-3702', planPath: 'qa-kit-artifacts/ABC-3702-test-plan.md', testType: 'ui' },
        figmaLinks: ['https://figma.com/file/abc123'],
      },
    ],
  },
})
```
This is `plan-tests`'s `--update <path>` flag (see `plan-tests`'s `SKILL.md` -> "Update Mode"), driven through the pipeline: `test-planner` merges the new source(s) into the plan file named by `plan.planPath` in place (only `planPath` is required; blocked if the file is gone), rather than producing a second, disconnected one. `features` and `updates` can be given in the same call (fresh features and revisions run as separate batches, each still capped by `maxParallel`); omit whichever array a given call has none of. The `/qa-kit:feature-plan` shortcut command builds `args.updates` from a `--update <path>, <src, ...>` block, using `<path>` directly as `plan.planPath` - see `${CLAUDE_PLUGIN_ROOT}/commands/feature-plan.md`.

**Usage** - Phase 2, implement (after you've reviewed and picked which plans to proceed with):
```js
Workflow({
  name: 'feature-implement',
  args: {
    plans: [ /* the approved entries from feature-plan's report, unmodified */ ],
    commit: true,   // only if the user's request explicitly asked to commit - omit/false and nothing is committed
    push: true,     // only if the user's request explicitly asked to push - implies commit; omit/false to leave the commit unpushed
    createPr: true,  // only if the user's request explicitly asked for PRs too - implies push
    heal: false,     // only if the user's request explicitly asked to skip auto-healing - omit for the default (heal)
    apply: false,    // only if the user's request explicitly asked for a report-only review - omit for the default (apply)
    level: 'smoke',  // only if the user's request named a level (smoke | sanity | regression) - omit for every level
  },
})
```
Progress renders per-feature, per-phase (Claude Code: `/workflows`; the runner logs each stage): **Write -> Execute -> Review -> Deliver**. Review and Deliver are deliberately separate stages with separate agents (`test-reviewer` and `test-deliverer`) - Review only checks/fixes code quality and lints; it never touches git. Deliver is the only stage that commits, and optionally pushes/opens a PR, and it runs only when the invocation asked for it (see "Delivery is tiered" below).

**Healing is tiered too, same shape as the delivery gate above, decided once per invocation via `args.heal`**:
- **Default (`args.heal` omitted, or `true`)**: the Execute stage heals - `test-executor` invokes `heal-tests` (§12), which itself composes `execute-tests` (§5). This is the default because the pipeline's whole purpose is to hand Review/Deliver passing tests, not raw failures.
- **`args.heal: false`**: the Execute stage only runs and classifies - `test-executor` invokes `execute-tests` (§5) alone, no edits made at all. Review/Deliver still run afterward against whatever passed or didn't; this is for a human who wants to see raw failures before anything touches the branch, not a way to skip the stage entirely.
- The `/qa-kit:feature-implement` shortcut command exposes this as `--no-heal` (see `${CLAUDE_PLUGIN_ROOT}/commands/feature-implement.md`) - `--heal` is accepted too but redundant, since it's already the default.

**Applying is tiered too, exactly the same shape one stage over, decided once per invocation via `args.apply`**:
- **Default (`args.apply` omitted, or `true`)**: the Review stage applies its own findings - `test-reviewer` invokes `review-tests` (§4), then `verify-coverage` (§15, implementation mode, because the Review prompt names the plan), then `apply-review-fixes` (§13) against what they found. Default for the same reason `heal` defaults true - Deliver should receive an already-fixed branch, not a pile of unactioned findings.
- **`args.apply: false`**: the Review stage only reviews and reports - `test-reviewer` invokes `review-tests` (§4) and `verify-coverage` (§15) alone, no edits made at all (a planned scenario with no test still ends the stage `blocked`). A Deliver step (if one was asked for) still commits whatever's on the branch as-is; this is for a human who wants to see findings before anything touches the branch, not a way to skip the stage entirely.
- The `/qa-kit:feature-implement` shortcut command exposes this as `--no-apply` (see `${CLAUDE_PLUGIN_ROOT}/commands/feature-implement.md`) - `--apply` is accepted too but redundant, since it's already the default. Combine freely with `--no-heal` - the two are independent gates, one per stage.

**Level is scoped, decided once per invocation via `args.level`** (so a human can confirm the basics work before spending time and tokens on the rest):
- **Default (`args.level` omitted)**: every scenario in the plan is implemented, exactly as before.
- **`args.level: 'smoke' | 'sanity' | 'regression'`**: the Write stage implements only the scenarios whose `Level:` field in the plan equals that value (exact level, not cumulative - `sanity` does not also write the Smoke ones; the field and its rules are in `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md` -> "Choosing the Level"). Scenarios an earlier run already implemented are skipped, so smoke first and sanity later adds only the delta, on the same `feature/<slug>` branch. `Proposed Support Additions` and `Existing (renamed)` moves are done only when a scenario being implemented needs them. If the plan has nothing left at that level the Write stage reports `blocked` with a reason and nothing is committed.
- Later stages need no filter: Execute, Review and Deliver work on the spec files Write returns. The level is named in the Deliver prompt so the commit message states the scope, and is echoed as `report[].level`.
- The `/qa-kit:feature-implement` shortcut command exposes this as `--level=<level>` (see `${CLAUDE_PLUGIN_ROOT}/commands/feature-implement.md`). One level per run; to cover all three, run them one after another or omit the flag.

**Delivery is tiered, decided once per invocation, never mid-run**:
- **Nothing is committed by default** - with none of `args.commit`, `args.push` and `args.createPr`, the Deliver stage is skipped entirely: the tests stay uncommitted in your checkout (one plan) or in each plan's worktree (several), `report[].committed` is `false`, and the run log names where they are. Review them, then run `/qa-kit:feature-deliver` (§14), which reviews once more and commits, or commit by hand.
- **Commit only if `args.commit: true`** (implied by `push` and `createPr`) - `test-deliverer`'s Deliver step invokes `commit-and-push` (never raw git commands). Committing to an isolated feature branch needs no confirmation; branch, staging and push rules are in `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md`.
- **Push only if `args.push: true`** - otherwise every committed feature branch is left unpushed (`report[].pushed` will be `false`), and you push manually (`cd` into that feature's `worktreePath` from the report - or just stay put if it ran in your current checkout - then `git push -u origin <branch>`) or re-run with `args.push: true` once you've reviewed it.
- **PR only if `args.createPr: true`** (which implies `push`) - Deliver then invokes `create-pr` instead of `commit-and-push` directly (it composes `commit-and-push` internally, so only one of them runs, never both). `create-pr` is not an unconditional "never in a pipeline" rule - it runs inside `feature-implement` only when that specific invocation was explicitly authorized to do so, the same shape as the push gate one level up.

**What `feature-implement` records, and why its own Deliver stages a list and not "everything"** (`feature-deliver` does deliver everything git shows, see below): a run that does not commit leaves its files uncommitted, so `git status` alone cannot tell the pipeline's files from yours. Every report entry therefore carries `ownedFiles`: each path the pipeline created or changed on that branch (Write's `filesWritten` and `specFiles`, Execute's and Review's `filesChanged`, plus the files of earlier runs on the same plan, carried forward). The next `feature-implement` run on the same plan receives them as `priorOwned` (the runner reads `qa-kit-artifacts/latest/feature-implement.json`; Claude Code passes the conversation's report entry), subtracts them from its baseline and continues from them, which is what makes "smoke, then sanity, then deliver" work without committing in between. Review never edits a baseline path. In `feature-implement`, Review is limited to `ownedFiles` and Deliver stages **exactly** `ownedFiles` that still show changes, one `git add -- <path>` each; anything else that shows changes is left unstaged and returned as `skippedPaths`, so nothing is left out silently, and a commit on that branch containing a file outside `ownedFiles` is a safety violation (exit code 3). `feature-deliver` delivers **everything git shows as changed in the project folder** (modified, deleted, renamed, staged, and new files that are not ignored): the pipeline's files, anything the person changed or added by hand to close a gap, a file that was already modified before the implement run, and files that are not tests. Running it is the request to deliver what the person has changed. Only git's own ignore list and the staging safety rules leave anything out (a secret file stops the target; another package manager's lockfile is skipped and returned as `skippedPaths`). Every staged path that is not in `ownedFiles` is reported as `handChanges`, named in the commit message, and the runner prints a warning naming it; that is a warning, not a violation. Review reviews and fixes the test and support files among them like the rest, reports findings in a pre-existing change without editing it, and leaves other kinds of file untouched. With no recorded run (a fresh Claude session, `feature-deliver` on the current-checkout fallback) there is no list: earlier files count as the user's, Deliver takes the outstanding test changes minus any baseline, and the report's `scope` says "no recorded run".

This is the real confirmation gate for pipeline use: a mid-script interactive prompt isn't possible, so the human decision has to happen either up front (`args.commit`/`args.push`/`args.createPr` on the call that launches the run) or after the fact (reviewing the uncommitted tests, then running `feature-deliver`, or reviewing an unpushed commit and pushing/PR-ing it manually) - never silently skipped, and never silently assumed.

**Report shape**: every entry carries `task` (which feature), `level` (the `args.level` given, absent when every level ran), `branch`, `stage` (last stage that ran), `agent` and `skill` (which agent/skill produced that stage's result - `skill` is `heal-tests` or `execute-tests` for the Execute stage depending on `args.heal`, `apply-review-fixes` or `review-tests` for the Review stage depending on `args.apply`, and `commit-and-push` or `create-pr` for the Deliver stage, whichever actually ran), `blocked`/`blockReason`, `lintClean`, `coverageGaps` (planned scenarios the Review stage's coverage check found missing or weak; a missing one also makes the entry `blocked`), `ownedFiles` (every path the pipeline produced on the branch), `handChanges` (feature-deliver only: files the person changed or added by hand that Deliver included, whatever their kind), `skippedPaths` (changed paths Deliver left unstaged: not produced by the pipeline in `feature-implement`; in `feature-deliver` only what a staging safety rule refuses, such as another package manager's lockfile), `planPath`, `committed`, `pushed`, `prUrl` (if a PR was created), and a full `history` array (one record per stage actually run) - enough to tell at a glance not just *that* something happened but *which* agent/skill/stage it happened at.

**Failure handling**: each stage retries once on a transient failure (an `agent()` call that errors or returns nothing) before giving up; giving up records an explicit `blocked`/`blockReason` (e.g. "write failed twice...") through the same mechanism as an intentional escalation, rather than the feature silently vanishing from the report. A stage that was already blocked short-circuits every later stage for that feature instead of cascading into an unrelated crash. The Plan stage's `blockReason` can come from either path - a genuinely transient retry-exhaustion, or `test-planner` intentionally reporting a blocking MCP dependency it couldn't resolve (see "Scope note" below) - the reason text itself says which, since the schema doesn't distinguish them structurally.

**Scope note**: the Plan phase still depends on either the Atlassian MCP or, as a read-only fallback, `glean_default` being authorized locally for a feature whose `jiraKeys` can't be backed up by any other source (same for Figma on a `figmaLinks`-only feature) - a feature with any `planFiles`/`descriptions` entry works regardless, even alongside `jiraKeys`/`figmaLinks` that fail. Blocking versus optional follows `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md`: a feature blocks only if *every* given source fails to resolve, and `test-planner` reports it as `blocked`/`blockReason` (see "Report shape" above) so it surfaces for a human to resolve (authenticate a server, or re-run that one feature with a `planFiles`/`descriptions` entry added instead), rather than producing a thin plan or vanishing from the report. TestRail is the one optional dependency in this phase.

**Lint is checked at every stage, not just at the end, and scoped to what changed**: `test-writer` runs `fix-lint` on what it wrote, `test-executor` runs it on whatever it healed, and `test-reviewer`'s Review step runs it again - but only if the review itself changed something, and always scoped to the specific files touched, never a whole-repo pass (see `fix-lint`'s "Scoped vs. whole-repo"). This is deliberate: a whole-repo lint pass on every stage of every feature would be redundant work.

**When healing or reviewing needs `write-tests`**: `test-executor` (healing) and `test-reviewer`'s Review step (review fixes) can each hit a fix that's beyond what their `Edit`-only tool access can do - a missing Page Object method, a new fixture, a genuinely new file. Neither has the `Write` tool, and neither invokes `write-tests` itself inside the pipeline - that boundary is deliberate. Instead they return a `blocked`/`blockReason` result, same mechanism as any other escalation, collected into one consolidated question after all features finish. The follow-up is manual: re-run `write-tests` on the specific gap, then re-invoke `feature-implement` for that one plan.

---

### 8. Write Commit Message

**Skill**: `write-commit-message`

**Purpose**: Draft a commit title/body from the real diff - Conventional Commits, with a bracketed ticket-ID prefix when the branch name has one (`[ABC-936] feat(checkout): ...`), title <=72 characters, ending with the AI co-author trailer only when the environment specifies one (otherwise none). Never stages, commits, or pushes - output only. Single source of truth for message format, composed by both skills below instead of each drafting their own.

**Usage**: `/qa-kit:write-commit-message` - no arguments needed, reads the real `git diff`/`git status`/`git log`.

---

### 9. Commit and Push

**Skill**: `commit-and-push`

**Purpose**: Commit the specific changed files (message via `write-commit-message` unless one was given), then push - with a confirmation gate before the push, not the commit. Branch, staging, upstream and force-push rules are in `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md`.

**Usage**: `/qa-kit:commit-and-push` or `/qa-kit:commit-and-push "custom message"`.

**Push confirmation**: interactive by default (asks "push to origin/`<branch>`? y/n"). The one exception is being invoked by `test-deliverer`'s Deliver step inside `feature-implement` or `feature-deliver`, which passes through whether push was pre-authorized for that run (see "7. Feature Pipeline" -> "Delivery is tiered") instead of asking - there's no one to ask mid-pipeline-run.

---

### 10. Create Pull Request

**Skill**: `create-pr`

**Purpose**: Runs a mandatory self-review gate (`review-tests` + `apply-review-fixes` against its own branch - see `${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md`'s "PR Review SLA" note), commits/pushes via `commit-and-push`, detects the repo's real default branch live (per `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md`), drafts a PR title/body (including a one-line self-review confirmation), confirms, then `gh pr create`.

**Usage**: `/qa-kit:create-pr` or `/qa-kit:create-pr "commit message" "PR title"`.

**Human-triggered by default, pipeline-usable only when explicitly authorized**: standalone use always confirms before both the push and the PR. Inside `feature-implement`'s Deliver stage, it only runs at all when that invocation was launched with `args.createPr: true` (see "7. Feature Pipeline") - never as a default, never inferred, and it skips its own confirmations only because that flag *is* the human's explicit authorization.

---

### 11. Discover Locator

**Skill**: `discover-locator`

**Purpose**: Own the one live-DOM-inspection procedure this repo uses to find a working locator, and the canonical "Locator Strategy Priority" tier order behind it (defined in this skill's own `SKILL.md`) - navigate to the target state, snapshot/inspect, try candidates in that order - so `write-tests` and `heal-tests` compose this skill instead of each keeping their own copy of either the procedure or the tier order. Never writes a locator into a file itself; only reports what resolved (and its strength tier), or what was tried and didn't.

**Usage**: `/qa-kit:discover-locator find a selector for the Place order button in the checkout summary` - useful standalone for ad hoc exploration without writing or running anything. Otherwise composed automatically: by `write-tests` (§3) at authoring time when the target state is reachable, and by `heal-tests` (§12) during locator healing.

**Output**: a locator string + tier, or a report of what was tried and why nothing resolved (including a "systemic gap" call-out if a whole Page Object's identification scheme is missing, not just one target).

---

### 12. Heal Tests

**Skill**: `heal-tests` - **Agent**: `test-executor`

**Purpose**: Compose `execute-tests` (§5) for the run/classification, then fix what it finds - locator (via `discover-locator`, §11), timing, state, and API issues, deduped by root cause, with a full regression re-run before reporting done. This is where the actual editing happens.

**Features**:
- ✅ Resolves any gating `beforeAll`/`beforeEach` failure first, re-running the whole originally-requested scope via `execute-tests` before touching any individual test body
- ✅ Heals one root-cause unit at a time (one shared Page Object method/locator, not per test)
- ✅ Applies fixes directly to the affected file (via `Edit`), runs `fix-lint` on what it touched, and re-runs via `execute-tests` to confirm
- ✅ **Final regression re-run of the whole original scope** after all heals, before reporting anything done
- ✅ Hands off to `write-tests` (report-only standalone, `blocked` inside the pipeline) when a fix needs more than a locator/wait swap
- ✅ **Asks user for guidance** when auto-healing fails
- ✅ Always heals - if you don't want anything fixed, use `execute-tests` (§5) alone instead

**Usage**: `/qa-kit:heal-tests` plus what to run and heal, e.g. `/qa-kit:heal-tests fix the smoke suite`, or implicitly via `/qa-kit:execute-tests run the smoke suite --heal`.

**Healing Patterns**:
1. **Locator Issues** - via `discover-locator`; ask the user when nothing resolves ("Cannot find element X. Suggested alternatives: A, B, C. Which should I use?")
2. **Timing Issues** - replace hardcoded/failing waits with the matching `WaitHelpers` method
3. **State Issues** - fix `beforeEach`/`afterEach` cleanup, check for cross-test isolation issues
4. **API Issues** - same runner/reporting as UI, no browser involved; 5xx/network -> check environment health, don't retry blindly; unexpected 4xx -> usually a stale `API_ENDPOINTS` constant/missing auth/bad factory payload; response shape mismatch -> confirm it's not a real regression before healing

---

### 13. Apply Review Fixes

**Skill**: `apply-review-fixes` - **Agent**: `test-reviewer`

**Purpose**: Act on `review-tests`' (§4) findings - Blocking/Should-fix edits via `Edit`, `fix-lint` scoped to what changed, then a confirming re-run via `execute-tests` (report-only - a review fix breaking a test is a signal to reconsider it, not something to heal around). Never re-runs the checklist itself, and never touches a PR/branch that isn't the one being actively worked on.

**Usage**: `/qa-kit:apply-review-fixes review PR #123 and apply what you find` works as one command - if no findings for that target exist yet in the conversation, it invokes `review-tests` itself first, then applies them. If `/qa-kit:review-tests` already ran in this conversation (e.g. you wanted to see findings before deciding), `/qa-kit:apply-review-fixes` reuses those instead of re-reviewing. Chain works in either direction - whichever skill you call first, the checklist still only runs once.

**Output**:
- File:line list of what changed, whether lint is clean, whether the confirming re-run passed
- A finding that needs a genuinely new file is handed off to `write-tests` explicitly, rather than forced through `Edit`

**Note**: This is the skill `test-reviewer`'s Review mode invokes by default when self-reviewing its own pipeline branch (never someone else's PR) - see `${CLAUDE_PLUGIN_ROOT}/agents/test-reviewer.md`. Pass `--no-apply` (or say "report only") to keep `test-reviewer` at `review-tests`' findings without acting on them, even on your own branch. Inside `feature-implement`, this is `args.apply` (see §7 "Feature Pipeline" -> "Applying is tiered too") - the workflow-level `--no-apply` reaches the same agent-level flag, it isn't a separate concept. `feature-deliver` (§14) uses this same flag, plus one addition this skill itself doesn't do: a confirming `review-tests` re-review after a fix actually changes something.

---

### 14. Feature Delivery

**Workflow**: `${CLAUDE_PLUGIN_ROOT}/workflows/feature-deliver.js` (Review with a confirming re-review -> Deliver) - **Command**: `/qa-kit:feature-deliver` - **Agents**: `test-reviewer` (Review), `test-deliverer` (Deliver)

**Purpose**: The "deliver on demand" step after §7's pipeline - Review (§4 + §13) and Deliver (commit/push/PR) only, for tests that are already written. Running it is the request to deliver, so unlike `feature-implement` it always commits. Exists for exactly these situations: the default `/qa-kit:feature-implement` run (no `--commit`/`--push`/`--pr`) left the tests uncommitted for you to look at first; a prior `--no-apply` run left findings unresolved; a prior run committed but was never pushed/PR'd; or a branch was written or fixed by hand outside the pipeline entirely.

**Not to be confused with**: §7's "Deliver" is a *stage name* inside `feature-implement.js`. `feature-deliver` is a separate whole `Workflow` script that reuses the same Deliver stage logic (same agent, same `commit-and-push`/`create-pr` skills) after its own Review stage.

**What's new here, not present in §4/§13**: a confirming re-review loop. If the Review stage's `apply-review-fixes` call changes any file, `test-reviewer` invokes `review-tests` one more time against the same branch to confirm no Blocking/Should-fix findings remain, before Deliver is allowed to run. If `apply-review-fixes` changed nothing, the re-review is skipped entirely (pure redundancy otherwise). If the confirming pass still finds an unresolved finding `apply-review-fixes` couldn't auto-resolve (e.g. it needs a new file - `write-tests` territory), the target is reported `blocked`/`blockReason` instead of letting Deliver commit a known-broken branch. The loop lives entirely in `feature-deliver.js`'s Review-stage prompt and the matching conditional clause in `${CLAUDE_PLUGIN_ROOT}/agents/test-reviewer.md`'s Review mode, which only fires when a prompt explicitly asks for it. `feature-implement.js`'s Review stage never asks for it, so its behavior is unaffected.

**Flags**: see "Workflow arguments" above (`--push`, `--pr`, `--parallel=N`, `--apply`/`--no-apply`, `--agent-prefix`; `--commit` is accepted but redundant because this workflow always commits). No `--heal` - there is no Execute stage in this workflow.

**Target input and resolution**: `args.targets = [{ task, branch, worktreePath, baselineChanges?, ownedFiles? }, ...]` - the same fields `feature-implement`'s report entries carry; `ownedFiles` (every path the implement run produced) is where Review and Deliver start; Deliver also takes everything the person changed since or before (reported as `handChanges`, see "What `feature-implement` records" above), and `baselineChanges` (paths modified before that run started) is passed on so Review never edits them, and is absent for the current-checkout fallback (`worktreePath` is the current checkout itself when that run had a single plan). The `/qa-kit:feature-deliver` command resolves these in order: (1) a named target in `$ARGUMENTS` matched against a prior `feature-plan`/`feature-implement` report entry already visible in this conversation, by `task` or `branch`; (2) if none named, every such entry found in this conversation; (3) if the conversation has no such entries at all, a single implicit target - the current branch (`git branch --show-current`) and the current working directory - the same spirit as `/qa-kit:create-pr` already working standalone on "whatever's currently changed in your checkout" (see Usage Examples -> M). An implicit target from tier 3 has no `task`; `report[].task` will be `undefined` for it, same tolerance `feature-implement.js` already has for optional fields.

**Expect a second review when `--pr` is used**: Deliver's `create-pr` invocation composes its own self-review gate (`apply-review-fixes` -> `review-tests`, skipped only if findings for that exact diff target already exist in the *same conversation* - see §10 and `create-pr`'s `SKILL.md` Step 2). Review and Deliver run as separate agent calls, each with a fresh context, so the Deliver agent does not see the Review agent's findings and will normally run a real (cheap, because the branch was just fixed) `review-tests` pass before opening the PR. That is intended: the PR gate never trusts a previous stage's claim. The same applies to `feature-implement --pr`. `test-deliverer` has no edit tool, so if that gate still finds a Blocking/Should-fix finding it reports `blocked` instead of fixing it: run `feature-deliver` (its Review stage applies fixes) and then deliver again.

**Usage**: see Usage Examples -> N-Q for worked commands (deliver what `feature-implement` left uncommitted, reuse prior targets with `--push`/`--pr`, and the cwd-fallback standalone case).

**Known limitations of delivery and coverage** (decided, not forgotten):
- `feature-deliver` does not check that the branch checked out in `worktreePath` is the target's branch. After switching branches in the current checkout, check the target branch out again before delivering.
- A bare `feature-deliver` takes every unblocked entry of the latest `feature-implement` report, including work already committed by `--commit`. Name the branch, or run `feature-implement` again, to avoid delivering the same work twice.
- The scenario-to-test mapping is computed by `verify-coverage` in each Review stage and shown in its report only; it is not stored. `feature-deliver` has no plan, so it does not run the coverage check.
- `feature-deliver` delivers everything git shows as changed, so unrelated work in progress in the same project folder goes into the commit (and, with `--push` or `--pr`, onto the remote). Check `handChanges` and the runner's warning, or stash what does not belong, before running it with `--push` or `--pr`.
- Worktrees from multi-plan runs are never removed by the kit.

---

### 15. Verify Coverage

**Skill**: `verify-coverage` - **Called by**: `plan-tests` (plan mode), `test-reviewer` (implementation mode)

**Purpose**: One read-only question answered with evidence: "is this already tested, and do the tests we wrote match the plan?" It never edits, never touches git and never writes to TestRail.

**Plan mode** (inside `feature-plan` and `plan-tests`): compares each candidate scenario with the repo's existing specs, and with TestRail cases when `plan-tests` already fetched them, and marks it `duplicate`, `partial` or `new`, each with `file:line` and test title (or TestRail ID) as evidence. `plan-tests` then removes a `duplicate` from Test Scenarios only with a row in Existing Coverage, keeps a `partial` with a Description that names the test it extends, and keeps a `new`. Planning stays read-only: the verdicts only end up in the plan file under `qa-kit-artifacts/`.

**Implementation mode** (the `feature-implement` Review stage): the Review prompt names the approved plan (and the level, for a `--level` run); `test-reviewer` runs it right after `review-tests` and maps each plan scenario to a written test by its `Test` name, then by steps and Expected Results (generated titles never carry `TC-NNN`). Results: **missing** scenario = Blocking, needs `write-tests`, so the stage reports `blocked` and `report[].coverageGaps` lists it; **weak** (an Expected Result not asserted) = Should fix, applied by `apply-review-fixes`; **duplicate of an existing test** = Should fix; **extra** test = Nit. `feature-deliver` has no plan, so it does not run this check.

**Usage**: `/qa-kit:verify-coverage plan qa-kit-artifacts/ABC-3702-test-plan.md` or `/qa-kit:verify-coverage implementation qa-kit-artifacts/ABC-3702-test-plan.md level=smoke`.

---

### 16. Triage Failure

**Skill**: `triage-failure` - **Agent**: `test-triager` - **Called by**: a person (`/qa-kit:triage-failure`, or the agent directly); a CI step could call it later

**Purpose**: Take a failed Allure report and advise what each failure group is, since when it has been failing, whether it is already filed and what to do next. Not a pipeline stage: it has no workflow or command wrapper. Scope is deliberately small and post-run (the failed tests of one report, from CI, a nightly or a dispatch); running and healing whole sets of specs while tests are written stays with `test-executor` in `feature-implement`.

**Input**: a report URL (Allure 2, `<environment>/<run number>/` as `actions/allure-archive` publishes it), a local generated report, or a local `allure-results` folder. A private Pages site that cannot be fetched without credentials falls back to downloading the run's `allure-results-*` artifact with the person's own `gh` login. Nothing asks for a token; if nothing is readable the result is `blocked` with what to provide.

**Flags**: `--known=<keys or JQL>` (Jira bugs, stories and epics to cross-check the failures against), `--heal` (heal the `test-fix` groups, off by default; `--triage-only` is the default spelled out), `--no-retest`, `--from=<triage.json>` with `--groups=g1,g2` (continue from an earlier result without fetching or retesting again).

**What it does**: extracts the failed tests and their earlier results, groups those sharing a root cause (`g1`, `g2`, ... stable ids), computes the failure history per group (new, constant or intermittent; consecutive failures; first failed in; same error as before), reads the `--known` issues, retests **only** the failed tests plus what they depend on (their Playwright project's `dependencies`, their serial `describe` block, their gating hook), checks live whether a missing element moved or is gone (read-only), and gives each group one verdict with a confidence, the reasons, the alternative ruled out and next actions. Verdicts are advice from evidence, not facts.

| Verdict | Meaning | Next action |
|---|---|---|
| product-bug | The product is wrong, the test is right | Ticket draft |
| known-issue | Strong match to an open bug | Nothing to file; suggested comment text |
| deviation | The product changed on purpose, the expectation is outdated | Confirm with the story, update the expectation (never auto-healed) |
| product-gap | The capability does not exist yet | Link the story, `test.fixme` or wait |
| test-fix | The test needs tuning (locator, timing, state, data) | `--heal` or `/qa-kit:heal-tests <spec>` |
| flaky | Passed on retest | Stability follow-up is the person's call |
| environment | Infrastructure, service, data or config | Check health first, no ticket |
| unverified | Could not be decided | Says what is missing |

History and known issues move verdicts: a failure that is new, with a related story resolved just before it, points to a deviation or regression; a constant failure with the same error and no ticket is flagged "long-standing, never reported"; a strong match to a resolved bug that fails again is a regression candidate; an open bug whose test passes is noted as possibly fixed.

**Output**: on screen, the final message is the report (counts, then one block per group with what, why, history, what was ruled out and next action, then the copy-pasteable next actions), so the session can continue from it ("heal g4"). On disk, `qa-kit-artifacts/triage/<slug>/` holds `triage-report.md`, `triage.json` (per group: verdict, confidence, why, alternatives, tests, evidence, history, next actions, heal result) and one `ticket-<n>-*.md` per product-bug group.

**Healing (`--heal`)**: only `test-fix` groups, through `heal-tests`; a spec file with uncommitted changes is never touched (its group is `blocked`); a question `heal-tests` would ask becomes `needs-human`; the healed scope is re-run once; healed files stay uncommitted for `/qa-kit:feature-deliver`. CI should run triage-only and keep `triage.json`; a person then heals locally with `--from`.

**Hard limits**: it never creates, edits, transitions or comments on a Jira issue (read-only `get`/`search`/`lookup` Atlassian tools and Glean `search`/`read_document` only), never changes git state, never edits anything without `--heal`, asks no questions and never asks for a token. The retest runs on the machine and environment configured locally, which the report states next to the report's own environment.

**Usage**: `/qa-kit:triage-failure https://<pages-host>/<environment>/<run-number>/ --known=ABC-12,ABC-40`, `/qa-kit:triage-failure ./allure-results --no-retest`, `/qa-kit:triage-failure --from=qa-kit-artifacts/triage/<slug>/triage.json --heal --groups=g4`.

---

### 17. Monkey Test

**Skill**: `monkey-test` - **Agent**: `test-monkey` - **Workflow**: `feature-monkey` - **Called by**: a person (`/qa-kit:monkey-test` for one area in the current conversation, `/qa-kit:feature-monkey` for one or several areas through the pipeline or the runner)

**Purpose**: Find what the scripted tests do not by exploring one area of the running app like a curious, slightly hostile tester, through the Playwright MCP tools. It reads the repo's plans and tests as the oracle for expected behavior and as the map of what is already covered, uses `.env` for the target URL and test account, creates only its own prefixed data and removes it again, and reports what it did and found.

**Understand first, monkey later**: for every page (a scope: a route, or a modal or tab that takes over) it first builds an understanding card from the conventions, the matching plan scenarios, the 1 to 3 best matching existing tests and a read-only look at the UI (one snapshot, console and network baseline). Cards live on disk (`qa-kit-artifacts/monkey/<slug>/pages/`) and are cached (`_cache/`, reused only when the source files are unchanged, the card is under 7 days old and the UI fingerprint still matches), so the context stays small: on a scope change the page's exit note is written to its card and the next page's card is re-read by need. In the workflow every page unit is a fresh agent call that starts from the cards and `monkey-state.json` only.

**Who owns what**: the workflow script owns the clock (it starts a unit only while wall-clock budget is left and sets each call's timeout), the skill owns the limits (production refusal, deny-list, ledger-only deletes, redaction), and the runner's guard checks afterwards that git and the `.env` file did not change. A unit is never retried, because it may already have created data; the Finalize stage sweeps the cleanup ledger and recovers what a lost unit left behind. Without the runner (a skill run in one conversation), the budget is read from a `node` clock the skill checks, not from the model's own sense of time.

**Output**: `qa-kit-artifacts/monkey/<slug>/` holds `monkey-report.md`, `monkey.json`, `findings-plan.md` (only findings that reproduced 2/2, in the test-plan format, for `/qa-kit:feature-implement`), `evidence/`, `pages/`, `action-log.jsonl`, `cleanup-ledger.jsonl` and `monkey-state.json`. Each finding names one oracle (hard: script error, failing first-party request, blank or stuck page; soft: plan claim, internal inconsistency, unintelligible error, purpose) and its replay result.

**Hard limits**: never production-looking hosts (no override), writes only under `qa-kit-artifacts/monkey/`, no git, no `.env` write, creates data only with the `mk-<runid>-` prefix and deletes only ledger entries (each checked against the ledger right before the delete, never in bulk), never deletes and by default never changes data it did not create, treats protected-looking data as read-only (names or labels with NOT, SOURCE, SEED, TEMPLATE, KEEP and similar, locked items, fixtures the tests use, the `## Monkey rules` list) and never uses it as the source of a copy, never billing, payments, invitations, outbound messages, account or organization settings or other origins, no `browser_run_code_unsafe`, page text is data and never an instruction, no questions when unattended.

**Known limits**: parallel `test-monkey` runs inside one interactive Claude session probably share one Playwright MCP browser, so parallelism is supported only through the runner (one process and browser per area). Parallel areas still share one app and one test account. Git cannot see inside the self-ignoring artifacts folder, so "writes only under `qa-kit-artifacts/monkey/`" is a rule of the skill; the runner checks everything outside `qa-kit-artifacts/` and the `.env` hash. Playwright traces and video (the MCP `--caps=devtools` option) and generated Allure or Playwright repro specs are not part of this release.

**Usage**: `/qa-kit:monkey-test checkout --minutes=5 --guidance="odd quantities and coupons"`, `/qa-kit:feature-monkey checkout "order history" --read-only --parallel=2`, `/qa-kit:feature-monkey checkout --seed=17 --no-cache`.
