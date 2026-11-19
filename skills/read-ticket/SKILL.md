---
name: read-ticket
description: Reads a Jira ticket (and its linked Confluence pages/subtasks) and produces a structured requirements digest - summary, acceptance criteria, product/automation scope, open questions. Use when asked to read/summarize a Jira ticket, or as the first step of plan-tests for a Jira-sourced plan.
argument-hint: '<Jira ticket key, e.g. ABC-1234>'
allowed-tools: Bash, Read, Glob, Grep, mcp__atlassian__*, mcp__glean_default__*
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`. If invoking another skill by its bare name (as this document does) fails, retry as `qa-kit:<name>`, or read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it directly.

# Read Ticket

**Purpose**: Turn a Jira ticket into a structured, reusable digest - the single source of truth for *fetching and summarizing* a ticket, so `plan-tests` composes this instead of fetching the same data itself. Narrower and faster than `plan-tests`: no test-scenario generation, no TestRail gap analysis - just "what does this ticket actually say, and what does it touch." It does still surface (never analyze) any Figma/TestRail links already embedded in the ticket's own text, so `plan-tests` can fold them in - see "Linked References" below.

## How this skill is invoked

- **On demand, by a human**: `/qa-kit:read-ticket ABC-4021` - useful on its own for a quick "what's this ticket about" without running full planning.
- **Autonomously, by the agent**: when asked to read/summarize/digest a Jira ticket and this skill's description matches.
- **From `plan-tests`**: for the Jira-ticket-ID branch of its Step 1, `plan-tests` invokes this skill **once per ticket key** it was given (there may be more than one - an epic plus its subtasks, for instance) and merges every resulting digest into the `Requirements Summary`/`Scope`/`Open Questions` sections of `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`'s envelope, rather than fetching the ticket(s) itself.

## Workflow

### Step 1: Parse the ticket ID

Extract the ticket key from the request (e.g. `ABC-4021`). The prefix before the numbers varies by project/board - don't assume `ABC-` is the only valid one, just require the general `[A-Z][A-Z0-9_]+-\d+` shape (a Jira project key starts with a letter and may continue with uppercase letters, digits and underscores, so `AB2-12` and `MY_PROJ-3` are valid keys).

### Step 2: Fetch the ticket

Call the `mcp__atlassian__*` tools (configured in your MCP settings; each developer authorizes via OAuth on first use - see `${CLAUDE_PLUGIN_ROOT}/docs/MCP-SETUP-GUIDE.md`, there's no separate server-registration step) to get:
- Summary, description, acceptance criteria
- Linked issues and subtasks
- Any Confluence pages linked from the ticket **or** from its linked issues/subtasks (not just the ticket itself)
- Comments, for additional context/clarifications

**If `atlassian` isn't authenticated locally, try `mcp__glean_default__search`/`read_document` before giving up** - Glean indexes Jira and Confluence too, so a search for the ticket key (e.g. `ABC-4021`) plus `read_document` on the matching result can usually recover summary/description/acceptance-criteria/linked-Confluence content the same way. It's read-only (fine for this skill, which only reads) and each developer authorizes it separately from Atlassian, so one being unauthenticated doesn't imply the other is.

If *neither* server resolves the ticket, don't fabricate content - **always just report the failure for this ticket** (the key, which servers were tried, and why they didn't resolve) and stop there for this ticket. Whether that failure blocks anything beyond this one ticket is **not this skill's decision** - it depends on who invoked you and what else they have to work with, per `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md`'s blocking-vs-optional rule:
- **You were invoked directly by a human (`/qa-kit:read-ticket ...`), or `plan-tests` gave you the *only* source for this feature**: your failure report *is* the whole request's blocking failure. If a human is present, stop before producing a digest, say explicitly that neither Atlassian nor Glean is authenticated locally, and ask them to either authenticate whichever of the two they actually have access to (see `${CLAUDE_PLUGIN_ROOT}/docs/MCP-SETUP-GUIDE.md`) or paste the ticket's summary/description/acceptance criteria directly. If there's no human (invoked as `test-planner` inside a `Workflow` run), propagate the block upward per `test-planner.md`'s instructions (`{ blocked: true, blockReason: '...' }`) instead of returning a digest.
- **`plan-tests` gave you just one of *several* sources for this feature** (other Jira IDs, a Figma link, and/or free text): don't independently stop or ask anyone about this - that would wrongly halt a request that `plan-tests`'s own blocking rule says should proceed on its other sources. Just return your failure report; `plan-tests` decides, once it's tried every given source, whether the overall plan is blocked (see `plan-tests`'s `SKILL.md` Step 1 "Blocking rule").

### Step 3: Produce the digest

- **Summary**: 1-2 sentences, plain language.
- **Acceptance Criteria**: bulleted, specific, testable - include edge cases the ticket itself mentions, don't invent ones it doesn't.
- **Scope**:
  - *Product area* (inferred from the ticket text - which parts of the product are likely affected: API, frontend, workflows, DB. The consuming repo normally doesn't contain the product codebase, so this is inference from what the ticket says, never a literal grep against code that isn't here.)
  - *Automation codebase area* (grounded in the project's real structure, not guessed): `Glob`/`Grep` over `src/support/pages/`, `src/support/api/clients/`, and `src/tests/` for anything the ticket's keywords plausibly match (e.g. a ticket mentioning "orders" -> check for `OrdersPage.ts`, `src/tests/ui/orders/`). List what you actually found, not what you assume should exist.
- **Open Questions**: genuine ambiguities that need a human/PM/eng decision before implementation. Omit this section entirely if there are none - don't pad it with rhetorical questions.
- **Linked References**: scan the ticket's own text (description, comments, custom fields you can read) - not just the fields above - for:
  - **Figma links** - any URL containing `figma.com`, verbatim.
  - **TestRail references** - either a full URL containing TestRail's characteristic `/index.php?/` path shape, or an explicit `testrail:<projectId>/<suiteId>[/<sectionId>]` shorthand if someone pasted that convention into the ticket (see `.qa-kit/project/testrail-mapping.md`'s schema for what those IDs mean).

  Report exactly what's found, verbatim - never infer a Figma/TestRail reference from a ticket merely *mentioning* a feature by name; this is about links/references genuinely present in the ticket's text, not inference. **Omit this section entirely if none are found** - same rule as Open Questions, don't pad it. These are handed to `plan-tests` to merge alongside whatever Figma links/TestRail locations were already given directly (see `plan-tests`'s `SKILL.md` Step 1) - **in addition to**, never instead of, sources given elsewhere.

### Step 4: Output

Present the sections above in the conversation, formatted to drop directly into `test-plan-format.md`'s `Requirements Summary`/`Scope`/`Open Questions` envelope sections (plus any `Linked References` found) if `plan-tests` (or a human) continues into full planning.

**On skipping formal planning**: this digest is *sometimes* enough on its own for a human to hand straight to `write-tests` for a genuinely trivial, obviously-scoped fix - but that's a deliberate, occasional human call each time, not this skill's default expectation. `plan-tests`'s own review-gate rule (never skip planning/approval, even for a short plan) still holds; this skill doesn't create a sanctioned bypass of it.

## Success criteria

1. Ticket ID parsed correctly regardless of project prefix
2. Never fabricates ticket content when neither the Atlassian nor Glean MCP server is connected
3. Automation-codebase scope is grounded in real `Glob`/`Grep` results, not assumed file paths
4. Open Questions section is genuinely earned (real ambiguity) or omitted entirely
5. Linked References only ever reports Figma/TestRail links/shorthand genuinely present in the ticket's text - never inferred from a feature name, never fabricated - and is omitted entirely when none are found
