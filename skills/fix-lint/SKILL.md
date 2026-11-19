---
name: fix-lint
description: Runs the linter and formatter, applies auto-fixes, then manually fixes the remaining lint, format and type errors, optionally scoped to a list of files. Use when lint, format or typecheck fails, or after writing or editing test code.
allowed-tools: Bash, Read, Edit, Glob, Grep
---

> **Plugin note**: this ships in the `qa-kit` plugin, so skills and agents are namespaced `qa-kit:<name>`. If invoking another skill by its bare name (as this document does) fails, retry as `qa-kit:<name>`, or read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it directly.

# Fix Linting Issues

**Project overrides**: if the repo has `.qa-kit/project/conventions.md`, read its *Commands* table first. Its Lint, Lint (auto-fix), Format (auto-fix), Format (check only) and Typecheck commands, and its package manager, replace the `npm run ...` commands written below.

## Project Context

Before fixing lint issues, consult the relevant pattern files for code style and conventions:

- **Testing**: `${CLAUDE_PLUGIN_ROOT}/patterns/testing-patterns.md`
- **Test plan format** (if the lint error is in a generated spec): `${CLAUDE_PLUGIN_ROOT}/patterns/test-plan-format.md`

## Scoped vs. whole-repo

- **No specific files named** (the default, e.g. a bare `/qa-kit:fix-lint`): run whole-repo, per Steps 1-2 below.
- **Invoked with an explicit file list** (e.g. by `write-tests`/`execute-tests`/`review-tests`, scoped to exactly what they touched): lint/format only those files - `npx eslint --fix <files>` / `npx prettier --write <files>` for Step 1, `npx eslint <files>` / `npx prettier --check <files>` for Step 2. This is deliberate, not a shortcut: a caller invoking this mid-pipeline already knows exactly which files it touched, and re-linting the whole repo on every call (potentially 3x per feature) is redundant work and, when several features run in parallel with no isolation between them, a real risk of two whole-repo `--fix` passes racing over the same files at once. `npm run typecheck` (Step 6) stays whole-repo either way - TS project-wide compilation can't be meaningfully scoped to individual files, since a type error can originate from a file that imports the changed one.

## Steps

1. **Run Auto-Fix**:

   ```bash
   npm run lint:fix
   npm run format
   ```

   `npm run lint:fix` auto-fixes ESLint issues, `npm run format` auto-fixes Prettier formatting issues (both defined in `package.json`). Scoped mode: see above.

2. **Check Remaining Errors**:

   ```bash
   npm run lint
   npm run format:check
   ```

3. **Analyze & Fix**:
   If errors remain:
   - Read the specific files with errors
   - Consult the relevant pattern file
   - Fix issues manually (e.g., adding missing types, removing unused variables, fixing import order)

4. **Common Lint Fixes**:
   - **ESLint handles most rules**: formatting, unused imports, import order, and general lint rules (see `eslint.config.js` for the exact rule set)
   - **Unused imports**: Remove them
   - **Missing types**: Add explicit TypeScript types (no `any`)
   - **Import order**: Prefer path aliases (`@helpers/*`, `@factories/*`, etc. - see `tsconfig.json` `paths`) over relative imports across `src/support/*` boundaries

5. **Verify All Lint Passes** (repeat step 2):

   Rerun `npm run lint` and `npm run format:check` to confirm zero errors remain. `npm run validate` runs `format:check` + `lint` + `typecheck` together if you want one command.

6. **Type Check** (if any files were modified):

   ```bash
   npm run typecheck
   ```

   Runs `tsc --noEmit` to verify fixes don't break compilation - a test suite has no build step (it is not a published package), so type-checking is the correctness gate, not a build.
