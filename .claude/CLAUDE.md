# qa-kit - development guide

This file is for working **on** the qa-kit repository. It is not shipped to users. (`templates/AGENTS.md.template` is a different file: it is what `/qa-kit:init` writes into a *consuming* repo.)

**What this repo is**: the public kit `qa-kit` for Playwright test repos: plan tests from Jira/Figma/TestRail, write and heal Playwright tests, review, commit and open PRs, one feature at a time (skills) or several in parallel (pipelines). It ships as a **Claude Code plugin** (marketplace `ngavish-qa`) and as an **OpenCode install** rendered from the same files. The same repo also hosts reusable GitHub composite actions and templates. **The repo is public and must stay employer- and product-agnostic**: no company, product, tenant, host, ticket or person names, no personal e-mail addresses. Everything environment-specific comes from the consuming repo's files or each person's environment variables (`GLEAN_URL`, `TESTRAIL_*`, `FIGMA_API_KEY`). The only project-specific identity that stays is the repo's own (`ngavish-qa`, `ngavishtech/qa-kit`).

Last updated: 2026-11-19. Version in `.claude-plugin/plugin.json` is the source of truth for the kit version.

## Layout

| Path | What it is | In the ZIP? |
|---|---|---|
| `.claude-plugin/plugin.json`, `marketplace.json` | plugin manifest, marketplace listing (`ngavish-qa` -> `qa-kit`, source `./`) | yes |
| `skills/<name>/SKILL.md` | the procedures (17 skills, including `init` and `help`) | yes |
| `agents/` | `test-planner`, `test-writer`, `test-executor`, `test-reviewer`, `test-deliverer`, `test-triager`, `test-monkey`: role + tool grants, each invokes one skill | yes |
| `commands/` | Claude Code `/qa-kit:feature-plan`, `feature-implement`, `feature-deliver`, `feature-monkey`: argument parsing, then call a workflow | yes |
| `workflows/*.js` | the multi-agent pipelines (Workflow-runtime scripts, shared by both agents) | yes |
| `runner/` | agent-neutral Node runner that executes `workflows/*.js` with `--agent claude\|opencode` | yes |
| `tools/` | `cli.mjs`, `install.mjs` (OpenCode install), `merge.mjs` (init's three-way merge and base rebuild; its `renderAll` export is a stable contract), `mcp-user.mjs` (user-level MCP setup, run by `init --user`), `lib/` (rendering, JSON/text merge, MCP conversion, `render-helper.mjs` = the tag-renderer layer). `install.mjs` bundles an explicit file list (`BUNDLED_TOOLS`): a new tool file that `merge.mjs` needs must be added there (a test checks it) | yes |
| `patterns/` | reference docs skills read (`git-safety`, `helper-discovery`, `mcp-usage`, `test-plan-format`, `testing-patterns`, `workflows-reference`, `usage-examples`) | yes |
| `templates/` | what `init` writes into a consuming repo, listed in `templates/manifest.json` | yes |
| `docs/` | `MCP-SETUP-GUIDE.md`, `CLAUDE-DESKTOP.md` | yes |
| `opencode/commands/` | OpenCode wrappers around the runner (hand-written; skill commands are generated at install) | yes |
| `test/` | `node --test`: merge engine, installer, runner, repo integrity | no |
| `evals/` | `claude plugin eval` cases (fixtures, graders) for `verify-coverage` and `triage-failure`; `npm run eval`, real model calls, never part of `npm test` | no |
| `actions/` | GitHub composite actions: `playwright-docker-run`, `allure-report`, `slack-notify` (docs in `actions/README.md`) | no |
| `scripts/package-zip.sh` | builds `qa-kit-<version>.zip` (`--snapshot` to try an uncommitted tree, `--out DIR`); default output `dist/` | no |
| `package.json` | `bin` for `npx`, `npm test`; no dependencies | no |

Everything marked "no" is excluded by `.gitattributes` `export-ignore`. This file lives in `.claude/CLAUDE.md` (the folder is for working on this repo, not part of the plugin), so `.gitattributes` also has `/.claude export-ignore`.

## How the two agents share one source

The repository root is the **only** source and is written in Claude Code form. Nothing generated is committed. For OpenCode, `tools/install.mjs` renders the same files at install time through `tools/lib/render.mjs`:

| In the source | Rendered for OpenCode |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}/skills/x/SKILL.md` | `<config>/skills/qa-kit-x/SKILL.md` |
| `${CLAUDE_PLUGIN_ROOT}/<other>` | `<config>/qa-kit/<other>` |
| `qa-kit:` (commands, skill and agent names) | `qa-kit-` |
| `mcp__server__tool` | `server_tool` |
| skill frontmatter | `name` (prefixed), `description`, `disable-model-invocation` only |
| agent frontmatter | `description`, `mode: subagent` (no tool allow-list) |

So skill, agent, pattern and doc text may use **only** those constructs for anything agent-specific, and must otherwise be agent-neutral ("the agent", "ask the user", "invoke the skill"). `templates/` is not rewritten: it is data written into repos and lists both agents' commands explicitly. `test/tools/install.test.mjs` fails if a rendered file keeps a Claude-only construct; `test/repo/integrity.test.mjs` fails on a dangling path, command or skill reference.

## Rules that always apply

1. **Test and validate before every commit**: `npm test` and `claude plugin validate . --strict`. Both must pass. A notice about license/icon is known and is not a failure.
2. **Release hygiene**: any change consumers should receive needs a `CHANGELOG.md` entry **and** a `version` bump in `plugin.json` (installed copies update only when `version` changes). Plugin tags are plain versions (`0.1.0`, `0.2.0`, ...), no `plugin-v` prefix. `v1`-style tags belong to the GitHub Actions only. OpenCode users get a release by pulling and running `install` again.
3. **Path conventions**:
   - Plugin-internal files are referenced as `${CLAUDE_PLUGIN_ROOT}/...`. Never `.claude/patterns/...` or `.claude/skills/...`.
   - Files that live in the *consuming* repo are `AGENTS.md` (the standards file), `.qa-kit/project/conventions.md` and `.qa-kit/project/testrail-mapping.md`. There is deliberately no fallback to the old `.claude/project/` location; `init` migrates it.
   - Slash commands are always written `/qa-kit:<name>` in source, never bare.
   - Everything qa-kit writes at run time into a consuming repo goes to `qa-kit-artifacts/` (it protects itself with a `*` `.gitignore`); the only other files it owns are the ones listed in `templates/manifest.json` and `.qa-kit/`.
4. **Keep it product-agnostic**: no product vocabulary (for example the domain objects of one specific application) as *instructions* or examples, no `PEAPP-`/`VIS-` keys (examples use `ABC-1234`). Helper and class names in skills (`WaitHelpers`, `AllureHelpers`, `randomString`, ...) are **examples of a concern**: skills must follow `patterns/helper-discovery.md` (find the repo's equivalent first; only if none exists, propose it in the plan's *Proposed Support Additions* and create it during implementation). `.qa-kit/project/conventions.md` always overrides kit defaults. No hardcoded model or vendor identity in shipped instructions: commit and PR attribution follows what the running agent is told to use.
5. **Safety invariants must not weaken**:
   - Nothing is committed by `feature-implement` unless the run was told to (`--commit`, or `--push` / `--pr`, which imply it); `feature-deliver` always commits because running it is the request. Nothing is pushed and no PR is opened unless the run was explicitly told to (`--push` / `--pr`); the pipeline never decides this itself. The runner enforces it in code (deny rules plus post-run checks, exit code 3).
   - `feature-implement --commit` stages only the files the run produced (`ownedFiles`, recorded per plan in the report and carried to the next run), never a file that was modified before the run started (`baselineChanges`), and the runner flags a commit containing a file outside `ownedFiles` or a baseline file (exit code 3). `feature-deliver` is the request to deliver everything the person has changed: it stages **every change git shows in the project folder** (modified, deleted, renamed, staged, and new files that are not ignored), including files modified before the implement run and files that are not test files. Only git (ignored paths never show up) and the staging safety rules leave anything out: a secret file stops it, another package manager's lockfile is skipped and reported as `skippedPaths`. What it stages beyond `ownedFiles` is reported as `handChanges`, named in the commit message and warned about by the runner (a warning, not a violation). Never `git add -A`; never `--no-verify`; never force-push; never commit on the default branch.
   - Monkey testing (`monkey-test`, `feature-monkey`, `test-monkey`) never runs against a production-looking host (no override flag), writes only under `qa-kit-artifacts/monkey/`, never touches git, tracked files or the `.env` file (the runner checks all three), creates data only with the `mk-<runid>-` prefix, deletes only entries of its cleanup ledger (each verified against the ledger immediately before the delete, never in bulk), never deletes and by default never changes data it did not create, and treats protected-looking data (NOT, SOURCE, SEED, TEMPLATE, KEEP markers, fixtures the tests use) as read-only, and never uses `browser_run_code_unsafe` (the agent has no `Edit` tool). The clock lives in `workflows/feature-monkey.js`; a page unit is never retried because it may already have created data.
   - Planning is read-only: it writes only to `qa-kit-artifacts/` and never touches git or any tracked file, and never writes to TestRail.
   - `init` changes an existing file **only** through its plan -> user accepts -> apply flow, per file, never silently, never committing; conflicts are never written into the working file. `install.mjs` overwrites or removes only files it wrote and that are still unmodified (`.managed.json`). Secrets are never written; only variable *names* are reported. No model, provider or API-key settings are ever written.
   - `init` may delete only the unmodified `.qa-kit/base/` copies kit 0.3.x left behind, only through the same plan -> accept -> apply flow (the `remove` entry), only when no file still depends on them, and never runs git. Code from a fetched kit tag (merge base layer 2) runs only after an explicit per-run yes that shows the URL and tag, in a separate process against an empty folder, and never on a non-interactive run. Repo-owned files never trigger that question.
   - Lockfile rule is package-manager neutral: the repo's own lockfile (`yarn.lock` or `package-lock.json` are the two common cases) is allowed with a matching `package.json` change; a different manager's lockfile is a stop-and-warn.
6. **MCP servers live in the consuming repo's config** (`.mcp.json` for Claude Code, `opencode.json` for OpenCode; both from `templates/mcp.json`, the single server list), not inside the plugin, so tool names stay `mcp__atlassian__*` etc. (plugin-bundled servers would be prefixed). Do not move them into the plugin without re-checking every tool grant and permission rule.
7. **User-invocation-only skills stay that way**: `init`, `commit-and-push`, `create-pr`, `write-commit-message` and the three commands set `disable-model-invocation: true`. Agents therefore read those `SKILL.md` files directly (see `agents/test-deliverer.md`); do not "fix" this by flipping the flag without a decision (see below). `test/repo/integrity.test.mjs` pins this.
8. **No secrets or personal data** in the repo: no tokens, no `.env`, no real user names. Never ask users to put tokens in a repo `.env` or on a command line.

## When you change a flag, argument, skill or agent, update all of these

- the Claude command file (`commands/*.md`) **and** its OpenCode wrapper (`opencode/commands/*.md`): flag parsing, `argument-hint`, description
- the runner's argument parsing (`runner/`) and its tests; the workflow's header comment and `args` handling (`workflows/*.js`)
- `patterns/workflows-reference.md` (the one flag and composition table) and `patterns/usage-examples.md`
- `README.md`: usage, runner, "Pilot checklist" if it changes what must be verified
- `templates/` and `templates/manifest.json` if the change affects what `init` writes; `skills/init/SKILL.md` if `init` behavior changes
- the `help` skill's overview (`skills/help/SKILL.md`): one line for every skill, command and flag you add, rename or remove; `npm test` fails when a skill or command is missing from it
- a report field (`ownedFiles`, `skippedPaths`, `coverageGaps`, ...): the workflow's schemas and report, `runner/lib/state.mjs` (what is handed to the next run or to `feature-deliver`), `runner/lib/guard.mjs`, `SUMMARY_FIELDS` in `runner/qa-kit.mjs`, both command files and their OpenCode wrappers, and the report shape in `patterns/workflows-reference.md`
- `tools/lib/render.mjs` and its tests if you introduce a new agent-specific construct (avoid that: prefer neutral prose)
- `CHANGELOG.md` and `version`

Workflow files use `export const meta` plus a top-level `return` (Workflow-runtime format), so a plain `node --check` reports a syntax error on them; that is expected. The runner loads them by wrapping the body: `new Function('args','agent','log','pipeline','parallel','return (async()=>{'+src.replace(/^export const meta/m,'const meta')+'})()')`. Phase titles in `meta.phases` must match, character for character, the `phase:` strings passed to `agent()`.

## Decisions already made (do not re-litigate without the owner)

- **Public and agnostic**: no employer, product or tenant values anywhere (a scan for them is part of every release). The Glean endpoint is `${GLEAN_URL}`, exactly like the TestRail and Figma variables: if a person does not export it, Claude Code still loads the server with the literal `${GLEAN_URL}` text, warns about the missing variable and the server cannot connect (OpenCode behaviour with an unset `{env:GLEAN_URL}` is unverified).
- **Two first-class agents: Claude Code and OpenCode (V2 schema)**; IntelliJ, WebStorm and VS Code are reached through those agents' own IDE integration or terminals. Other agents read `AGENTS.md` / `.agents/skills` on their own and are unsupported. Models are whatever each person's agent is configured with: the kit adds no model, provider or cloud-vendor handling.
- **One source, no committed generated output.** The root files are rendered for OpenCode at install time; a second committed copy (`src/` + generated root) was tried and rejected as duplication.
- **Thin repo layer + user-level install.** Claude Code gets the plugin from the marketplace (offered by the committed `.claude/settings.json`); OpenCode users clone the kit once to `$HOME/.qa-kit-src` (outside any project repo) and run `tools/cli.mjs install` from there. No vendored copy of the kit goes into consuming repos.
- **One pipeline source.** `workflows/*.js` are shared; Claude Code runs them with the Workflow tool, OpenCode and CI with `runner/qa-kit.mjs`. The runner is not (yet) used for Claude Code interactively.
- **Repo layer updates are a reviewed three-way merge, and the base is not stored in the repo.** `.qa-kit/manifest.json` records a hash and the kit tag per managed file; on update `tools/merge.mjs` (`resolveBase`) rebuilds the previous output in layers, each accepted only if it hashes to the recorded value: (1) the tag's templates rendered with the installed renderer and the stored vars, (2) the renderer shipped in the tag (`tools/lib/render-helper.mjs`, a separate process against an empty folder; runs fetched code, so only after the user agrees, `--base-renderer tag`), (3) fallback = the existing no-base behaviour (text `unknown-base` review copy, JSON additive merge): never an overwrite, and the report lists every fallback. `.qa-kit/base/` of kit 0.3.x is handled by one isolated migration (`migrateLegacyBase`, the `remove` plan entry, `removeLegacyBase`): used once as the base if it still matches its recorded hash, then removed through the normal plan -> accept -> apply flow when nothing is unresolved and every copy is unmodified; delete that code once nobody is on 0.3.x. `renderAll` in `merge.mjs` is a stable export (layer 2 calls it on old tags): keep its signature. `.qa-kit/project/conventions.md` is `update: merge` like `AGENTS.md`: the team edits it and `init` pre-fills it, so a kit change and a team change are merged three-way and a clash becomes a review copy, never an overwrite (the kit adds rows and sections to it over time). `.qa-kit/project/testrail-mapping.md` stays `update: once`: created once, then the repo's alone. **Consequence for releases:** tags must exist, be plain versions and never move; a missing or moved tag only degrades the next update to the fallback.
- **Helper discovery**: match the repo's own helpers by purpose first (reference catalog in `patterns/helper-discovery.md`), then propose and create what is missing as part of plan and implementation.
- **Subfolder install (`init --path`)**: for repos that are not only automation. The folder becomes the whole qa-kit install (all files and `.qa-kit/`), the agent is started there, nothing goes to the repo root. Chosen over root `CLAUDE.md`/`AGENTS.md` pointers and over a "load from path" skill because Developers would load those too and a skill cannot register MCP servers, permissions or `opencode.json`. Path resolution, escape checks and "already installed elsewhere" detection are code (`tools/lib/locate.mjs`, `merge.mjs locate`), tested; the skill only follows its JSON. The CI workflow stays a user-requested offer with a TODO.
- **Post-init report is code, not prose.** `merge.mjs status` (`tools/lib/status.mjs`) builds the list of everything qa-kit owns (config, `.qa-kit/**`, optional CI file; leftover 0.3.x `base/` copies are reported separately as `legacy`) and what git thinks of each; the init skill only prints it, on every run. Skills stay usable in any folder (no "is qa-kit set up here" preflight): the plugin also serves people who never ran `init`.
- **Artifacts folder**: `qa-kit-artifacts/` replaced `temp/`; created with a self-ignoring `.gitignore`; `init` also lists it in the repo `.gitignore`, (it no longer writes a `.gitattributes` line or a `.qa-kit/base/` folder; see the update decision above). `init` reports files the repo's own ignore rules swallow, and lists the paths to stage.
- **CI step in `init` is gated**: offered only when an action tag `v<N>` exists on this repo's remote; agent usage does not depend on the GitHub Actions.
- **Settings template** (Claude Code) pre-approves read-only git/`gh` commands and edits to the test source and `qa-kit-artifacts/`; commit, push, checkout, worktree add, fetch and `gh pr create` stay as prompts. No OpenCode permission rules are generated yet.
- **No OpenCode permission rules for now; residual risk documented** (README "Known limitations"): outside the runner nothing blocks `git push` / `gh pr create` or enforces the user-invocation-only skills on OpenCode. Revisit after the OpenCode spike.
- **Agent tool lists stay explicit.** The Playwright tool list in `test-writer` / `test-executor` excludes `browser_run_code_unsafe` on purpose; do not collapse it to a wildcard.
- **No 0.1.0 compatibility layer.** Nobody has installed 0.1.0; anyone who did uninstalls it and starts fresh on 0.2.0. Skills read only `.qa-kit/project/` and do not warn about the old `.claude/project/` location (`init` still offers a `move` for repos that have it).
- **Rendered folders carry only the Claude form.** Skills, agents, patterns and docs are rewritten for OpenCode at install time, so never name the OpenCode form of a command, prefix or tool name there (it renders twice); `README.md` and `templates/` are not rendered and may show both. A repo-integrity test enforces this.
- **MCP packages stay on `@latest`** (with `-y`): no pinned versions in `templates/mcp.json`. Old versions must not live here; fix incompatibilities when they happen.
- **MCP**: Atlassian stays on the v1 endpoint for now (move to v2 before 2027-03-01 and re-check tool names and permissions); users export the TestRail/Figma keys and `GLEAN_URL` in their own environment, never in a repo `.env`.
- **Deferred on purpose** (PoC scope): hardening of the GitHub actions (conditional AWS/Ruby steps, Slack payload escaping, the unguarded `typescript@` install), release automation.

## Needs a human decision (ask, do not guess)

- License: the repo is public and currently has none (all rights reserved by default); pick one (for example MIT or Apache-2.0) and set the `license` field in `package.json` and `plugin.json`.
- Whether to flip `disable-model-invocation` on the Deliver skills instead of the read-the-file path.
- Moving to the Atlassian v2 MCP endpoint.
- Tagging `v1` for the actions (only after the CI items in `actions/README.md` pass).
- Whether Claude Code should also run its pipelines through the runner.
- A co-author trailer identity for OpenCode-authored commits (default: whatever the agent is told to use, else none).
- Running the renderer from a fetched kit tag (merge base layer 2): it is opt-in, asked once per run with the URL and tag shown, and never on a non-interactive run, but it is code execution from a repository, so the owner confirms it is acceptable.
- Anything that loosens a safety invariant above.

## How to test a change

1. `npm test` and `claude plugin validate . --strict`. After changing `verify-coverage` or `triage-failure`, also `npm run eval` (real model calls; see `evals/README.md`).
2. Claude Code: from a second, clean Playwright repo `claude --plugin-dir <path-to-this-repo>`, then `/reload-plugins` after each edit. Smoke path: `/qa-kit:init` (throwaway repo), `/qa-kit:plan-tests ABC-1234`, `/qa-kit:feature-plan ABC-1234`, `/qa-kit:feature-implement qa-kit-artifacts/ABC-1234-test-plan.md`.
3. OpenCode: `node tools/cli.mjs install --dir <tmp>` to inspect the rendering (`--dry-run` lists it), then a real install and the same smoke path with `/qa-kit-...` commands.
4. Still unverified: see the README "Pilot checklist" (OpenCode runtime behaviour, Claude `scriptPath` expansion, the Deliver stage reading skill files, the GitHub actions) before announcing.

## Release

1. Edit; update `CHANGELOG.md`; bump `version` in `.claude-plugin/plugin.json` and the `Version:` line at the top of `README.md` (a test checks they agree).
2. `npm test`; `claude plugin validate . --strict`; commit to the default branch.
3. Desktop-app ZIP (optional): `bash scripts/package-zip.sh` (needs a clean, committed tree) and upload `dist/qa-kit-<version>.zip`.
4. Tag the plugin with the plain version: `git tag X.Y.Z` then `git push origin X.Y.Z` (separate commands; no `plugin-v` prefix). **Do this before anyone updates to the release, and never move or delete a published tag**: `init` rebuilds the merge base from the tag that wrote each file, so a missing or moved tag sends those files to the first-time-merge fallback. `init` checks the tag it records and reports `missing`/`differs` (verify it with a real `init` before announcing).
5. Actions only, after a successful real run: `git tag -f v1 && git push -f origin v1` (the template already points at `https://github.com/ngavishtech/qa-kit`); allow org access under Settings -> Actions -> General -> Access.

## Style

Match the surrounding docs: short imperative sentences, tables for lookups, plain ASCII hyphens, examples with `ABC-1234`. Do not add comments that restate what the text already says. Prefer one canonical place for a rule and point to it, instead of copying it into several files.
