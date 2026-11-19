---
name: help
description: Shows what qa-kit can do on one screen - the recommended path, the four flows (feature-plan, feature-implement, feature-deliver, feature-monkey), every skill in one line, init, and example commands - or the flags and examples of one named flow or skill. Use when asked what qa-kit can do, how to start, which command to use, or what a command or skill does.
argument-hint: '[flow or skill name]'
allowed-tools: Read, Glob
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`.

# Help

**Purpose**: One short, always-correct screen that tells a person what qa-kit offers and where to start. It changes nothing and runs nothing.

## No argument: the overview

Print the block below **exactly as written, inside a code fence, and nothing else**: no greeting before it, no summary after it, no tool calls. The text is curated and must stay identical on every run. Never add, rename or drop a command or flag.

```
qa-kit - plan, write, heal, review and deliver Playwright tests
Detail on anything: /qa-kit:help <name>        e.g. /qa-kit:help feature-implement

START HERE (recommended path)
  /qa-kit:init                           once per repo, one person: sets the repo up for qa-kit
  /qa-kit:feature-plan ABC-1234          plan from Jira, Figma or text; review qa-kit-artifacts/*.md
  /qa-kit:feature-implement              write, run, heal and review the approved plan (nothing is committed)
  /qa-kit:feature-deliver --pr           review once more, commit everything you changed, push, open a PR
  /qa-kit:triage-failure <report URL>    after a failed run: what is it, is it known, what next

FLOWS (several features at once, in parallel)
  feature-plan        plan one or more features; sources: Jira keys, Figma links, TestRail, text
                      --plan <a, b>  merge sources into one feature   --update <plan>, <new source>   --parallel=N
  feature-implement   write -> run and heal -> review; commits only when asked
                      --commit  --push  --pr (each implies the one before)   --level=smoke|sanity|regression
                      --no-heal  --no-apply  --parallel=N
  feature-deliver     review, then commit EVERYTHING git shows as changed, yours included; you pick push/PR
                      --push  --pr  --no-apply   (name a branch or ticket to deliver just that one)
  feature-monkey      monkey-test areas of the running app, in parallel; creates and removes only its own data
                      --minutes=N (default 5, max 30)  --guidance="text"  --read-only  --seed=N  --parallel=N

SKILLS (one step at a time, you stay in control)
  Plan            read-ticket        digest a Jira ticket: criteria, scope, open questions
                  plan-tests         test plan from tickets, Figma or text; --update revises one
                  verify-coverage    is it already tested? do the tests match the plan? (read-only)
  Write and run   write-tests        generate Playwright tests from a plan, a ticket or a description
                  discover-locator   find a working locator by inspecting the live app
                  execute-tests      run tests and classify failures (never edits)
                  heal-tests         run and fix failing tests by root cause
                  fix-lint           lint, format and typecheck fixes
  Review and ship review-tests       review a PR or branch against the team standards (read-only)
                  apply-review-fixes apply those findings as real edits
                  write-commit-message  draft a commit message from the real diff
                  commit-and-push    stage by name, commit, push (asks before pushing)
                  create-pr          self-review gate, commit, push, open the PR
  After a run     triage-failure     read a failed Allure report, retest only what failed, advise per
                                     group (bug, known issue, deviation, gap, tune the test, flaky), draft Jira tickets
                                     --known=ABC-1,ABC-2   --heal   --no-retest
  Explore         monkey-test        explore one area of the live app like a monkey: understands each page first,
                                     time-boxed, cleans up after itself; report and findings plan in qa-kit-artifacts/monkey/
                                     --minutes=N  --guidance="text"  --read-only  --seed=N  --no-cache

SETUP AND HELP
  init               set up or update this repo; --path <folder> for a repo that is not only automation,
                     --user for your own machine, --dry-run to preview
  help               this screen

EXAMPLES
  /qa-kit:feature-plan ABC-1201, ABC-1202            two features, planned in parallel
  /qa-kit:feature-implement --level=smoke            only the Smoke scenarios first
  /qa-kit:feature-deliver                            commit what you looked at and fixed by hand
  /qa-kit:plan-tests ABC-1234                        one feature, no pipeline
  /qa-kit:heal-tests fix the smoke suite
  /qa-kit:triage-failure ./allure-results --known=ABC-40
  /qa-kit:monkey-test checkout --minutes=5 --guidance="odd quantities and coupons"
  /qa-kit:feature-monkey checkout "order history" --read-only

SAFE BY DEFAULT: nothing is committed unless you add --commit/--push/--pr (or run feature-deliver),
nothing is pushed or turned into a PR unless you ask, planning never touches git,
and monkey runs refuse production-looking URLs and never delete or change data they did not create.
MORE: README.md (install, setup, update), patterns/usage-examples.md (real scenarios with output)
```

## With a name: detail on one flow or skill

`<name>` may be written with or without the leading slash and prefix (`feature-implement`, `/qa-kit:feature-implement`, `heal-tests`, `init`). Print at most 15 lines, plain text, no preamble: what it is for (one sentence), its flags, and two example lines. Read the facts from the plugin so they cannot drift:

- **A flow** (`feature-plan`, `feature-implement`, `feature-deliver`, `feature-monkey`): the rows of the flag table in `${CLAUDE_PLUGIN_ROOT}/patterns/workflows-reference.md` ("Workflow arguments") whose Workflows column names that flow or all of them, one line per flag with its default; two example commands from `${CLAUDE_PLUGIN_ROOT}/patterns/usage-examples.md` that start with that flow's name.
- **A skill** (including `init` and `help`): read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md`; use the first sentence of its description, the options named in its "How this skill is invoked" section, and the example invocations shown there.
- **A name that matches neither**: say "No flow or skill named <name>." and list the three to five closest names (use `Glob` on `${CLAUDE_PLUGIN_ROOT}/skills/*/SKILL.md` for the skill names; the flows are the four above), then point at `/qa-kit:help`.

If a fact is not in those files, leave it out; never fill a gap from memory.

---

**Note**: This skill only prints. Use the flows and skills it lists to do the work; `README.md` has install, setup and update, and `patterns/usage-examples.md` has real scenarios with sample output.
