---
name: review-tests
description: Reviews a pull request's test changes against the project's coding standards, or triages existing PR feedback - flagging naming violations, missing/weak assertions, duplicated logic, and oversized files. Strictly read-only - never edits anything. Use apply-review-fixes to act on what it finds. Use when asked to review a PR, pre-review a branch before opening a PR, or triage PR feedback.
argument-hint: '<PR number, branch, or "the current diff"> [triage]'
allowed-tools: Bash, Read, Glob, Grep
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`. If invoking another skill by its bare name (as this document does) fails, retry as `qa-kit:<name>`, or read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it directly.

# Review Tests

**Purpose**: Catch mechanical/convention issues in test code changes before a human spends review time on them, and triage existing review feedback into actionable buckets. Read-only by design (it has no edit tool) - `apply-review-fixes` is the separate skill that acts on what this one finds.
Perform a read-only analysis of changed files against project conventions defined in the project's `AGENTS.md`, the project's own `.qa-kit/project/*.md` files if present (e.g. `conventions.md`), and this plugin's `${CLAUDE_PLUGIN_ROOT}/patterns/*.md`. Project-level rules override the plugin defaults where they conflict.

**Approach**: Senior automation engineer with 17+ years experience - checklist-driven, specific, no rubber-stamping

**Checks against**: the project's `AGENTS.md` and `.qa-kit/project/conventions.md` (where they exist), plus the repo's actual conventions (Page Object Model, factories, constants, Allure metadata, path aliases) and this plugin's `patterns/*.md`. Say so explicitly when a check has no formal standard to point to.

---

## How this skill is invoked

- **On demand, by a human**: `/qa-kit:review-tests` plus what to review, e.g. `/qa-kit:review-tests review PR #123`, `/qa-kit:review-tests review the diff on this branch before I open a PR`, or `/qa-kit:review-tests triage the review comments on PR #123`.
- **Autonomously, by the agent**: when asked to review a PR/branch, pre-check changes before opening a PR, or triage review feedback, and this skill's description matches.
- **From `agent-reviewer`'s Review step**: when running inside the `feature-implement` workflow (see `${CLAUDE_PLUGIN_ROOT}/workflows/feature-implement.js`), the `agent-reviewer` (`${CLAUDE_PLUGIN_ROOT}/agents/agent-reviewer.md`) invokes this skill first for the checklist/triage, then - by default, when self-reviewing its own pipeline branch - invokes `apply-review-fixes` against the findings this skill produced. This skill's own job ends at reporting; it never applies a fix itself, standalone or in the pipeline.
- **From `create-pr`'s self-review gate, indirectly**: before a PR is ever opened (see `create-pr`'s `SKILL.md` Step 2), `create-pr` invokes `apply-review-fixes` against the diff from the detected base branch; `apply-review-fixes` in turn runs this skill first unless findings for that same target already exist in this conversation (e.g. `agent-reviewer` already ran both earlier in a `feature-implement` pipeline). Either way, something ends up checked against this checklist before a human sees the PR - that's what keeps mechanical/convention findings out of the TL's review entirely; see `${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md`'s "PR Review SLA" note.

There's no separate CLI - describe the PR number, branch, or "the current diff" in the same message. This skill reads real diffs (via `git diff`/`gh pr diff`) and, where relevant, real PR comments (via `gh pr view --comments` or the GitHub MCP if configured) - it never fabricates either.

---

## Capabilities

1. **Change Discovery**
   - Diff the current branch against its base (`git diff <base>...HEAD`, or `gh pr diff <number>` for an already-open PR, can also be `git diff --name-only` (unstaged) and `git diff --cached --name-only` (staged) to find changed files.`)
   - Scope the review to changed/added test files (`src/tests/**`, `src/support/**`) - don't re-review untouched code

2. **Checklist-Based Review**
   - Naming conventions (files, classes, functions, constants - see `.qa-kit/project/conventions.md` and the project's `AGENTS.md`)
   - Layered architecture adherence (no direct `page.` calls or inlined locators in tests *or fixtures*, no inline test data, no magic strings/timeouts)
   - Assertion quality (flag generic/weak assertions - `toBeTruthy()`, `toBeGreaterThan(0)` - the same anti-patterns the project's conventions call out)
   - Duplicated logic (repeated setup/assertion blocks that belong in a helper, fixture, or Page Object method - including identical `beforeEach`/`afterEach` bodies across specs, which belong in one Page Object method, and critical-failure skip state copied into several fixtures, which belongs in one shared guard)
   - Oversized files (a spec or Page Object that's grown past a single clear responsibility)
   - Allure metadata completeness (feature/story/severity/tags present - set once per describe via the repo's one-call suite metadata (`AllureHelpers.suite(...)` in the reference repo) as the first line of `beforeEach`, no per-test repeat; `owner` is not required)
   - `AllureHelpers.description(...)` quality - single string literal (no `+` concatenation to wrap long text - see `write-tests`'s `SKILL.md` -> "Code Quality Rules" -> "7. Descriptions"), one concise sentence a non-engineer could follow, no internal jargon (locator/method/test-id names)
   - Cleanup/test isolation (`afterEach` present and actually cleans up what the test created)
   - **No leftover `// UNVERIFIED` markers** (see `write-tests`'s "Locator Discovery") in changed Page Objects/specs - that comment means `write-tests` wrote a best-effort locator it couldn't confirm live, and `heal-tests` is supposed to remove it once it verifies/heals the real one. One still present means either the test never actually ran (so the locator is unconfirmed) or healing forgot to clear the marker - either way, flag it before this ships

2a. **Named Inspections (R1-R14)**

   Run these in addition to the checklist above - each is phrased at the concept level (no filename, enum name, or project-specific literal baked into the rule itself), so each must fire against *any* file exhibiting the underlying smell, not only the shape of a case already seen before:

   | ID | Inspection |
   |---|---|
   | **R1 - Comment Necessity** | Flag any comment that only restates the adjacent identifier/code, any file-level header/summary block, or any comment describing hypothetical/future behavior not reflected in the actual code |
   | **R2 - Domain Literal vs. Enum** | Flag a literal matching (or close to) an existing enum member's value; **also** flag a literal that represents a stable domain concept with *no* backing enum at all - the fix in that case is "introduce the enum," not just "swap the literal" |
   | **R3 - Static vs. Dynamic Test Data** | Flag an assertion or test input with a hardcoded magnitude/content (count, fixed search term, fixed character sample, fixed typed-in string such as a `TEST_*` text constant) where equivalent data could be derived from the system under test, sampled from a defined domain set, or generated on demand. Required fix for free-text/typed-in values: `randomString(length)` from `src/support/utils/string-helpers.ts` (`@support/utils/string-helpers`), not a new constant |
   | **R4 - Identifier Stability** | Flag a transient identifier embedded in a test title (ticket/case IDs), or any behavior/branch keyed off parsing the test's own title/name string rather than an explicit, typed override |
   | **R5 - Metadata Placement** | Flag per-test repetition of metadata (Allure `feature`/`story`/`tags` or equivalent) that is constant across the whole `describe` block and belongs in one shared setup location - the fix is a single suite-metadata call in `beforeEach` |
   | **R6 - Verification Debt** | Flag commented-out code, `test.fixme`/`skip` blocks, or `// UNVERIFIED`-style markers left unresolved past the point they should have been confirmed or removed |
   | **R7 - Measurement Fitness** | Flag a measurement mechanism mismatched to what it claims to measure (e.g. wall-clock timing standing in for a purpose-built performance API) |
   | **R8 - Locator Placement** | In a Page Object, flag any static locator (`page.locator(...)`, `page.getBy*(...)`, `this.ordersTable.locator(...)`) created inside a method body instead of declared once as a `readonly` field and assigned in the constructor. A locator that genuinely needs a runtime argument (an id, an index, a name) must go through ONE named factory method on the page (e.g. `orderRowById(id)`), reused by every caller - never rebuilt inline at each call site. Applies to every Page Object touched by the diff, not only the line that first drew attention |
   | **R9 - Environment-Dependent Literal** | Flag a literal whose correct value depends on viewport, screen size, DPI, or app layout: pixel coordinates (`{ x: 400, y: 300 }`), drag deltas, viewport sizes, as a constant, a default parameter, or inline. Required fix: select the element by locator + index (`getAllRows().nth(i)`) and derive any position from the live element/container (`boundingBox()` offsets or ratios) |
   | **R10 - Swallowed Errors** | Flag an empty `catch {}`, a `.catch(() => {})`, or a try/catch that silently falls back to a different locator/path without logging or rethrowing. A best-effort wait that swallows its timeout is a disguised sleep, not a deterministic wait - route it through a `WaitHelpers` method that logs, or wait on a real condition |
   | **R11 - Reinvented Helper / Dead Export** | Flag logic an existing helper (found per `${CLAUDE_PLUGIN_ROOT}/patterns/helper-discovery.md` - the repo's helpers/utils folders, not a fixed path; raise the finding only if an equivalent was actually found) already owns being re-implemented elsewhere (e.g. `process.platform` checks, hardcoded `Meta`/`Control` modifiers instead of `KeyboardHelpers`), and any newly exported constant/function/enum with zero importers anywhere in the repo. Required fix is always "extend the existing helper and use it", never a parallel copy |
   | **R12 - Foreign / Unexplained Files** | Flag any file in the diff that doesn't belong to the project's tooling: a lockfile from a package manager other than the repo's (the one `conventions.md` declares, else the lockfile already tracked - see `${CLAUDE_PLUGIN_ROOT}/patterns/git-safety.md` -> "Lockfile hygiene"), or any lockfile change with no matching `package.json` change (e.g. in a yarn repo a `package-lock.json` is foreign and a lone `yarn.lock` change is unexplained; in an npm repo the reverse). Always Blocking for the wrong-manager lockfile |
   | **R13 - Level Budget** | Flag a `TestLevel.SMOKE` test whose priority isn't `CRITICAL`, any feature with more than 5 `SMOKE` tests in the diff, and any `SMOKE` test that is a happy-path/usability/regular-customer-flow check rather than base functionality: a redo counterpart, a keyboard-shortcut/context-menu entry point, an everyday operation such as sorting or filtering, or a UI presence/position/initial-state/tooltip/label check. Required fix: demote those to `TestLevel.SANITY`, negative/edge/bulk/performance ones to `REGRESSION`. Smoke is only "the component and its main base functionality work". Also flag a `SMOKE` test that isn't production-safe: it modifies or deletes data it didn't create, or depends on seeded data (Smoke runs on every production deployment). Level definition: the Scenario Block `Level` rule in `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`. Should-fix |
   | **R14 - Page Object Responsibility** | In a Page Object, flag any assertion (`expect(...)`, `AssertionHelpers.*`) - assertions belong in specs and fixtures - and any method that hides multiple steps or branches on state instead of doing one thing under a one-verb name (`getOrCreateOrder`, `ensureXExists`, `doXAndY`). Required fix: move the assertion to the caller; move the multi-step/conditional flow into a fixture that composes single-purpose Page Object actions. Should-fix |

   An unexplained assumption in test logic (e.g. a condition with no stated reason) is covered by R1/R6 together, not a separate rule - it's either an undocumented decision that needs a *why* comment, or unverified logic that needs confirming before it ships.

3. **Feedback Triage**
   - Pull existing human review comments on an open PR
   - Classify each as: already addressed / needs a code change / needs a reply (disagreement, question, out of scope)
   - Report the "needs a code change" bucket as findings for `apply-review-fixes` to act on, and summarize the "needs a reply" bucket for a human decision - this skill only classifies, it never applies the code change itself

4. **Reporting**
   - Summarize findings in the conversation, grouped by severity, with `file:line` references
   - Post as PR review comments only if a GitHub MCP/`gh` integration is configured and the user asked for it - otherwise report locally and let the user decide whether to post

---

## Workflow

### Step 1: Get the Real Diff

```bash
gh pr diff <number>                  # for an already-open PR
git diff origin/<default-branch>...HEAD   # local branch not yet a PR; default branch per git-safety.md "Detecting the real default/base branch"
```
Never review from memory or from the conversation alone - always pull the actual diff first.

### Step 2: Scope to Test-Relevant Files

Filter the diff to `src/tests/**`, `src/support/**`, and config files that affect tests (`playwright.config.ts`, `tsconfig.json`). Note but don't deep-review unrelated changes (docs, CI config) unless asked.

### Step 3: Run the Checklist

For each changed file, check against the capabilities list above. For every finding, capture: file, line, what's wrong, why it matters (business/maintenance impact, not just "style"), and a concrete suggested fix - `apply-review-fixes` applies that exact suggestion, so make it specific enough to act on directly.

**Scan exhaustively within a file, not just until the first hit.** Finding one hardcoded-string/excessive-comment/etc. instance in a file means checking the *rest* of that same file (and every other changed file of the same shape - e.g. all seven `order-list-*.spec.ts` siblings) for the same pattern before moving on, not stopping at the first example and reporting the category as covered. A pattern caught once but left unfixed three lines down, or in the file next to it, is exactly what turns one review round into three - the whole point of running this checklist is a single complete pass per target, not a sample.

For the multi-occurrence rules (R2, R3, R8-R11), build the occurrence list with a search over every changed file, not by reading - e.g. `rg "page\.(locator|getBy)" src/support/pages` for R8, `rg "x: \d+, y: \d+"` for R9, `rg "\.catch\(\(\) => \{\}\)|catch \{"` for R10, `rg "process\.platform|'(Meta|Control)"` for R11 - and, for R11's dead-export check, search the whole repo (not just the diff) for importers of each newly exported name. The resulting list is the occurrence list reported in Step 5.

### Step 4: Classify by Severity

- **Blocking** - violates a hard rule (direct `page.` call in a test, hardcoded wait, no cleanup, assertion that can't actually fail, a leftover `// UNVERIFIED` locator marker)
- **Should fix** - weak assertion, missing Allure metadata, duplicated logic that should be extracted
- **Nit** - naming/style inconsistency that doesn't affect correctness or maintainability

### Step 5: Report

Always report-only, regardless of whose branch/PR this is - this skill never edits a file itself. Present findings grouped by severity with `file:line` and a suggested fix per Capability 3/Step 3 above. **A rule that repeats across the diff (R2, R3, R8, R9, R10, R11 and any other multi-occurrence smell) is reported as ONE pattern finding**: the rule, the single fix, and the complete `file:line` occurrence list across all changed files - not N separate findings, and not only the first example. This is what lets `apply-review-fixes` sweep every occurrence in one pass instead of leaving the reviewer to comment on each one, plus the feedback-triage buckets if a PR's existing comments were part of the request. If the caller (a human or the `agent-reviewer`) wants the Blocking/Should-fix findings actually applied, that's a separate step: invoke `apply-review-fixes` against these findings - standalone, say so explicitly rather than assuming it; the `agent-reviewer`'s Review mode does this by default for its own pipeline branch (see its `.md`). Note the reverse direction also works: `/qa-kit:apply-review-fixes <target>` invokes this skill itself first if no findings for that target exist yet in the conversation - see `apply-review-fixes`'s `SKILL.md` -> Step 1. Either entry point ends up running the same checklist once, not twice.

---

## Quality Criteria

**A finding must be:**
1. **Concrete** - points at a real file:line, not a vague impression
2. **Justified** - explains the failure mode or maintenance cost, not just "this looks off"
3. **Actionable** - comes with a suggested fix that fits the project's existing patterns (Page Objects, factories, helpers, constants) - specific enough for `apply-review-fixes` to apply without re-deriving it
4. **A directive, not an invitation to discuss, when it's a known rule violation** - "Move this to `OrderStatus`" lands and gets fixed in one pass; "I'm not a huge fan of this hardcoded value, maybe we could discuss it" invites a reply-and-wait round trip for something that was never actually ambiguous. Phrase every finding that already has a documented rule behind it (the project's `AGENTS.md`, `${CLAUDE_PLUGIN_ROOT}/patterns/*.md`, this skill's own R1-R14) as a direct instruction. Reserve open, discussion-inviting phrasing for the genuinely rare finding with *no* existing rule to point to - and when that happens, say so explicitly and flag it as a candidate to get written into the docs, so it's a directive the next time instead of a repeat discussion.

**Avoid:**
- ❌ Re-litigating decisions already made in the codebase's existing conventions
- ❌ Flagging style preferences with no correctness/maintenance impact as if they were blocking
- ❌ Ever applying a change yourself - that's `apply-review-fixes`'s job, not this skill's
- ❌ Reporting a category as "checked" after finding and fixing a single instance of it - see Step 3's exhaustive-scan note

---

## MCP / CLI Integration

See `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md` for the shared MCP rule (applies if a GitHub MCP is ever configured; today this skill uses the `gh` CLI, not MCP).
- **GitHub** (`gh` CLI, or `mcp__github__*` if a GitHub MCP server is ever configured): fetch PR diff/comments, optionally post review comments back. Prefer the plain `gh` CLI unless a GitHub MCP is explicitly configured - don't assume one exists.
- **Playwright MCP**: not used by this skill - if a finding requires confirming behavior live, that's `execute-tests`/`heal-tests`/`write-tests` territory, not this one.

If `gh` isn't authenticated/available, say so and fall back to local `git diff` against the base branch - that still covers the "pre-review before opening a PR" use case.

---

**Note**: This skill reviews and triages feedback on test code - strictly read-only. Use `apply-review-fixes` to act on its findings, `write-tests` for a fix that needs a genuinely new file, and `execute-tests`/`heal-tests` to confirm fixes don't regress the suite.
