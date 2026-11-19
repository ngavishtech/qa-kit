# TestRail Mapping

Optional, per-repo file at `.qa-kit/project/testrail-mapping.md` (created by qa-kit's `init`).

It records **where in TestRail each feature area lives** - one or more exact `{ project, suite, section }` locations plus a short keyword list - so `plan-tests` (Step 3) can query an exact, scoped TestRail location instead of searching a whole instance.

Nothing requires this file. If it is missing, or a feature is `Unmapped`, the TestRail cross-check for that feature is skipped (reported as unavailable in the plan's "Existing Coverage" section) - it never falls back to an unscoped search.

---

## Schema

Each feature area gets its own `###` heading under "Feature Mappings", with zero or more Location blocks (a feature can live in several TestRail locations):

```markdown
### <FEATURE, e.g. CHECKOUT>

- **Location**:
  - Project: `<projectId>` (`<project name>`)
  - Suite: `<suiteId>` (`<suite name>`)
  - Section: `<sectionId>` (`<section path, e.g. "Checkout > Payment">`)
  - Keywords: `<literal>`, `<literal>` (filters `getCases` results within this section; matched literally, not fuzzy)
```

A feature with no location yet stays exactly:

```markdown
### <FEATURE>

_Unmapped - no TestRail location recorded yet._
```

---

## Contract with `plan-tests`

- An explicit TestRail location given for a plan (a `testrail:<projectId>/<suiteId>[/<sectionId>]` token, a TestRail URL, or one found inside a Jira ticket) **wins over this file entirely** for that plan.
- Otherwise `plan-tests` looks up every feature the plan touches, unions the Location blocks (deduplicated), and calls `mcp__testrail__getCases` scoped to exactly each `projectId`/`suiteId`/`sectionId`. Keywords filter within that scope; they never replace it.
- `plan-tests` never edits this file. It is manually maintained by whoever knows the real TestRail structure.
- If the feature names here mirror an enum in your codebase (e.g. a `TestFeature` enum), keep them in sync in the same change.

Look up real IDs via the TestRail MCP (`mcp__testrail__getProjects` / `getSuites` / `getSections`) or the TestRail UI - never guess an ID from a name. Keep keywords to 2-5 literal terms that actually appear in case titles.

---

## Feature Mappings

<!-- Add one section per feature area, using the schema above. -->

### EXAMPLE_FEATURE

_Unmapped - replace this example with your first real feature._
