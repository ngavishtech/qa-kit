---
name: discover-locator
description: Finds a working Playwright locator for a target element by live-inspecting the running app via the Playwright MCP tools, using the canonical Locator Strategy Priority order defined here. Reports what resolved and its strength tier, or what was tried and failed; never edits files. Use when asked to find or confirm a locator or selector, or when write-tests or heal-tests need one.
argument-hint: '<element description> [page URL or steps to reach it]'
allowed-tools: Read, Glob, Grep, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_hover, mcp__playwright__browser_wait_for, mcp__playwright__browser_evaluate, mcp__playwright__browser_close
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`. If invoking another skill by its bare name (as this document does) fails, retry as `qa-kit:<name>`, or read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it directly.

# Discover Locator

**Purpose**: Own the *one* live-DOM-inspection procedure this kit uses to find a working locator, and the one canonical "Locator Strategy Priority" tier order behind it - `write-tests` (authoring) and `heal-tests` (healing) both compose this skill instead of each keeping their own copy of either. This skill only *finds* a locator - it never writes one into a file; the caller decides what to do with the result.

---

## How this skill is invoked

- **On demand, by a human**: `/qa-kit:discover-locator find a selector for the Save button in the order details panel` - useful standalone for ad hoc exploration without writing or running anything.
- **From `write-tests`**: at authoring time, when the target state is actually reachable right now (see `write-tests`'s "Locator Discovery") - if it isn't reachable, `write-tests` skips calling this skill and uses its own `// UNVERIFIED` placeholder convention instead, since there's nothing live to inspect yet.
- **From `heal-tests`**: during locator healing, once a failure is classified as a locator issue - see `heal-tests`'s "Locator healing" step.

Give it the target element's description and the app state/page it should appear in (a URL, or steps to reach it) in the same message - there's no separate flag syntax.

---

## Workflow

### Step 1: Reach the target state

Navigate to the page the target should appear on (via the Playwright MCP browser tools), in whatever state the caller described (e.g. after adding an item to the cart, on a specific details tab, after triggering an error). If that state genuinely isn't reachable right now (app not running, MCP not connected, or the state requires steps this skill wasn't given enough context to reproduce), say so and stop - don't guess.

### Step 2: Inspect and try candidates, in priority order

Apply the "Locator Strategy Priority" tier order below (Test ID -> Role -> Label -> Placeholder -> Text -> CSS selector -> derived from a related element), always checked against the actual live DOM - never assume a tier is available because the app "should" have it. Take a snapshot / query `[data-testid]` attributes on the live page before assuming a tier has nothing to offer - verify against the actual DOM, not what a constant or an existing Page Object claims should be there.

### Step 3: Report

- **Found one**: report the locator string, which tier it came from, and a one-line confirmation of how it was verified (e.g. "resolved via `page.getByTestId('order-save-button')`, tier 1").
- **Found nothing**: report exactly what was tried at each tier and why each failed - this is what the caller needs to fall back on its own convention (`write-tests`'s `// UNVERIFIED` marker) or escalate to the user (`heal-tests`'s ask-the-user step). This "don't guess" rule is unconditional for `heal-tests` healing, which always has (or can get) live page access by definition of running the test - it's *not* unconditional for `write-tests` authoring a scenario whose state genuinely isn't reachable yet, which is exactly why `write-tests` skips calling this skill for that narrower case instead of asking it to guess (see "How this skill is invoked" above).
- **Systemic gap**: if the whole page/component's expected identification scheme is missing (not just the one target - the entire Page Object's test-id contract doesn't match what's rendered), say so explicitly rather than reporting a single failed lookup - the caller needs to treat this differently (see `write-tests`/`heal-tests`'s own systemic-gap handling).

---

## Locator Strategy Priority

This is the one canonical source for locator strategy in this kit - `testing-patterns.md`, `write-tests`'s `SKILL.md`, and `heal-tests`'s `SKILL.md` all point here rather than keeping their own copy, so this is the only place to update.

Use this priority order, always checked against the *actual live DOM* - never assume a tier is available because the app "should" have it:

1. **Test ID** (Strong) - `page.getByTestId(TEST_IDS.TOOLBAR.SAVE_BUTTON)` / `page.locator('[data-testid="..."]')`. Treat it as "strong" only once verified - confirmed to actually resolve on the running app, not assumed from a constant.
2. **Role** (Strong) - `page.getByRole('button', { name: 'Save' })`. Reach for this immediately whenever step 1 has no verified test-id - it's the real default, not a last resort.
3. **Label** (Strong) - `page.getByLabel('Email Address')`.
4. **Placeholder** (Strong) - `page.getByPlaceholder('Search orders')`. For inputs that have placeholder text but no accessible label.
5. **Text** (Moderate) - `page.getByText('Submit')`. Only for genuinely stable, non-templated copy - not user-entered data and not copy likely to be reworded without a coordinated content change.
6. **CSS selector** (Weak) - `page.locator('.submit-button')`. Within this tier, still prefer signal over noise:
   - A distinctive, clearly-intentional component class (BEM-ish `block__element--modifier`, or an obviously component-scoped name) is far better than a positional or generic one - combine with `.filter({ hasText: ... })` or a role/aria attribute on the same element if the class alone could match more than one thing.
   - Never rely solely on positional/structural selectors (`nth-child()`, `div > div > span`, a blind `.nth()`).
   - Never rely on framework-generated/hashed classes or attributes (scoped-style attributes, CSS-Modules/emotion/styled-components hashed classnames, anything that regenerates per build) - these break on the next unrelated styling change and signal nothing about intent.
   - Generic utility classes (`.button`, `.active`, `.row`) are fine as a secondary filter, never as the sole selector.
7. **Derived from a related element** (Weak) - when the target itself has no usable signal at any of the tiers above, but a nearby descendant, ancestor, or sibling does, anchor on that related element and traverse the relationship instead of inventing a selector for the target directly:
   - **Child has the signal, need the parent/ancestor**: anchor on the identifiable child and step up - `childLocator.locator('xpath=..')` for the immediate parent, or `childLocator.locator('xpath=ancestor::*[contains(@class,"...")]')` for a specific ancestor further up.
   - **One sibling has the signal, need the other**: `anchorLocator.locator('xpath=following-sibling::*[1]')` / `xpath=preceding-sibling::*[1]`.
   - **Already have a candidate ancestor locator, need to confirm/narrow it by a child's signal**: prefer Playwright's own `.filter({ has: page.getByText(...) })` / `.filter({ hasNot: ... })` over xpath - it's the idiomatic non-xpath way to say "the container that has this identifiable child".
   - Treat the reliability of a derived locator as bounded by the weaker of (a) the anchor's own tier, and (b) how many structural hops it takes - a single, semantically-obvious hop (one parent, one sibling) is reasonable; chaining multiple hops to reach the target is fragile and a sign a better anchor should be found instead.

**Relationship to Playwright's own recommended order**: [Playwright's official locator guidance](https://playwright.dev/docs/locators#locating-elements) ranks `getByRole` -> `getByText` -> `getByLabel` -> `getByPlaceholder` -> `getByTestId` (test-id deliberately last, since it favors user-facing attributes over test-only hooks). This kit intentionally promotes a *verified* test-id to the top instead, because the Page Object suites it targets standardize on `data-testid` as their primary contract and, for a list of same-shaped rows, an explicit hook is often the only unambiguous signal - role/text alone can't tell two "Order" rows apart. That's a deliberate kit-level override, not a rejection of Playwright's reasoning: when a `data-testid` isn't verified/available, fall through the remaining steps above, which are Playwright's own order (Role -> Label -> Placeholder -> Text) before dropping to CSS or a derived locator.

**General rules regardless of which tier you land on:**
- **Don't fabricate a `data-testid`** (or any attribute) that isn't actually rendered by the app - verify live first.
- **Don't chain several weak selectors** hoping one survives - pick the single strongest real signal available (direct or derived), verify it live via MCP/inspection, and write only that.
- **If an entire page/component's expected locators are missing** - not just one stale value, but the whole identification scheme this Page Object assumed no longer matches the app - that's a signal the DOM contract has drifted, not a one-off typo. Flag it to the user as a systemic gap before reworking every locator in the file (see "Systemic gap" under Step 3 above). See `heal-tests`'s "Systemic locator gap" rule for the run-time equivalent of this.

---

## Success Criteria

1. Never fabricates a `data-testid` (or any attribute) that isn't actually rendered by the app
2. Never chains several weak selectors hoping one survives - picks the single strongest real signal, direct or derived
3. Never writes anything to a file itself - reports back, the caller edits
4. If nothing resolves, reports what was tried in enough detail that the caller doesn't need to repeat the inspection itself

---

## MCP Integration

See `${CLAUDE_PLUGIN_ROOT}/patterns/mcp-usage.md` for the shared rule. This is the one place the Playwright MCP browser tools get called for locator discovery/healing purposes - if the server isn't connected, say so and stop, rather than falling back to a guess.

---

**Note**: This skill only discovers. Use `write-tests` to author a test around what it finds, `heal-tests` to fix a failing test using it.
