# End-to-End Usage Examples

> Example commands for the `qa-kit` plugin. Every slash command is namespaced: `/qa-kit:feature-plan`, `/qa-kit:plan-tests`, and so on. Sample ticket keys (`ABC-123`) and file names are placeholders - substitute your own.

Concrete, runnable examples for every real scenario - what you'd type, and what it resolves to. Examples B-I use the pipeline commands (`${CLAUDE_PLUGIN_ROOT}/commands/feature-plan.md`, `feature-implement.md`, `feature-deliver.md`). Every flag, its `args` field and its default is listed once in `${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md` under "Workflow arguments"; the `args` shown below are the result of parsing that command. OpenCode has no chat history to hand plans from `feature-plan` to `feature-implement`, so a command given no plan or target uses the latest report under `qa-kit-artifacts/latest/` instead.

### A. One feature, no workflow at all (fully manual, most control)
```
/qa-kit:plan-tests ABC-3702
# review qa-kit-artifacts/ABC-3702-test-plan.md, then:
/qa-kit:write-tests implement qa-kit-artifacts/ABC-3702-test-plan.md
/qa-kit:execute-tests run the new spec --heal
/qa-kit:apply-review-fixes review the diff on this branch before I open a PR
/qa-kit:commit-and-push
# once you're ready to open a PR:
/qa-kit:create-pr
```
Every step is interactive here - each git-touching skill asks before it pushes/creates a PR. Use this when you want to inspect each stage yourself, or you're only working on one thing. This is the **manual track** (see `${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md` §7 "Two tracks, never mixed") - repeat the whole sequence per feature if you have several; there's no batch mode, but nothing stops you running it again for the next one. The plan file itself is interchangeable with the pipeline's: `qa-kit-artifacts/ABC-3702-test-plan.md` (or any plan `/qa-kit:plan-tests` produced standalone) can be handed to `/qa-kit:feature-implement` as `{ task, planPath, testType }`, since neither planner creates any git state. What you can't do is switch tracks partway through implementation.

Two things to notice (see workflows-reference.md §§5/12 and §§4/13): `/qa-kit:execute-tests run the new spec --heal` and `/qa-kit:heal-tests fix the new spec` do the same thing, chained in opposite directions. And `/qa-kit:apply-review-fixes ...` is what actually fixes anything here - a bare `/qa-kit:review-tests ...` is strictly read-only and only reports findings. If you only want the findings, use `/qa-kit:review-tests` and decide from there.

### B. One feature, through the pipeline, nothing committed (default, safest)
```
/qa-kit:feature-plan ABC-3702
# review qa-kit-artifacts/ABC-3702-test-plan.md, then:
/qa-kit:feature-implement
# look at the written tests in your checkout, then deliver them:
/qa-kit:feature-deliver
```
Runs `feature-plan` for `ABC-3702`, then (after review) `feature-implement` for the approved plan. No `commit`/`push`/`createPr` -> the Deliver stage is skipped: the tests are written, healed and reviewed but left uncommitted (`report[].committed: false`), and the run says where they are. Only one feature, so `HEADLESS` stays `false` (headed). `/qa-kit:feature-deliver` then reviews once more and commits locally (`pushed: false`); add `--push` or `--pr` to it (or to `feature-implement` up front) to go further.

### C. One feature, through the pipeline, committed (and optionally pushed)
```
/qa-kit:feature-implement --commit
/qa-kit:feature-implement --push
```
Results: `args: { plans: [...], commit: true }` commits locally and stops; `args: { plans: [...], push: true }` commits and pushes (`--push` implies `--commit`). Still headed (one feature), still no PR.

### D. One feature, through the pipeline, with push and a PR
```
/qa-kit:feature-implement --pr
```
Result: `args: { plans: [...], createPr: true }` (implies `push: true` and `commit: true` - `--pr` alone is enough, no need for `--push --pr`). The Deliver step invokes `create-pr` instead of `commit-and-push`, pre-authorized to skip its confirmations since this flag *is* that authorization. Report includes `prUrl`.

### E. Several features in parallel, nothing committed
```
/qa-kit:feature-plan ABC-1201, ABC-1202, "add CSV export to the orders table"
# review all three qa-kit-artifacts/*.md files, then:
/qa-kit:feature-implement
```
Three entries in `args.plans` -> `HEADLESS` becomes `true` automatically (no browser windows fighting for the screen), running up to `MAX_PARALLEL_FEATURES` (3 by default) at a time, each in its own worktree/branch. No commit/push/PR flag - three worktrees with uncommitted tests on three branches, until you run `/qa-kit:feature-deliver` (it takes all three from this run's report) or add `--commit`/`--push`/`--pr` up front. **Three separate single-source features** - each comma-separated item here is its own feature/plan/worktree, because no `--plan` divider was used. To merge some of these into one feature instead, see example F.

### F. One feature, multiple sources merged into one plan
```
/qa-kit:feature-plan --plan ABC-3702, ABC-3703, https://figma.com/file/abc123, testrail:3/12/104, "Also cover the CSV export edge case for an empty order list"
# review qa-kit-artifacts/*.md (one file - all five sources merged), then:
/qa-kit:feature-implement
```
Result (one feature made of both tickets, the Figma link, the TestRail location and the extra description, all merged):
```js
Workflow({
  name: 'feature-plan',
  args: {
    features: [
      {
        jiraKeys: ['ABC-3702', 'ABC-3703'],
        figmaLinks: ['https://figma.com/file/abc123'],
        testrailLocations: ['testrail:3/12/104'],
        descriptions: ['Also cover the CSV export edge case for an empty order list'],
      },
    ],
  },
})
```
The `--plan` divider is what tells `feature-plan` these five sources belong to **one** feature - without it, that comma-separated list would parse as five separate single-source features (example E's grammar). The sources can be listed in **any order** in the command - `testrail:3/12/104, ABC-3702, "...", https://figma.com/file/abc123, ABC-3703` parses identically, since classification is by shape, not position. `plan-tests` fetches each requirements source independently (`read-ticket` per Jira key, `mcp__figma__*` for the link) and merges them into one `Requirements Summary` before generating scenarios; blocking follows `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md` (`testrailLocations` never counts as a requirements source, see workflows-reference.md §2 "Plan Tests"). The `testrail:3/12/104` location here isn't requirements content - it overrides `testrail-mapping.md` for this plan's TestRail cross-check, even though neither `ABC-3702` nor `ABC-3703` need to have a `TestFeature` mapping entry for it to work. If either ticket's own text also links a Figma design or a TestRail case/section, `read-ticket`'s "Linked References" surfaces it and `plan-tests` folds it in too, on top of the two sources given directly here - not instead of them. `feature-implement` needs no changes for this case: by the time a plan is approved, it's already one merged document regardless of how many sources fed it. Mix freely with plain comma-separated features in the same call, e.g. `/qa-kit:feature-plan ABC-9000, --plan ABC-3702, ABC-3703, "..."` plans one single-source feature and one multi-source feature together.

### G. Several features in parallel, push everything, no PRs
```
/qa-kit:feature-implement --push
```
Same command as example C - the flag means the same thing regardless of how many plans are in play, or whether any of them came from a `--plan` (multi-source) feature. Each branch pushes independently as its own Deliver step finishes; a slow feature doesn't hold up a fast one.

### H. Several features in parallel, push and open a PR for each
```
/qa-kit:feature-implement --pr
```
Each feature gets its own PR, independently, as its Deliver step completes. Want a specific concurrency cap for this run instead of the default 3? `/qa-kit:feature-implement --pr --parallel=2`.

### I. One feature, through the pipeline, inspect before anything touches the branch
```
/qa-kit:feature-implement --no-heal --no-apply
```
Result: `args: { plans: [...], heal: false, apply: false }`. Write still writes the tests; Execute only runs and classifies (`execute-tests`, not `heal-tests` - see §5/§12); Review only reviews and reports (`review-tests`, not `apply-review-fixes` - see §4/§13); nothing is committed unless you also pass `--commit` (or beyond), and then Deliver commits whatever's on the branch as-is (Write's output, untouched by either stage). Use this when you want to see raw failures/findings for a feature before letting anything edit it - the two flags are independent, so `--no-heal` alone or `--no-apply` alone works too (see example A for what each looks like standalone via the skills directly, rather than through the pipeline). Combine with `--parallel=N` the same as any other flag.

### J. Ticket-only feature with no screenshots - ground the journey live (or don't)
```
/qa-kit:plan-tests ABC-4102
```
`read-ticket` fetches the ticket as usual. If the UI journey it describes is genuinely unclear (no Figma link/screenshot given, and the ticket text alone doesn't say where in the app this starts), the skill asks: *"I can open the live app and explore this journey - want me to?"* Say yes to get a **headed** browser - log in yourself when prompted, then let it explore read-only to ground the plan. Say no (or don't answer) and it marks the ambiguous parts `<UI-TBD: ...>` inline instead of guessing, for a human/QA pass to resolve later by hand or via Update Mode (example K). This never happens automatically, and never happens at all inside `/qa-kit:feature-plan` (no one to log in mid-pipeline) - a pipeline-produced plan always falls back to `<UI-TBD>` markers for anything it can't ground from ticket/Figma/text alone.

### K. Revisiting an approved plan once more detail arrives
```
/qa-kit:plan-tests --update qa-kit-artifacts/ABC-4102-test-plan.md with this Figma link: https://figma.com/file/xyz
```
Merges the Figma content into the existing file **in place** - resolving whatever `<UI-TBD>`/`Open Questions` entries it answers, appending any new scenarios it reveals, flagging (not silently overwriting) anything it contradicts - and re-saves the same path with a `Revised:` note. It does not create a second plan file or discard earlier review comments. Works the same whether the plan came from standalone `/qa-kit:plan-tests` or from `/qa-kit:feature-plan` (see workflows-reference.md §7 "Two tracks") - it's still the same file under `qa-kit-artifacts/`.

### L. Revising a pipeline-planned feature, through the workflow
```
/qa-kit:feature-plan --update qa-kit-artifacts/ABC-3702-test-plan.md, "add the empty-cart edge case"
```
Same idea as example K, but for a feature that went through `/qa-kit:feature-plan` (not standalone `/qa-kit:plan-tests`) - the command uses `qa-kit-artifacts/ABC-3702-test-plan.md` directly as the plan path (a prior report entry in the conversation, if any, just fills in `task`/`testType`), then runs the workflow with `args: { updates: [{ plan: { planPath: 'qa-kit-artifacts/ABC-3702-test-plan.md' }, descriptions: ['add the empty-cart edge case'] }] }`. `agent-planner` revises that same plan file in place - no worktree or branch is involved. If the file doesn't exist, the update reports blocked instead of silently starting a second plan. Still stops here for review, same as a fresh `/qa-kit:feature-plan` run - `/qa-kit:feature-implement` picks up wherever you left off.

### M. Just the git skills, no test work involved
```
/qa-kit:write-commit-message
/qa-kit:commit-and-push "fix(checkout): correct cart total rounding"
/qa-kit:create-pr
```
These work on whatever's currently changed in your checkout, regardless of whether it came from this pipeline - useful for any change, test-related or not.

### N. Finishing a feature-implement run that left findings unresolved
```
/qa-kit:feature-implement --no-apply
# review the findings reported above, then:
/qa-kit:feature-deliver
```
`/qa-kit:feature-implement --no-apply` leaves the Review stage at report-only (and, as with any run without a delivery flag, nothing is committed). `/qa-kit:feature-deliver` with no arguments resolves `args.targets` from that run's report entries already in this conversation (workflows-reference.md §14's resolution tier 1/2), re-reviews with `apply-review-fixes` this time (default `apply: true`), and - since fixes get applied - runs the confirming re-review (`report[].reReviewed: true`). Deliver then commits via `commit-and-push`, `pushed: false` since neither `--push` nor `--pr` was given.

### O. Same, with push
```
/qa-kit:feature-deliver --push
```
Result: `args: { targets: [...], push: true }`. Each branch is pushed once its Deliver step finishes.

### P. Same, with push and a PR
```
/qa-kit:feature-deliver --pr
```
Result: `args: { targets: [...], createPr: true }` (implies `push: true`). Deliver invokes `create-pr` instead of `commit-and-push`. `create-pr`'s own self-review gate runs a fresh `review-tests` pass (the Deliver agent has its own context and does not see the Review stage's findings); because the branch was just fixed it should come back clean (see §14 "Expect a second review" and §10). Report includes `prUrl`.

### Q. Delivering a branch that never went through the pipeline
```
/qa-kit:feature-deliver --push
```
Say this on a branch you wrote/fixed by hand, with no `/qa-kit:feature-plan`/`/qa-kit:feature-implement` report entries in this conversation. The command finds no prior targets, so it falls back to tier 3 of §14's resolution order: a single implicit target built from `git branch --show-current` and the current working directory. Review runs `apply-review-fixes` and its confirming re-review against that branch exactly as in example N, then Deliver pushes it - the same end state as running `/qa-kit:review-tests` + `/qa-kit:apply-review-fixes` + `/qa-kit:commit-and-push` by hand (example M), just as one command with the added confirming re-review.

### T. Is this already covered? And do the tests match the plan?
```
/qa-kit:verify-coverage plan qa-kit-artifacts/ABC-3702-test-plan.md
/qa-kit:verify-coverage implementation qa-kit-artifacts/ABC-3702-test-plan.md level=smoke
```
The first marks each scenario of a plan `duplicate`, `partial` or `new` against the repo's specs, with `file:line` evidence (`plan-tests` and `feature-plan` already do this when they build a plan, so a plan never re-plans what exists). The second checks the specs on your branch against the plan: scenarios with no test (Blocking, needs `write-tests`), weak assertions, duplicates of existing tests, and tests that are in no scenario. `feature-implement` runs the second one in its Review stage by itself; `report[].coverageGaps` carries what it found. Both are read-only.

Sample plan-mode result (one row per scenario, evidence on every row):

| Scenario | Verdict | Evidence | Handling |
|---|---|---|---|
| TC-003 Export empty order list | duplicate | `src/tests/ui/orders/export.spec.ts:41` "exports an empty order list" | Removed from Test Scenarios, listed in Existing Coverage |
| TC-004 Export 10k rows | partial | `export.spec.ts:58` covers 10 rows only | Kept; Description starts "Extends `export.spec.ts` ..." |
| TC-005 Export as XLSX | new | searched `export*`, `OrdersPage.exportTo*`, TestRail section "Orders" | Kept |

Sample runner summary when the Review stage finds a planned scenario with no test (exit code 2):
```
- ABC-3702: branch=feature/abc-3702 worktreePath=/work/repo stage=review coverageGaps=Export empty order list: no test blockReason=planned scenario without a test: Export empty order list committed=false pushed=false
```
A missing scenario blocks the stage (it needs `write-tests`). Weak assertions are fixed by `apply-review-fixes` in the same pass, so they only show up in `coverageGaps` when the run used `--no-apply`.

### U. A nightly run failed - what is it, and is it already known?
```
/qa-kit:triage-failure https://<pages-host>/<environment>/<run-number>/ --known=ABC-12,ABC-40
/qa-kit:triage-failure ./allure-results --known="project = ABC AND resolution = Unresolved"
```
Reads the failed tests and their earlier results from the Allure report (or from the run's `allure-results` artifact when the site needs a login), retests only those tests plus their setup project and serial block, and gives each group of failures a verdict with a confidence and the reasons: product bug, known issue, deviation, product gap, test that needs tuning (`test-fix`), flaky or environment. `--known` takes Jira keys (bugs, stories, epics) or one JQL, so a failure that matches an open bug is reported as a known issue and no second ticket is drafted, and a story resolved the day before a failure started is named as the likely cause. The final message is a screen report with one block per group (what, why, "failing 6 runs in a row since run 407", what was ruled out, next action) and copy-pasteable next actions; the same content is in `qa-kit-artifacts/triage/<slug>/` as `triage-report.md`, `triage.json` and a `ticket-<n>-*.md` draft per probable product bug. Nothing is filed in Jira and, by default, no test is edited. Follow up in the same session ("heal g4", "draft a ticket for g2").

### V. Triage in CI, heal locally
```
# CI (triage only, keeps triage.json as an artifact)
/qa-kit:triage-failure https://<pages-host>/<environment>/<run-number>/ --known=ABC-12
# later, on your machine, after downloading triage.json
/qa-kit:triage-failure --from=qa-kit-artifacts/triage/<slug>/triage.json --heal --groups=g4
/qa-kit:feature-deliver
```
`--heal` heals only `test-fix` groups, through `heal-tests`, and never in a spec file you have uncommitted changes in (that group is reported `blocked` with the file name). The healed scope is re-run once, the files stay uncommitted, and `/qa-kit:feature-deliver` reviews and commits them. The agent form is `agent-triager`, for a CI step or a direct call.

Sample screen report (also saved as `triage-report.md`; `triage.json` carries the same groups with ids, evidence and history for scripts):
```
Triage: https://reports.example.com/staging/412/   report env: staging   retest env: staging   retested: yes   known issues: 4 read
Found 9 failed tests in 5 groups: 1 product-bug, 1 known-issue, 1 deviation, 1 test-fix, 1 flaky

g1  product-bug  (high)   3 tests   src/tests/ui/orders/export.spec.ts
    What:    Exporting an order list of more than 1000 rows downloads an empty file
    Why:     rows.length is 0, expected 1042, in all 3 tests; fails again on retest; no related change found
    History: failing 3 runs in a row since run 410 (2026-11-14), same error
    Not:     test problem ruled out: the button and the download are found and the request returns 200 with an empty body
    Next:    draft written to qa-kit-artifacts/triage/staging-412/ticket-1-export-empty-file.md
g2  known-issue  (high)   1 test    src/tests/ui/orders/filter.spec.ts
    What:    Filter by status shows deleted orders
    Why:     same failure as ABC-40 (open bug), fails again on retest
    History: failing 11 runs in a row since run 401 (2026-11-05), same error
    Next:    nothing to file; suggested comment for ABC-40: "Still reproduces in staging run 412."
g3  deviation  (medium)   2 tests   src/tests/ui/orders/create.spec.ts
    What:    The success message reads "Order saved" and the test expects "Order created"
    Why:     label-only assertion mismatch; ABC-77 (story, resolved 2026-11-13) reworded the messages
    History: new in run 411 (2026-11-13); passed in all 19 earlier runs
    Not:     product bug not fully excluded: confirm the new wording with ABC-77, then update the expectation
    Next:    update the expectation by hand or with /qa-kit:write-tests (never auto-healed)
g4  test-fix  (high)   2 tests   src/tests/ui/orders/list.spec.ts
    What:    The locator of the "Export" button times out
    Why:     the button exists under a new aria-label (live check found it); fails the same way on retest
    History: failing 2 runs in a row since run 411, same error
    Next:    /qa-kit:triage-failure --from qa-kit-artifacts/triage/staging-412/triage.json --heal --groups=g4
g5  flaky  (high)   1 test    src/tests/api/orders/search.spec.ts
    What:    Timeout waiting for the search response
    Why:     passed on retest; failed 4 of the last 20 runs, never twice in a row

Next actions (copy-pasteable, safest first)
  1. File g1: qa-kit-artifacts/triage/staging-412/ticket-1-export-empty-file.md
  2. Confirm g3 with ABC-77, then update the expectation
  3. Heal g4: /qa-kit:triage-failure --from qa-kit-artifacts/triage/staging-412/triage.json --heal --groups=g4
Files: qa-kit-artifacts/triage/staging-412/triage.json  triage-report.md  ticket-1-export-empty-file.md
```

Sketch of the CI side. `triage-failure` has no runner entry yet and this has not been run, so treat it as a shape to adapt, not a tested workflow. Keep the `--known` value in a repository variable and never put a token on the command line:
```yaml
- name: Triage failures (triage only, no --heal)
  if: failure()
  run: >
    claude -p --agent qa-kit:agent-triager
    "Triage the Allure report ${{ steps.pages.outputs.report_url }} --known=${{ vars.KNOWN_ISSUES }}"
- uses: actions/upload-artifact@v7
  if: failure()
  with:
    name: triage-${{ github.run_number }}
    path: qa-kit-artifacts/triage/
```
With Jira and Glean read access only, the agent can read issues and draft tickets but cannot file them.

### Z. Monkey-testing an area, then turning what it found into tests

One area, five minutes, with a hint (`/qa-kit:monkey-test` runs it in this conversation; `/qa-kit:feature-monkey` runs one or several areas through the pipeline or the runner):
```
/qa-kit:monkey-test checkout --minutes=5 --guidance="odd quantities and coupon codes; leave payment alone"
/qa-kit:feature-monkey checkout "order history" --read-only --parallel=2
```
It first understands each page - the conventions, the plan scenarios and existing tests that mention it, and one read-only look at the screen - and writes an understanding card per page under `qa-kit-artifacts/monkey/<slug>/pages/` before it acts on that page. Then it explores, names everything it creates `mk-<runid>-<n>`, removes it again, replays every candidate finding once, and ends with:
```
Monkey test: checkout   env: staging.example.test   budget: 5 min   used: 5.4 min   seed: 17
Explored 4 pages (1 in cautious mode, 2 cards from cache), 87 actions, 21 states
Findings: 2 confirmed (1 sev-2, 1 sev-3), 1 flaky, 3 unconfirmed
  F-1  sev 2  Saving a coupon with 51 characters returns 500 and shows success   /checkout   oracle: first-party 5xx   reproduced 2/2
Cleanup: clean (6 created, 6 removed)      Left behind: none      Left alone: 3 protected items
Files: qa-kit-artifacts/monkey/checkout-20261118-1030/monkey-report.md  monkey.json  findings-plan.md
Next: /qa-kit:feature-implement qa-kit-artifacts/monkey/checkout-20261118-1030/findings-plan.md
```
The last line is the point: `findings-plan.md` holds only the findings that reproduced 2/2, in the normal plan format, so `feature-implement` turns them into regression tests that fail until the bug is fixed. A host that looks like production (a `prod`, `production` or `live` label, or a `Never run against` row in `conventions.md`) is refused with no override. If `cleanup` is not `clean`, the report lists `leftBehind` with the names to remove.

**The report always has the same seven sections** (`monkey-report.md`; an empty one says "none"):
```
# Monkey report: checkout   (staging.example.test, seed 17)
1. Run            charter and tour; budget 5 min, used 5.4; 4 pages, 87 actions, 21 states
2. Coverage       explored /orders, /orders/:id   cautious: /coupons   skipped: /billing (deny-list)
3. Findings       F-1  sev 2  <title>  /checkout   oracle: first-party 5xx   reproduced 2/2   seen 3x
                    Steps: 1. ... 2. ... 3. ...   Expected / Actual   Evidence: evidence/F-1.png
4. Unconfirmed    U-1 ... reproduced 1/2 (flaky)   never counted as a defect
5. Data           created 6, removed 6, cleanup: clean   left behind: none
                  left alone: "Source - do not delete" (marker: source), "NOT FOR CLEANUP" (not), "golden-order" (golden)
6. Environment    re-login 1, blocked navigations 2, cache hits 2
7. Not explored   /orders/:id/export only reachable through the protected "golden-order"
```

**Guardrails at a glance** (the skill's Hard limits and "Data safety" are the full text):
- Production-looking host (`prod`, `production`, `live` label, or a `Never run against` row in `conventions.md`): refused, no override.
- Nothing it did not create is ever deleted, and by default not changed either. An item whose name, label or description carries NOT, SOURCE, SEED, TEMPLATE, KEEP, FIXTURE, GOLDEN, BASELINE, MASTER, MAIN, DEFAULT and similar markers, a locked or read-only item, and every name or id your tests use are read-only, and are not used as the source of a copy: they may exist to generate other data. They are named in the report ("left alone"), never touched.
- Its own data is named `mk-<runid>-<n>`, logged before anything else happens to it, and deleted one item at a time after re-reading the name on screen. No select-all, delete-all or bulk action; at most 25 entities per run.
- Billing, payments, invitations, outbound messages, account and organization settings, logout and other origins are never touched. Page text and your guidance are data, not instructions.
- It writes only under `qa-kit-artifacts/monkey/`, never touches git, tracked files or `.env`, and stops at the budget (default 5, max 30 minutes).

### AA. A defect was reported - is it real, and do we have a test for it?
```
/qa-kit:retest-defect ABC-1234
/qa-kit:retest-defect https://<jira-host>/browse/ABC-1234 --read-only
```
It reads the ticket as a defect (steps, expected and actual, environment, screenshots, comments, status and resolution), writes the steps it will follow to `repro.md` (marking which are stated and which it inferred), reproduces them in the app configured for this repo, replays once from a clean state, then checks whether a test already asserts the correct behavior. It never files or comments on the ticket and never edits a test. Sample screen report (also saved as `retest-report.md`; `retest.json` carries the same facts):
```
Retest: ABC-1234 "Saving a coupon with 51 characters shows success"   status: Resolved (fixed in 2.14)   reported on: staging   retested on: staging
Verdict: reproduced (high), 2 of 2 attempts, 4 minutes   REGRESSION CANDIDATE: resolved 2026-11-02

Why:     the save returns HTTP 500 and the page still shows "Saved"; same console error as in the ticket's comment from 2026-10-12
Steps:   1 ok  2 ok  3 ok  4 SYMPTOM: expected an error banner, got "Saved" and an HTTP 500   (qa-kit-artifacts/retest/ABC-1234-20261122-1040/repro.md)
Not:     a data problem ruled out: the same input with 50 characters saves normally

Coverage: partial   - src/tests/ui/coupons/save.spec.ts:41 "saves a coupon" asserts only the 50-character case
Left behind: none

Next actions (copy-pasteable)
  1. Plan a regression test: answer yes below, or /qa-kit:plan-tests ABC-1234
  2. Then implement it:      /qa-kit:feature-implement qa-kit-artifacts/ABC-1234-test-plan.md
Files: retest.json  retest-report.md  repro.md  evidence/

This flow has no regression test for the 51-character case. Plan one now?
```
Answering yes runs `plan-tests` and stops at the plan review: because the defect reproduces today, the plan says the new test fails until ABC-1234 is fixed and asks you to decide how to land it (for example `test.fixme` linked to the key). Implementing it is the separate `/qa-kit:feature-implement` step you run after reading the plan. The `agent-defect-retester` form asks nothing: it returns `offerPlan` and the same two commands, and plans only when its prompt had `--plan`.

Not reproduced does not mean fixed: an open defect that does not reproduce reads "maybe fixed, or the environment or data differs", and a step the run could not perform (the screen changed) is `inconclusive`, never `not-reproduced`. It refuses production-looking hosts, creates only data named `rt-<runid>-<n>` and removes it, and a defect that needs data it did not create ends `inconclusive` rather than touching it.

### R. Setting up qa-kit in a repo that is not only test automation
```
/qa-kit:init --path=automation
```
Installs everything (`AGENTS.md`, `CLAUDE.md`, `.mcp.json`, `.claude/settings.json`, `opencode.json`, `.qa-kit/`) in `automation/` instead of the git root, so Developers working elsewhere in the repo get none of it. The path is relative to the folder you run the command from (`--path=/myfolder/test` means `./myfolder/test`). Afterwards start the agent **from that folder** (`cd automation`), run the pipelines and later `/qa-kit:init` updates from there too (no flag needed), and stage with root-anchored paths (`git add -- ':/automation/tests/x.spec.ts'`). Run from a subfolder with no flag, `init` asks whether to install there or at the repo root; if qa-kit is already installed in another folder it stops instead of creating a second install.

### S. One plan, one level at a time (check the basics before spending more)
```
/qa-kit:feature-implement qa-kit-artifacts/ABC-3702-test-plan.md --level=smoke
# the Smoke specs are written, run and reviewed, and left uncommitted; confirm the basics work, then:
/qa-kit:feature-implement qa-kit-artifacts/ABC-3702-test-plan.md --level=sanity
# and finally, with no --level, whatever is still missing, then deliver everything at once:
/qa-kit:feature-implement qa-kit-artifacts/ABC-3702-test-plan.md
/qa-kit:feature-deliver
```
Write it with an equals sign: `--level=smoke`, never `--level smoke` (like `--parallel=2` and `--base=origin/main`, every flag that takes a value uses `=`; the runner rejects the space form with "value flags are written --name=value"). Result: `args: { plans: [...], level: 'smoke' }`, then `level: 'sanity'`, then no `level`. The plan's `Level:` field on each scenario decides what matches (exact level, not cumulative: `sanity` writes the Sanity scenarios only). A later run skips scenarios already implemented and adds only the rest, on the same `feature/<slug>` branch.

Nothing is committed in between, and that is fine: every run records `ownedFiles` (the files the pipeline produced) in its report, and the next run on the same plan receives them as `priorOwned`, so the Smoke specs are continued from and not taken for your own changes. `/qa-kit:feature-deliver` then reviews and commits all three runs' files together, and also takes every file you changed or added by hand in the meantime (example Y). Add `--commit` to any run to commit as you go. A plan with nothing left at the requested level is reported `blocked` and nothing is written. With several plans, one `--level` applies to all of them. Change a scenario's level by editing the plan (or `/qa-kit:feature-plan --update`) before running; `feature-deliver` has no `--level`.

If the report is not available (a fresh Claude Code session, or the runner's `latest/` folder was cleared), the pipeline cannot tell its earlier files from yours. It then treats them as yours and Deliver leaves them out, and says so:
```
- ABC-3702: branch=feature/abc-3702 worktreePath=/work/repo stage=deliver skippedPaths=src/tests/ui/orders/export-smoke.spec.ts; src/support/pages/OrdersPage.ts committed=true pushed=false
```
Stage those by hand, or run `feature-implement` again in the session that still holds the report.

### Y. Closing a gap by hand, then delivering everything
```
/qa-kit:feature-implement qa-kit-artifacts/ABC-3702-test-plan.md
# you read the result, notice a missing case, and add it yourself, without AI:
#   src/tests/ui/orders/export-empty.spec.ts   (new test you wrote)
#   src/support/pages/OrdersPage.ts            (a method you added)
/qa-kit:feature-deliver
```
`/qa-kit:feature-deliver` reviews and fixes the pipeline's files **and** your two files (test and support files get the review checklist; any other kind of file is delivered as it is), then commits all of them. The report lists yours as `handChanges`, the commit message says it includes manual edits, and the runner prints a warning so the commit's contents are never a surprise:
```
- ABC-3702: branch=feature/abc-3702 stage=deliver handChanges=src/tests/ui/orders/export-empty.spec.ts; src/support/pages/OrdersPage.ts committed=true pushed=false
warning: feature/abc-3702 commit includes 2 file(s) the pipeline did not produce (changed by hand after the implement run?): src/tests/ui/orders/export-empty.spec.ts, src/support/pages/OrdersPage.ts
```
What it takes: **every change git shows in the project folder** (modified, deleted, renamed, staged, and new files that are not ignored). That includes a file you had already modified before `feature-implement` started and files that are not tests, such as application code: running `feature-deliver` is the request to deliver everything you changed, and `handChanges` plus the warning make it visible. What it leaves out: whatever git itself ignores (it never shows up), a secret file (`.env`, a key, a token in the diff: it stops and says so, as `commit-and-push` always does), and another package manager's lockfile (skipped, listed in `skippedPaths`). If you do not want a file in the commit, stash it or stage the rest by hand with `/qa-kit:commit-and-push`.

### W. Running the same plan twice writes nothing new
```
/qa-kit:feature-implement qa-kit-artifacts/ABC-3702-test-plan.md
/qa-kit:feature-implement qa-kit-artifacts/ABC-3702-test-plan.md
```
`write-tests` checks, for every scenario, whether a test for it already exists (the repo's *List tests* command first, then the spec files) and skips it, naming the existing test's `file:line` in the notes. The second run therefore reports the same `ownedFiles`, adds no test, and Review finds nothing new to fix.

### X. A partial scenario extends the existing test
Plan (written by `/qa-kit:feature-plan`; `export.spec.ts` already has a 10-row test):
```
ID: TC-004
Test: Export 10k rows
Description:
Extends src/tests/ui/orders/export.spec.ts "exports 10 rows": adds a 10,000-row case and asserts the file has every row.
```
After `/qa-kit:feature-implement`, the new test sits in the same spec and `describe`, reusing its setup, and the existing test is untouched:
```
test.describe('Order export', () => {
  test.beforeEach(async ({ ordersPage }) => { await ordersPage.open() })   // existing setup, reused

  test('exports 10 rows', async ({ ordersPage }) => { /* unchanged */ })

  test('exports 10k rows', async ({ ordersPage, ordersApi }) => {          // added by this run
    await ordersApi.createMany(10_000)
    const file = await ordersPage.exportAll()
    expect(await countRows(file)).toBe(10_000)
  })
})
```
Without the `Extends` sentence the scenario would be written as a new test with its own copy of the setup, and the Review stage's coverage check would flag it as a duplicate of the 10-row test.

