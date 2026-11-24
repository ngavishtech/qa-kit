# Change Mapping

Optional, per-repo file at `.qa-kit/project/change-mapping.md` (created by qa-kit's `init`, then yours to edit; never auto-updated).

It records **which application paths belong to which feature**, so `analyze-changes` (and through it `feature-select` and `feature-diff`) can tell which tests a change affects. It is one of two sources: the analysis always also infers the same thing on its own from paths, diffs, ticket keys and the test index, and it crosses the two. Where they agree the confidence is high; where they differ the report lists it so you can improve this file.

Nothing requires this file. Without it the analysis runs on inference alone, with lower confidence, and the selection falls back to the full suite more often.

---

## Settings

- **App repos**: `<org/app>` - the GitHub repos that hold the application code, when it is not this repo (a product that spans several services lists each one, comma-separated). Listing them is documentation for the team and for the report; the repos analysed are the ones named with `--repo` or in a pull request. Leave as `none` when the application code is in this repo.
- **Full-run threshold**: `60` - when the selected spec files are more than this percent of all spec files, the selection answers the full suite.
- **Global paths**: paths where any change means a full run, one glob per line as an indented bullet. The kit already treats dependency manifests and lockfiles, Playwright, TypeScript and build config, global and authentication setup, CI workflow files, Docker files, migrations and locale folders as global; list anything else here.
  - `<glob>`
- **Ignorable paths**: paths where a change never needs a test, one glob per line as an indented bullet. The kit only treats a root README or LICENSE, the `docs/` folder and repository meta files as ignorable; a Markdown or text file anywhere else may be content the application shows, so it is not ignorable unless you list it here.
  - `<glob>`
- **Shared paths**: application folders whose change can affect every feature (a layout, a router, an auth or http client, a shared component library), one glob per line as an indented bullet. A change there always runs the full suite. The kit already treats `shared`, `common`, `core`, `layout`, `router`, `middleware`, `interceptors`, `auth` and `http-client` folders as shared.
  - `<glob>`

---

## Schema

One `###` heading per feature, named like the feature tag in your code (a `TestFeature` value, if you have one). The same names appear in `testrail-mapping.md`; keep them in sync.

```markdown
### <FEATURE, e.g. ORDERS>

- **App paths**: `<glob>`, `<glob>` (application source that implements this feature; paths from the application repo root, or from this repo's root when the code is here). With several app repos write `org/app:<glob>` to match only in that repo; a glob with no prefix matches in every repo
- **Spec folders**: `<folder>`, `<folder>` (where this feature's tests live)
- **Notes**: <anything the analysis should know: a shared component, a feature that is only reachable through another one>
```

A feature with no paths yet stays exactly:

```markdown
### <FEATURE>

_Unmapped - no application paths recorded yet._
```

---

## Contract with `analyze-changes`

- The file is **read, never edited** by qa-kit. A glob that matches nothing, or a spec folder that does not exist, is reported, never silently ignored.
- A mapping hit is one source of evidence, not the answer: the inference runs anyway and its candidate tests are added (the union), so a stale entry here can only make a selection wider, never hide a test.
- A value still written in angle brackets (`<glob>`, `<org/app>`) is unset and is ignored.
- An unmapped feature, or a path nothing matches, is not an error: that change gets a lower confidence unless inference finds it.

---

## Feature Mappings

<!-- Add one section per feature area, using the schema above. -->

### EXAMPLE_FEATURE

_Unmapped - replace this example with your first real feature._
