# qa-kit

The org's QA automation toolkit for Playwright test repos: plan tests from Jira/Figma/TestRail, write and heal Playwright tests, review, commit and open PRs - one feature at a time with skills, or several in parallel with pipelines. It runs on **Claude Code** and **OpenCode**, from the terminal or inside IntelliJ, WebStorm and VS Code.

**Public and product-agnostic.** The kit carries no company, product or tenant names. Everything specific to your setup (your Glean URL, TestRail instance, secrets) comes from your own environment variables or your own repo files. The marketplace is `ngavish-tech`, served from this repository.

Version: **0.10.0** (the top entry of `CHANGELOG.md`; `.claude-plugin/plugin.json` is the source of truth). Status: not yet piloted - read "Pilot checklist" before rolling out.

## Contents

| I want to... | Go to |
|---|---|
| understand what it does and who does what | [How it works](#how-it-works) |
| install the tools I need first | [Prerequisites](#prerequisites-one-time-per-person) |
| install qa-kit on my machine | [Install the kit](#install-the-kit-once-per-machine) |
| set up a Playwright repo | [Set up a repo (`init`)](#set-up-a-repo-init-once-per-repo) |
| work in a repo someone else set up | [Joining a repo that is already set up](#joining-a-repo-that-is-already-set-up) |
| plan, write, run, review and deliver tests | [Using qa-kit day to day](#using-qa-kit-day-to-day) |
| move to a new qa-kit version | [Updating to a new version](#updating-to-a-new-version) |
| plan tests with no repo at all | [Using qa-kit without a repo](#using-qa-kit-without-a-repo) |
| fix something that does not work | [Troubleshooting](#troubleshooting) |
| look something up | [Reference](#reference): Windows notes, consumer contract, CI, what is inside |
| change or release the kit itself | [Develop, release and verify](#develop-release-and-verify) |

## How it works

qa-kit turns a requirement (a Jira ticket, a Figma design, or plain text) into reviewed Playwright tests, in stages you can run one at a time or chain. You stay in control: planning stops for your review, and nothing is committed, pushed or turned into a PR unless you ask.

```
requirement --> PLAN --> (you review) --> WRITE --> RUN + HEAL --> REVIEW + FIX --> COMMIT --> (push) --> (PR)
 Jira/Figma/     plan-tests            write-tests  execute-tests   review-tests     commit-    commit-    create-pr
 text            read-ticket                        heal-tests      apply-review-    and-push   and-push
                                                                    fixes
```

### The lifecycle

| Step | Who, how often | What happens | Details |
|---|---|---|---|
| 1. Prerequisites | each person, once | git, `gh`, Node 22+, personal credentials in your shell environment | [Prerequisites](#prerequisites-one-time-per-person) |
| 2. Install the kit | each person, once per machine | Claude Code: a plugin from the `ngavish-tech` marketplace. OpenCode: a clone in `$HOME/.qa-kit-src` plus `install` | [Install the kit](#install-the-kit-once-per-machine) |
| 3. Set up the repo | **one person, once per repo** | `/qa-kit:init` writes the repo layer (instructions, permissions, MCP servers, conventions); you review it as a plan, then commit it in a PR | [Set up a repo](#set-up-a-repo-init-once-per-repo) |
| 3b. Join a repo | everyone else | install the kit (step 2), pull the repo, start the agent in the right folder. No `init` | [Joining](#joining-a-repo-that-is-already-set-up) |
| 4. Work | everyone, every day | plan -> review -> implement -> deliver, manual or as pipelines | [Day to day](#using-qa-kit-day-to-day) |
| 5. Update | everyone updates the kit; **one person per repo** re-runs `init` and opens a PR | a reviewed three-way merge keeps your edits on top of the new kit content | [Updating](#updating-to-a-new-version) |
| Alternative | anyone, no repo | plan from a ticket with MCP servers registered at user level | [Without a repo](#using-qa-kit-without-a-repo) |

### Where things live

| Level | What | Where | Committed? |
|---|---|---|---|
| User (per machine) | the kit itself: skills, agents, commands | Claude Code plugin, or `~/.config/opencode` after `install` | No |
| User (per machine) | credentials | your shell environment only (never a `.env`, never the repo) | No |
| Repo (per repo) | instructions, permissions, MCP servers, conventions, `.qa-kit/manifest.json` | the git root, or the folder you pass to `init --path` | **Yes** |
| Run time | plans, review copies, commit and PR text, pipeline reports | `qa-kit-artifacts/` in the folder you work in (ignores itself) | Never |
| Parallel runs | one git worktree per feature | `<git root>/../worktrees/<slug>` (outside the repo) | Never |

### Supported agents

| | Claude Code | OpenCode |
|---|---|---|
| Install | plugin from the `ngavish-tech` marketplace | `node "$HOME/.qa-kit-src/tools/cli.mjs" install` from a checkout kept outside any project repo (user-level, once per machine) |
| Skills | `/qa-kit:plan-tests ...` | `/qa-kit-plan-tests ...` |
| Pipelines (`feature-plan`, `feature-implement`, `feature-deliver`, `feature-monkey`, `feature-select`, `feature-diff`) | `/qa-kit:feature-plan ...` (Claude's Workflow tool) | `/qa-kit-feature-plan ...` (runs the Node runner) |
| Repo instructions | `CLAUDE.md` -> imports `AGENTS.md` | `AGENTS.md` |
| MCP servers | `.mcp.json` | `opencode.json` (generated from the same server list) |
| In the IDE | IntelliJ/WebStorm: Claude Code JetBrains plugin. VS Code: the extension or the terminal | IntelliJ/WebStorm/VS Code: the integrated terminal |

- **Models** are whatever your agent is already configured to use. qa-kit never writes model, provider or API-key settings.
- Other agents (Cursor, Copilot, Codex, Junie, ...) read `AGENTS.md` and `.agents/skills` by themselves, but are not tested or supported here.
- **"Nothing is pushed unless you ask" and where it is enforced.** Claude Code: the repo's `permissions` leave `git push` and `gh pr create` as prompts, and the runner denies them in code. OpenCode, interactive: nothing in the kit blocks them; the protection is the skills' own confirmation prompts. OpenCode, runner: only the post-run checks (see "Known limitations").
- One release serves both agents. The repository root is the only source: Claude Code reads it as a plugin; for OpenCode, `install` renders the same files (command prefix, tool names, paths, frontmatter) into your OpenCode config folder, so nothing is generated or duplicated in git.

## Prerequisites (one-time, per person)

Credentials are personal: each person uses their own tokens; nothing here is stored in the kit or in a repo.

| # | Requirement | Needed for | How |
|---|---|---|---|
| 1 | **Claude Code** and/or **OpenCode**, already configured with your own models | everything | your usual setup |
| 2 | **Git** | all git skills, worktrees in the pipelines, installing and updating the kit | https://git-scm.com/downloads, then `git config --global user.name` / `user.email` |
| 3 | **GitHub CLI (`gh`)**, installed **and logged in** | `create-pr`, PR review, default-branch detection | `winget install --id GitHub.cli` / `brew install gh`, then `gh auth login` (Enterprise: `--hostname <host>`). Check `gh auth status` |
| 4 | **Node.js 22 or newer** (includes `npx`) | the Playwright, Figma and TestRail MCP servers, the installer, the runner | https://nodejs.org, then in the test repo `npm ci` and `npx playwright install` |
| 5 | **Atlassian sign-in** (OAuth, no token) | Jira and Confluence (`read-ticket`, `plan-tests`) | first use opens a browser (Claude Code: `/mcp` > `atlassian` > Authenticate) |
| 6 | **`GLEAN_URL`** environment variable, then **Glean sign-in** (OAuth, no token) | read-only alternative to #5 | `GLEAN_URL` is your Glean MCP URL (ask your Glean admin); then the same sign-in flow with `glean_default`. Without `GLEAN_URL` the server is still listed but cannot connect (Claude Code shows a missing-variable warning in `/mcp`) |
| 7 | **`FIGMA_API_KEY`** environment variable | planning from a Figma link | Figma > Settings > Personal access tokens (read-only is enough) |
| 8 | **`TESTRAIL_URL`**, **`TESTRAIL_USERNAME`**, **`TESTRAIL_API_KEY`** | TestRail coverage cross-check | URL of your instance; your login email; key from My Settings > API Keys (an admin must have enabled the API) |

You need #5 or #6 for Jira-based planning. #7 and #8 are only needed to *use* Figma and TestRail; without them planning still works and lists those sources as unavailable. The Playwright MCP needs no credentials. Slack tokens are used only by the CI actions, at organization level.

The variables must be real environment variables of the process that starts your agent; a `.env` file is **not** read by the MCP servers. How to set them per OS, how to verify, and per-server troubleshooting: `docs/MCP-SETUP-GUIDE.md`. `init` repeats the checks and prints only "set" or "MISSING".

Git access matters twice: installing the kit clones this repository, and later **updating a repo** (`init`) fetches one kit tag from it again (see "Updating to a new version"). If `git clone https://github.com/ngavishtech/qa-kit` works for you, both work. Whoever runs `init` to update a repo needs that read access on their own machine: someone who installed the kit from a ZIP in the Claude desktop app because they cannot reach the repository cannot rebuild the previous version of the files, and every file then takes the first-time merge (nothing is overwritten).

## Install the kit (once per machine)

Everyone does this once per machine, including people who join a repo that is already set up. The marketplace is registered once and the plugin installed once per machine.

### Claude Code (terminal)

```
/plugin marketplace add https://github.com/ngavishtech/qa-kit
/plugin install qa-kit@ngavish-tech
```

The same from a shell, without opening a session (`--scope user` makes it available in every project on the machine):

```bash
claude plugin marketplace add https://github.com/ngavishtech/qa-kit
claude plugin install qa-kit@ngavish-tech --scope user
```

**You do not clone anything for Claude Code.** `qa-kit@ngavish-tech` means "plugin `qa-kit` from the marketplace named `ngavish-tech`", and that name is defined in this repository's `.claude-plugin/marketplace.json`. The first command is what tells Claude Code *where* the repository is: it clones it by itself into `~/.claude/plugins/marketplaces/ngavish-tech` using the git credentials already on your machine (SSH key or credential helper). The second command installs the plugin from that copy. One-command form, Claude Code 2.1.292 or newer: `claude plugin install qa-kit --marketplace ngavishtech/qa-kit --scope user`. Restart Claude Code or run `/reload-plugins` afterwards. (OpenCode is different: it needs the clone below.)

`claude plugin install qa-kit@ngavish-tech --scope user` refreshes the marketplace first, so it installs the latest version published on the repository's default branch. To be explicit, run `claude plugin marketplace update ngavish-tech` before it. Installing before a release is merged gives you the older version; update afterwards (see "Updating to a new version").

### Claude desktop app (Windows and Mac, clicks only)

1. Open the app, sign in, click **Customize** in the sidebar, then **Plugins**.
2. Click **Add**, then **Add marketplace**, and enter `ngavishtech/qa-kit` (or `https://github.com/ngavishtech/qa-kit`).
3. If the dialog cannot read the repository (for example your GitHub organization restricts apps): click **Connect GitHub**, then **Install the Claude GitHub App**; a GitHub owner may have to approve the app first.
4. Open the marketplace `ngavish-tech`, select **qa-kit** and click **Add**.
5. Check: type `/` in a conversation (the skills show with the plugin name), or open a **Code** tab session on your computer and type `/qa-kit:`.

This install belongs to your **account**: Chat, Cowork and the Code tab get it, and a terminal Claude Code only when it is signed in with the same claude.ai account (not with Bedrock or an API key), after `/reload-plugins`. A command-line install (`claude plugin install qa-kit@ngavish-tech --scope user`) is the opposite: it reaches the terminal, IDEs and the Code tab but is not shown under **Customize > Plugins**. If you work in the terminal, use the command; add this account install only for Chat or Cowork. No access to the repo from the app: **Add > Upload plugin** with the ZIP instead. Details, the ZIP route and what each part of the app supports: `docs/CLAUDE-DESKTOP.md`.

### Org-wide (admins)

Put the same two keys in Claude Code **managed settings**:

```json
{
  "extraKnownMarketplaces": { "ngavish-tech": { "source": { "source": "git", "url": "<git url of this repo>" } } },
  "enabledPlugins": { "qa-kit@ngavish-tech": true }
}
```

Optionally add `strictKnownMarketplaces` to restrict which marketplaces users can add.

### OpenCode

Clone the kit **once, to a fixed location outside any project repo** (not inside a Playwright repo), then install:

```bash
git clone <git url of this repo> "$HOME/.qa-kit-src"
node "$HOME/.qa-kit-src/tools/cli.mjs" install     # copy skills, agents, commands and support files into ~/.config/opencode
node "$HOME/.qa-kit-src/tools/cli.mjs" status      # installed version vs this checkout
node "$HOME/.qa-kit-src/tools/cli.mjs" uninstall   # remove what install wrote
# options: --dir <opencode config dir>  --dry-run  --force
```

Restart OpenCode afterwards. Use the same checkout for `status`, `uninstall` and `mcp`.

- It writes `skills/qa-kit-*`, `agents/qa-kit-*`, `commands/qa-kit-*` and a `qa-kit/` support folder (patterns, templates, docs, workflows, runner, merge tool) and records every file in `qa-kit/.managed.json`.
- Update and uninstall only replace or remove files that are still exactly what the kit wrote. A file you edited, or one that is not the kit's, is skipped and listed; `--force` overrides.
- Every skill is also a command (`/qa-kit-<skill>`), because OpenCode exposes skills to the model but not as slash commands.
- Node 22 or newer and `git` must be on PATH.

### Check that it worked

| | Claude Code | OpenCode |
|---|---|---|
| Restart | restart Claude Code, or `/reload-plugins` in a running session | restart OpenCode |
| Version | `claude plugin list` shows `qa-kit@ngavish-tech` with the version of the top entry of `CHANGELOG.md`, scope `user`, enabled | `node "$HOME/.qa-kit-src/tools/cli.mjs" status` |
| Commands | typing `/qa-kit:` lists the commands and skills; `/qa-kit:help` explains them | typing `/qa-kit-` lists them; `/qa-kit-help` explains them |

### Uninstall

Claude Code: `claude plugin uninstall qa-kit@ngavish-tech` (and `claude plugin marketplace remove ngavish-tech` if you also want the marketplace gone). OpenCode: `node "$HOME/.qa-kit-src/tools/cli.mjs" uninstall`. Neither touches any repo; the files `init` wrote stay until you delete them (the list is under "Set up a repo").

## Set up a repo (`init`, once per repo)

One person does this per repo. A plugin cannot carry project instructions or permission rules, so `init` creates them in the repo, for the agents the team uses. It never commits, never writes secrets or model/provider settings, and reports only the *names* of missing environment variables.

### The flow

1. **Start the agent** in the repo, or in the folder you want qa-kit in (see "Which kind of repo" below).
2. **Run `/qa-kit:init`** (Claude Code) or `/qa-kit-init` (OpenCode). Flags:

   | Flag | Meaning |
   |---|---|
   | `--path=<folder>` | install in a subfolder of a repo that is not only test automation (see below) |
   | `--dry-run` | print the plan and stop; nothing is written |
   | `--agents claude,opencode` | which agents the team uses (default: detected from `.claude/`, `opencode.json` and the CLIs on PATH, else both) |
   | `--kit-url <git url>` | the kit's git URL (default: the `repository` field of the plugin manifest) |
   | `--user` (with `--servers a,b`) | no repo: register the MCP servers at user level (see "Using qa-kit without a repo") |

3. **Answer a few questions**, only for what it cannot detect (and where to install, if you start in a subfolder): which agents, the kit's git URL, `PROJECT_NAME` / `PRODUCT_NAME` (default: `package.json` `name`) and `TEST_SOURCE_DIR` (the top-level folder holding both tests and support code, such as `src`). It also reports, without fixing, whether the repo meets the "Consumer contract" and which personal prerequisites are set or MISSING.
4. **Read the plan.** Nothing is written yet. Each file gets a status and a diff (table under "Updating to a new version"). On a first run in a clean repo everything is `create`.
5. **Accept** all, some or none. Existing files change only here, one file at a time, never silently. A file that cannot be settled automatically (`conflict`, `unknown-base`, for example an existing `CLAUDE.md` with real content) is not written: you get a review copy under `qa-kit-artifacts/merge/` and the agent resolves it with you, hunk by hunk.
6. **Fill in `.qa-kit/project/conventions.md`.** `init` pre-fills what it can detect (test folder, package manager, default branch, path aliases); you correct the rest. It overrides the kit's defaults for every skill.
7. **Read the report.** It lists what was created or updated, what is left to commit, and which files your repo's ignore rules swallow (see "Nothing is forgotten after `init`").
8. **Commit and open the PR**, staging the listed files by path. Then restart the agent, approve the project MCP servers when asked and sign in to `atlassian` and `glean_default` (`/mcp` in Claude Code; OpenCode asks on first use).

`init` is safe to repeat at any time: the report is how you check that the setup was committed completely.

### What `init` writes

| File | Purpose | Agent | Commit it? |
|---|---|---|---|
| `AGENTS.md` | the repo's principles, standards and how to use qa-kit; the one instructions file | both | Yes |
| `CLAUDE.md` | a one-line `@AGENTS.md` import (Claude Code ignores `AGENTS.md` when a `CLAUDE.md` exists) | Claude | Yes |
| `.claude/settings.json` | `permissions.allow` rules, marketplace registration, plugin enabled | Claude | Yes |
| `.mcp.json` | MCP servers (kept in the repo so tool names stay `mcp__atlassian__*`) | Claude | Yes |
| `opencode.json` | the same MCP servers, converted | OpenCode | Yes |
| `.qa-kit/project/conventions.md` | layout, path aliases, feature enum, scripts, default branch - **overrides** kit defaults | both | Yes. Yours to edit. `init` merges the kit's improvements into it on an update: your edits stay, a change to the same lines becomes a review copy for you to resolve. |
| `.qa-kit/project/testrail-mapping.md` | optional: feature -> TestRail project/suite/section | both | Yes. Yours to edit; never auto-updated. |
| `.qa-kit/project/change-mapping.md` | optional: application paths -> feature, global and ignorable paths, the app repo, the full-run threshold (used by change analysis) | both | Yes. Yours to edit; created once, never auto-updated. |
| `.qa-kit/manifest.json` | kit version, agents, answers given, a hash and kit tag per managed file | both | Yes. The next update rebuilds the merge base from it. |
| `.gitignore` | adds `qa-kit-artifacts/` | both | Yes |
| `qa-kit-artifacts/.gitignore` (`*`) | makes the artifacts folder ignore itself | both | No, by design |
| `.github/workflows/run-tests.yml` | CI caller workflow, **only if you ask** (see below) | CI | Yes |

`<project>` in the other sections means the git root, or the folder you pass to `--path`. Everything above is written there.

**CI workflow (optional).** `init` offers `templates/github/run-tests.yml` only when no workflow already uses `actions/playwright-docker-run`, the kit's repository can be derived from its URL, and the kit repository has an action tag `v<N>`. It asks once, then asks for `COMPOSE_SERVICE_NAME` and `SLACK_CHANNEL_ID`, and never creates secrets or variables. Agent usage does not depend on it. See "CI building blocks".

### Which kind of repo

| Kind of repo | Result of `init` |
|---|---|
| Automation-only (all of it is tests) | Right as is: everything at the repo root, and everyone who opens the repo is meant to use qa-kit. |
| Mixed (application code and tests together), default `init` | The same root files also reach the Developers: their agents load `AGENTS.md`, have the plugin enabled for them and get the MCP servers. Avoid; use `--path`. |
| Mixed, `init --path=<folder>` | Everything, `.qa-kit/` included, goes into that folder and the repo root stays as the Developers have it. Only people who start the agent in that folder get qa-kit. |

**Subfolder install (`--path`).** Run `/qa-kit:init --path=<folder>` (for example `--path=automation`). The path is relative to the folder you run it from, a leading `/` included (`--path=/myfolder/test` means `./myfolder/test`); it cannot leave the git repository. Developers elsewhere in the repo get no `AGENTS.md`, `CLAUDE.md`, MCP servers or plugin offer. After that, **start Claude Code or OpenCode from that folder** and run `/qa-kit:init` for updates from there (no flag). Run from a subfolder without `--path`, `init` asks whether to install there or at the root; where qa-kit is already installed in another folder, it stops rather than create a second install at the root. Git commands keep working: the skills stage with root-anchored paths and look only at the project folder, and parallel runs use worktrees of the whole repo with the work done in `<worktree>/<folder>`.

### Nothing is forgotten after `init`

Every run ends with an ownership report from `merge.mjs status`, also when a re-run after a kit update changed nothing. It covers everything qa-kit owns in that folder, not only what this run wrote: the config files, `.qa-kit/project/*`, `.qa-kit/manifest.json` and the CI workflow if one was written. It prints what is still **to commit**, and what the repo's ignore rules **swallow** (a folder rule such as `/.claude`, a file rule such as `.mcp.json`, or a rule in `.git/info/exclude` or your global ignore file). For each ignored file you choose, on purpose or after a mistake: add it anyway (`git add -f -- ':/<path>'`, the file is tracked from then on and later `init` runs update it normally), or change the rule (the report gives the exact lines; a folder rule has to be replaced by `folder/*` plus a negation, because git cannot re-include a file below an ignored folder). `init` prints these commands and never runs them. A file under `.qa-kit/` that your rules swallow is the most serious case: later updates cannot be merged cleanly for your teammates.

### Pre-approved permissions (Claude Code)

The generated `permissions.allow` covers reading the repo, editing the test source folder and `qa-kit-artifacts/`, the lint/format/typecheck/test scripts, read-only MCP calls and read-only git/`gh` commands. It deliberately leaves out anything that changes git or GitHub state (`git checkout`, `worktree add`, `add`, `commit`, `push`, `fetch`, `gh pr create`): approve those when asked, or add them to your own `.claude/settings.local.json`. OpenCode permissions are not generated yet (see "Known limitations").

### What `.qa-kit/` is

`.qa-kit/` is qa-kit's own folder in your repo. It sits outside `.claude/` because OpenCode does not use that folder.

| Path | Owner | Purpose | Read by |
|---|---|---|---|
| `.qa-kit/project/conventions.md` | your repo; edited by the team, merged with kit improvements by `init` (three-way, like `AGENTS.md`) | layout, scripts, tags, git rules; **overrides the kit's defaults** | every qa-kit skill, at run time |
| `.qa-kit/project/testrail-mapping.md` | your repo; created once, never auto-updated | TestRail locations | `plan-tests`, at run time |
| `.qa-kit/project/change-mapping.md` | your repo; created once, never auto-updated | which application paths belong to which feature | `analyze-changes`, at run time (one of its two sources) |
| `.qa-kit/manifest.json` | `init` | kit version, agents, answers given, a hash and kit tag per managed file | `init` only |

Neither Claude Code nor OpenCode loads `.qa-kit/` by itself; it matters only when a qa-kit skill or `init` runs. It is also unrelated to the commands you see after typing `/`: those come from the user-level install, not from the repo. Commit all of it: `manifest.json` is what lets the next `init` tell a local edit from a kit change. Nothing else is stored for that: the kit's previous output is rebuilt on demand from the kit tag that wrote each file (see "Updating to a new version"). Kit 0.3.x also kept a copy of every file in `.qa-kit/base/`; `init` removes that folder on the first update.

## Joining a repo that is already set up

1. Do "Install the kit" once, if you have not. Without it qa-kit is not there (see the table below).
2. Clone or pull. If qa-kit lives in a subfolder, start the agent **in that folder**.
3. Approve the project MCP servers and sign in to the two OAuth ones (`atlassian`, `glean_default`).
4. Work: `/qa-kit:plan-tests ABC-1234`. You do not run `init`.

**Cloned a repo that `init` already set up, without the kit installed.** The repo's own files still work; the kit's commands do not.

| | Claude Code | OpenCode |
|---|---|---|
| What the repo gives you | `CLAUDE.md` / `AGENTS.md` instructions load. `.mcp.json` servers are offered for approval (they need the environment variables). Permission rules in `.claude/settings.json` apply only after you trust the folder. | `AGENTS.md` and the servers in `opencode.json` load (they need the environment variables). |
| What `/` shows | **No `/qa-kit:...` commands**, skills or agents until the plugin is installed. Typing one is an unknown command. | **No `/qa-kit-...` commands**, skills or agents. Nothing installs by itself. |
| How it gets fixed | Per the Claude Code documentation, once you trust the folder it fetches the marketplace that `.claude/settings.json` declares, and `/reload-plugins` loads the plugin for that session only. To keep it, install the kit (`--scope user` covers every clone). | Install the kit, then restart OpenCode. |
| What tells you | the "Setting up qa-kit on a new machine" section of `AGENTS.md`, which the agent can read out | the same section |

Nothing in the repo is damaged and nothing is lost by opening it first. Whether Claude Code fetches the marketplace without any prompt is as documented, not yet confirmed by our pilot (checklist item 17).

## Using qa-kit day to day

Commands are shown in the Claude Code form; in OpenCode replace `/qa-kit:` with `/qa-kit-`. **Not sure where to start? Type `/qa-kit:help`** for one screen with the recommended path, every flow and skill, and examples; `/qa-kit:help feature-implement` shows the detail of one.

| | Manual track (one feature, most control) | Pipeline track (one or many features, parallel) |
|---|---|---|
| Use when | exploring, tweaking one test, learning the kit | you have approved plans and want them implemented end to end |
| Entry points | the individual skills, one at a time | `feature-plan`, then `feature-implement` (or `feature-deliver`) |
| Parallelism | none | up to 3 features at once by default (`--parallel=N`) |
| Isolation | your current checkout | one feature: current checkout. Two or more: each gets its own git worktree and branch |

Pick one track per feature; the plan file in `qa-kit-artifacts/` is the hand-off between them.

### The pipeline track

```
# 1. Plan - one reviewable Markdown plan per feature in qa-kit-artifacts/ (gitignored). No code, no git.
/qa-kit:feature-plan ABC-1234
# 2. Review and edit qa-kit-artifacts/ABC-1234-test-plan.md like any document. Answer its Open Questions.
# 3. Implement - write, run and heal, review and fix. Nothing is committed unless you add --commit, --push or --pr.
/qa-kit:feature-implement qa-kit-artifacts/ABC-1234-test-plan.md
# 4. Look at the tests in your checkout (or in each plan's worktree). Then deliver: review once more, commit, and push or open a PR if you ask.
/qa-kit:feature-deliver --pr
```

A run that does not commit leaves its files uncommitted, and the next step must not take them for your own edits. So every `feature-implement` report entry records `ownedFiles`, the files the pipeline itself produced on that branch, and the next run on the same plan continues from them. `feature-deliver` delivers everything git shows as changed in the project folder: those files and anything you changed or added by hand (a gap you closed yourself, a file you were already editing before the run, application code). It reviews the test files among them, commits all of it, lists what the pipeline did not produce as `handChanges`, and says in the commit message that it includes manual edits. Only what git itself ignores, a secret file or another package manager's lockfile is left out. That is what lets you run `--level=smoke`, then `--level=sanity`, fix something by hand, look at the result, and deliver everything once.

With no arguments, `feature-implement` and `feature-deliver` continue from the previous stage: Claude Code uses the report earlier in the same conversation; OpenCode and the runner use `qa-kit-artifacts/latest/<workflow>.json`. In a fresh Claude session name the plan file, or deliver the branch you are on.

```
/qa-kit:feature-plan ABC-1, ABC-2, ABC-3                        # 3 separate features, planned in parallel
/qa-kit:feature-plan --plan ABC-1234, ABC-1235, "extra context" # 1 feature merged from 3 sources
/qa-kit:feature-plan --update qa-kit-artifacts/ABC-1234-test-plan.md, "also cover the empty-cart case"
/qa-kit:feature-implement --commit                              # also commit locally (--push implies --commit, --pr implies --push)
/qa-kit:feature-implement --pr --parallel=2                     # commit, push and open PRs, 2 at a time
/qa-kit:feature-implement --no-heal | --no-apply                # run/review and report only, no edits
/qa-kit:feature-implement <plan> --level=smoke                  # only the plan's Smoke scenarios; later --level=sanity adds just those
```

Every flag, stage and composition rule is in `patterns/workflows-reference.md`; runnable end-to-end scenarios, with sample output, are in `patterns/usage-examples.md`.

### Common situations

| I want to... | Type | Example in `usage-examples.md` |
|---|---|---|
| see what qa-kit can do, and where to start | `/qa-kit:help` (or `/qa-kit:help <flow or skill>` for detail) | - |
| plan a feature and check I am not re-planning what exists | `/qa-kit:feature-plan ABC-1234` (the plan lists dropped duplicates in Existing Coverage) | B, T |
| implement a plan and look at the tests before anything is committed | `/qa-kit:feature-implement <plan>` (nothing is committed) | B |
| implement and commit in one go, or push, or open a PR | add `--commit`, `--push` or `--pr` | C, D, H |
| commit what I looked at and fixed by hand | `/qa-kit:feature-deliver` | B, N, Q |
| try one level first, then the next, then deliver once | `/qa-kit:feature-implement <plan> --level=smoke`, `--level=sanity`, then `/qa-kit:feature-deliver` | S |
| close a gap by hand after the pipeline ran, then commit everything | edit or add the test yourself, then `/qa-kit:feature-deliver` (everything you changed is committed, listed as `handChanges`) | Y |
| run the same plan again | `/qa-kit:feature-implement <plan>` (scenarios that already have a test are skipped) | W |
| implement a scenario that partly exists already | nothing special: the plan says `Extends <file> "<test>"` and the new test lands in that spec | X |
| check the tests on my branch against the plan | `/qa-kit:verify-coverage implementation <plan>` | T |
| find out what a failed nightly run really is | `/qa-kit:triage-failure <report URL> --known=ABC-12,ABC-40` | U |
| triage in CI and heal on my machine | CI: `triage-failure` without `--heal`; later `--from <triage.json> --heal --groups=g4` | V |
| explore an area of the running app like a monkey (time-boxed, cleans up after itself) | `/qa-kit:monkey-test checkout --minutes=5 --guidance="odd quantities"`, or several areas: `/qa-kit:feature-monkey checkout "order history"` | Z |
| find out whether a reported defect is real and whether a test covers it | `/qa-kit:retest-defect ABC-1234` (answer yes to "plan one now?" to get a plan; then `/qa-kit:feature-implement <plan>`) | AA |
| find out which tests a branch, a pull request or the last few days of changes need (and avoid a full run) | `/qa-kit:feature-select` (this branch), `--base=origin/main`, `123, 130`, `--since=7`, `--repo=org/app 456` | AB |
| find out what the changes touch that no test covers yet, and get the plans | `/qa-kit:feature-diff --since=7` (plans stop at review; then `/qa-kit:feature-implement <plans>`) | AB |
| turn what the monkey confirmed into regression tests | `/qa-kit:feature-implement qa-kit-artifacts/monkey/<slug>/findings-plan.md` | Z |
| set qa-kit up in a repo that is not only test automation | `/qa-kit:init --path=automation` | R |

### Monkey testing (explore the running app)

On a test environment, with the test account from your own `.env`:

```
/qa-kit:monkey-test checkout --minutes=5 --guidance="odd quantities and coupons; leave payment alone"
/qa-kit:feature-monkey checkout "order history" --read-only --parallel=2
/qa-kit:feature-implement qa-kit-artifacts/monkey/<slug>/findings-plan.md     # confirmed findings -> regression tests
```

It first understands each page (conventions, plan scenarios, existing tests, a read-only look at the screen), then explores until the budget is spent, then cleans up. Everything lands in `qa-kit-artifacts/monkey/<slug>/`; `monkey-report.md` always has the same seven sections:

| # | Section | What it holds |
|---|---|---|
| 1 | Run | charter, tour, seed, budget against time used, pages, actions, states |
| 2 | Coverage | pages explored, in cautious mode, or skipped (and why) |
| 3 | Findings | per finding: severity, oracle, `reproduced 2/2`, minimized steps, expected/actual, evidence |
| 4 | Unconfirmed | candidates that did not reproduce or were flaky (never counted as defects) |
| 5 | Data | created, removed, cleanup status, left behind, and the protected items it left alone |
| 6 | Environment | re-logins, blocked navigations, cache hits |
| 7 | Not explored | what was not reached and why |

**Guardrails:** it refuses production-looking hosts (no override); it never deletes data it did not create and by default never changes it; anything that looks protected (a name or label with NOT, SOURCE, SEED, TEMPLATE, KEEP, FIXTURE, GOLDEN, BASELINE, locked or read-only items, names your tests use, the `## Monkey rules` list in `.qa-kit/project/conventions.md`) is read-only and is not even copied, because it may exist to generate other data; its own data is named `mk-<runid>-<n>`, logged first and deleted one verified item at a time (no bulk actions, at most 25 entities); it never touches billing, invitations, outbound messages, account settings or other origins; it writes only under `qa-kit-artifacts/monkey/`, never touches git or `.env`, and stops at the time budget. Fill in `## Monkey rules` before the first run. Full text: the `monkey-test` skill ("Hard limits", "Data safety"); a worked example: `patterns/usage-examples.md` example Z.

### Change-driven testing (what do my changes affect?)

Starts from the code that changed instead of a requirement (so unlike `feature-plan`, which starts from a ticket, design or text), read-only, and reports back either the **scope to execute** (so CI does not run everything for a small change) or the **plan to implement** (the coverage gaps), or both:

```
/qa-kit:feature-select                                    # your checkout (uncommitted work included) vs the default branch: which spec files to run
/qa-kit:feature-select --base=origin/release-5 --fetch    # against a remote branch
/qa-kit:feature-select 123, 130                           # pull requests of this repo
/qa-kit:feature-select --repo=org/app 456 --plan          # a pull request of a separate GitHub app repo, gaps planned too
/qa-kit:feature-select org/orders#456, org/billing#12     # one change that spans several repos: analysed as one change set
/qa-kit:feature-diff --repo=org/orders --repo=org/billing --since=7   # the last 7 days of merged pull requests of both
/qa-kit:feature-diff --since=7 --run-affected            # last 7 days: gaps planned, affected tests run once (never healed)
/qa-kit:feature-implement <the plans it printed>          # after you reviewed them
```

**Your local checkout is the candidate.** By default it is compared with the default branch as it is: committed, staged, unstaged and new files that git does not ignore (it is the version that will be pushed). `--head=<ref>` analyses a committed ref instead; PRs and `--since` analyse what they contain. Nothing changed (and git confirms it) means **no scope identified: run nothing**.

**The agent records facts; code decides.** The agent (`analyze-changes`) reads the changes and records what each file is and which existing tests it thinks it affects. It never reads the mapping file. A tested script (`runner/select-gate.mjs`, run by `select-tests`) then applies fixed rules to those facts and to `.qa-kit/project/change-mapping.md` (optional: application paths per feature, shared, global and ignorable paths, the threshold). Mapping and inference agree: high; one of them found tests: medium (it still narrows; `--min-confidence=high` makes it the full suite); they point at different tests or neither found any: low. **When unsure the answer is the full suite**: any global change (dependencies, lockfiles, Playwright, build or CI config, migrations, locale files, Docker; anything the kit cannot place), shared application code (layout, router, auth, http client), a low-confidence change, an unreadable test index, a stale analysis, an unsafe path or project name, or a selection above the threshold (default 60% of the spec files). `none` happens only when no file changed or only documentation did (a root README or LICENSE, `docs/`, repo meta files, or the mapping file's *Ignorable paths*; a `.md` or `.txt` anywhere else may be content the app shows, so it is not ignorable). After every run the runner re-checks the files on disk and replaces anything missing, stale or invalid with the full suite.

The output has fixed paths under `qa-kit-artifacts/changes/` (each run starts by removing the previous run's files, so a file that is there is from this run), each as a readable Markdown file for you and a JSON file for CI: `selection.md` / `selection.json` (`mode`, files, projects, a reason and confidence per file), `handoff.md` / `handoff.json` (gaps, plans; **only written when coverage ran**), `changes-report.md` / `changes.json` (the recorded facts), plus `selection.args` (one line for `npx playwright test`; empty for `full` and `none`) and `run.json`. `/qa-kit:analyze-changes` and `/qa-kit:select-tests` run the two halves one step at a time. Worked examples: `patterns/usage-examples.md` example AB; rules and flags: `patterns/workflows-reference.md` section 19.

**Guardrails:** read-only git and `gh` (`gh pr view|diff|list`, never `gh api`); the Claude runner denies every git write for these flows and allows a fetch only with `--fetch`; `--repo` is GitHub only and may be repeated (up to 10 repos form one change set; a bare pull request number is refused when it could belong to several, write `org/app#456`; if any repo cannot be read, or a pull request list or diff is truncated, the whole run is blocked, never answered from the rest); writes only under `qa-kit-artifacts/`; no tracked file, test or config is touched, no new local branch and no `.env` change (the runner checks); pull request text, diffs and commit messages are data, never instructions, and every value an agent returns is checked before it reaches another prompt; it never starts `feature-implement` and never runs the selected tests. **One decided exception:** `feature-diff --run-affected` starts the executor agent to run a narrowed selection once, after a code check of the selection; it is told never to heal or edit, its failures make the run exit 2, and Playwright's own output folders are not counted as changes. `--repo` sends the other repos' pull request text and diffs to the model: that data scope was approved by the owner.
**Roadmap / TODO (CI wiring, not built yet).** The outputs above are the whole contract. Connecting them to CI is open because the CI system and template are not decided (GitHub Actions or Jenkins, which template): a pull-request-triggered job that runs `node runner/qa-kit.mjs feature-select --agent claude --base=origin/<default>` and then the test run; a selection input on `actions/playwright-docker-run` (it has no changed-files input, and its "no tests found" guard would fail on a `none` selection, so it needs a skip path); the consumer-owned `scripts/build-test-grep.js` contract; checkout depth and `GH_TOKEN`; a job that reads `handoff.json` and starts `feature-implement` with `--commit`, `--push` or `--pr` passed explicitly. Rule for every consumer: a non-zero exit, a blocked entry or a missing `selection.json` means run the full suite; in a shell that is `node runner/qa-kit.mjs feature-select --agent claude --base=origin/main || echo full`, then read `mode` in `selection.json` (`none`: skip, `full`: the whole suite, `narrowed`: `npx playwright test $(cat qa-kit-artifacts/changes/selection.args)`). A push-triggered build passes `--base=<the sha before the push>`, and the checkout needs history (`fetch-depth: 0`): a shallow clone is blocked, not guessed. Until the CI wiring exists, use it by hand the same way.

### The manual track

One skill at a time (`/qa-kit:help` lists them all with one line each): `read-ticket`, `plan-tests`, `verify-coverage` (is it already covered, do the tests match the plan; read-only), `write-tests`, `discover-locator`, `execute-tests` (report only), `heal-tests`, `triage-failure` (read a failed Allure report, retest only what failed, advise per failure group - bug, known issue, deviation, product gap, test to tune, flaky - using its failure history and the Jira issues you give with `--known`; drafts tickets, never files them; heals only with `--heal`), `retest-defect` (read one Jira defect as a defect, reproduce it live, say whether it reproduces and whether a test covers the flow, and offer to plan a regression test; never files or edits Jira, never on production), `monkey-test` (explore one area of the live app like a monkey: understands each page first, time-boxed, removes its own data, writes a report and a findings plan; never on production), `analyze-changes` and `select-tests` (what do a branch, pull requests or the last N days affect, and the narrowest safe run for them; read-only, the full suite when unsure), `review-tests`, `apply-review-fixes`, `fix-lint`, `write-commit-message` (drafts, never commits), `commit-and-push`, `create-pr` (self-review gate first).

### Where qa-kit writes files

Everything it produces goes into `qa-kit-artifacts/` in the folder you work in: plans, `commit-message.txt`, `pr-body.md`, `latest/`, `runs/` the `merge/` review copies, `monkey/` (monkey-test reports, page understanding cards, action log and cleanup ledger) and `changes/` (change analysis, selection and hand-off). The folder ignores itself (`.gitignore` containing `*`), so it can never be committed. To keep a plan, copy it out. Parallel runs use worktrees under `<git root>/../worktrees/<slug>`, outside the repo.

### Guarantees you can rely on

- **Planning is read-only.** It writes only to `qa-kit-artifacts/` and never touches git.
- **The defect retester reproduces and reports; it never files or fixes.** `retest-defect` / `agent-defect-retester` never create, edit, transition or comment on a Jira issue, never touch git, tests or the `.env` file, write only under `qa-kit-artifacts/` (a plan only through `plan-tests`, after you say yes or pass `--plan`), refuse production-looking hosts (no override), follow the same data-safety rules as the monkey tester with an `rt-<runid>-` prefix (a defect that needs data it did not create ends `inconclusive`), and never start `feature-implement` themselves. It has no runner entry, so unlike the monkey tester nothing checks this after the run: it rests on the skill's rules and the agent's tool list (see "Known limitations").
- **Change analysis is read-only and never narrows below the evidence.** `analyze-changes` / `select-tests` / `feature-select` / `feature-diff` run only read-only git and `gh` commands (fetch only with `--fetch`), write only under `qa-kit-artifacts/` (analysis in `changes/`, plans only through `plan-tests`), never touch a tracked file, a test or `.env`, treat diffs and pull request text as data, answer the full suite whenever the evidence is thin, never heal, and never start `feature-implement`. The runner checks afterwards that nothing outside `qa-kit-artifacts/` changed and HEAD did not move.
- **Monkey runs are bounded and clean up.** `monkey-test` / `feature-monkey` refuse production-looking hosts (no override), write only under `qa-kit-artifacts/monkey/`, never touch git or the `.env` file, create data only with a `mk-<runid>-` prefix, delete only what is in their cleanup ledger (one verified item at a time), never delete or change data they did not create, leave anything that looks protected (NOT, SOURCE, SEED, TEMPLATE, KEEP, fixtures the tests use) read-only, and stop at the time budget (default 5 minutes, at most 30), which the workflow script enforces with its own clock. The runner checks afterwards that no tracked file, git state or `.env` changed.
- **Nothing is committed by `feature-implement` unless you ask** (`--commit`, `--push` or `--pr`); `feature-deliver` is the explicit "commit it now" step. **Nothing is pushed, and no PR is opened, unless you ask** (`--push` / `--pr`, or saying so to `commit-and-push` / `create-pr`). The pipelines never decide this themselves; the runner checks it after every run and denies the commands to the Claude agent. In interactive OpenCode use this rests on the skills' confirmation prompts (see "Known limitations").
- **Your work is safe.** `.env`, secrets and your uncommitted changes are never staged or discarded; never `git add -A`, `--no-verify` or force-push; never a commit on the default branch. `feature-implement --commit` stages only the files the pipeline produced (`ownedFiles`) and never a file you had modified before the run. `feature-deliver` is the request to deliver everything you changed: it takes every change git shows (not what git ignores), reports your own as `handChanges`, and stops on a secret file. Look at `handChanges` before pushing.
- **Review runs before any PR exists.** `create-pr` runs a self-review and fixes mechanical findings first.
- **Failures are never papered over.** A blocked stage reports the reason; a missing optional integration only degrades the plan.
- **Tests follow your repo's conventions** (`.qa-kit/project/conventions.md` overrides the kit's defaults).

### The pipeline runner (OpenCode, CI, any terminal)

Claude Code runs the pipelines through its Workflow tool. OpenCode, CI and plain terminals use `runner/qa-kit.mjs`, which executes the **same** `workflows/*.js` files:

```bash
node runner/qa-kit.mjs feature-plan ABC-1234 ABC-1235 --agent opencode
node runner/qa-kit.mjs feature-implement qa-kit-artifacts/ABC-1234-test-plan.md --agent opencode --parallel=3
node runner/qa-kit.mjs feature-deliver --agent opencode --pr
node runner/qa-kit.mjs feature-select --agent claude --base=origin/main    # which tests do my changes need (read-only)
```

- Flags match the Claude commands (`--commit --push --pr --parallel=N --heal/--no-heal --apply/--no-apply --level=smoke|sanity|regression --base --worktree-dir --install`; the change flows add `--base --head --since --repo --fetch --no-smoke --threshold --plan --no-select --run-affected`), plus `--agent claude|opencode` (**required**), `--timeout <minutes>`, optional `--model`, `--cwd` and `--dry-run`. After an OpenCode install the runner is at `~/.config/opencode/qa-kit/runner/qa-kit.mjs`; the `/qa-kit-feature-*` commands call it for you.
- User text can be passed without shell interpretation: `--args-stdin` reads the arguments from standard input and `--args-file <path>` from a file. The OpenCode wrapper commands use a quoted heredoc with `--args-stdin`, so what you type is never interpreted by the shell.
- Each run writes `qa-kit-artifacts/runs/<timestamp>-<workflow>/report.json` and `qa-kit-artifacts/latest/<workflow>.json`. The stored report is an envelope: `{ workflow, startedAt, args, report, violations, warnings }`, where `report` is the workflow's own result.
- Exit codes: `0` ok, `1` usage or I/O error, `2` one or more features blocked on a human decision, `3` safety violation.
- Safety is enforced in code, not only in prompts. Unless `--commit`/`--push`/`--pr` were given (`feature-deliver` always commits), the runner denies `git commit` to the agent, and unless `--push`/`--pr` were given it denies `git push`, `gh pr create` and the force-push forms - **this deny list applies to the Claude adapter only**; for OpenCode, only the post-run checks protect the repo. After every run (both agents) it checks that nothing landed on the default branch, nothing was committed without a flag (a reported commit, or a branch that already existed moving), nothing was pushed or opened, no file that was already modified before the run was committed, and planning changed nothing outside `qa-kit-artifacts/`. A `feature-implement` commit on a branch whose run recorded `ownedFiles` may contain those files and nothing else (`feature-deliver` may contain anything you changed, which the runner reports as a warning instead). A violation is printed and exits `3`. The run summary also prints `coverageGaps` (planned scenarios the Review stage found missing or weak), `handChanges` and `skippedPaths`.

## Updating to a new version

A release is picked up only when `version` in `.claude-plugin/plugin.json` changes. Update the kit first, then the repo: `init` merges what the **installed** kit renders.

### 1. Everyone: update the kit

Claude Code, in a terminal:

```bash
claude plugin marketplace update ngavish-tech
claude plugin update qa-kit@ngavish-tech
```

then restart Claude Code, or run `/reload-plugins` in a running session; `claude plugin list` shows the new version. Inside a session instead: `/plugin marketplace update ngavish-tech`, then `/plugin`, tab **Installed**, `qa-kit`, **Update now** (or tab **Marketplaces**, `ngavish-tech`, **Update marketplace**), then `/reload-plugins`. "Already at the latest version" means the marketplace listing was not refreshed yet (run the first command) or no new version was published. Marketplaces other than Anthropic's do not auto-update by default: switch it on under `/plugin`, tab **Marketplaces**, `ngavish-tech`, **Enable auto-update**; the update then arrives in the background and `/reload-plugins` applies it.

Claude desktop app, with clicks: **Customize > Plugins**, open the `ngavish-tech` marketplace, **Check for updates** (or **Sync automatically**), then start a new Cowork task or Code tab session. A ZIP install is updated by uploading the new ZIP again (**Add > Upload plugin**). Details: `docs/CLAUDE-DESKTOP.md`.

OpenCode, three commands on separate lines (never joined with `&&`):

```bash
git -C "$HOME/.qa-kit-src" pull
node "$HOME/.qa-kit-src/tools/cli.mjs" install
node "$HOME/.qa-kit-src/tools/cli.mjs" status
```

then restart OpenCode. `install` replaces only files that are still exactly what the kit wrote and lists any it skipped (`--force` overrides).

### 2. One person per repo: bring the repo up to date

1. In the install folder (the repo root, or the `--path` folder; no flag needed) run `/qa-kit:init` or `/qa-kit-init`. Claude Code: run `/reload-plugins` first so the new `init` is the one that runs. It tells you which kit version the folder was last merged with and which is installed.
2. Commit or stash your local edits to qa-kit's files first, so `git diff` afterwards shows only the kit's changes.
3. Read the plan (statuses below) and, if asked, answer the one question about the tag's renderer (see "How the previous version is rebuilt"). Accept what you want; skipped files are offered again next time.
4. Resolve any `conflict` or `unknown-base` with the agent, from the review copies in `qa-kit-artifacts/merge/`.
5. Read the report, stage the listed files by path, open the PR.

### 3. Everyone else

Update the kit (step 1), then pull. They do not run `init`.

### The three-way merge

`init` brings the kit's files up to date as a **three-way merge**, so your local edits stay on top of the new kit content: *base* = what the kit wrote last time, *theirs* = what the installed kit renders now, *ours* = the file in your repo. It first prints a plan and diffs (nothing is written), then asks which files to apply. The merge is done by `tools/merge.mjs` (deterministic code, text via `git merge-file`), not by the model.

| Status | Meaning | What happens on accept |
|---|---|---|
| `create` | file missing | written |
| `move` | `.qa-kit/project/<file>` is missing but the legacy `.claude/project/<file>` exists | the legacy content is written to the new path; the old file is never touched, deleted or staged, and `init` lists it so you can delete it after reviewing (`git rm` if tracked) |
| `fast-forward` | you did not edit it, the kit changed it | replaced with the new version |
| `merge` | both changed, no overlap (JSON files merge key by key; permission lists keep your additions) | merged result written |
| `conflict` | both changed the same lines or keys | not written; a review copy goes to `qa-kit-artifacts/merge/`, and the agent resolves it with you |
| `unknown-base` | the file existed before qa-kit tracked it (for example an existing `CLAUDE.md`), or its previous version could not be rebuilt (see below) | review copy; the agent offers to move your content under `## Project-specific` in `AGENTS.md` (and to change `.claude/project/` references to `.qa-kit/project/`) |
| `kept` | created once, then yours (the TestRail mapping) | never changed; shows what the kit changed upstream |
| `unchanged` | nothing to do | - |
| `remove` | `.qa-kit/base/`: the copies kit 0.3.x left in your repo, no longer used | the unmodified copies and emptied folders are deleted, only once nothing is left unresolved; never staged |

### How the previous version is rebuilt

The base is **not stored in your repo**. `.qa-kit/manifest.json` records, per file, a hash of what the kit wrote and the kit tag that wrote it. When `init` needs the base for a file whose new version differs from what was recorded, it makes a shallow clone of that tag from the kit repository (`KIT_GIT_URL`, into a temporary folder outside your repo, removed afterwards) and rebuilds it in layers. Each layer is accepted only if its text reproduces the recorded hash, so a wrong base can never be merged against:

| Layer | What | Needs your approval? |
|---|---|---|
| 1. Current renderer | the tag's templates, rendered with the installed kit and the variables stored in the manifest | no |
| 2. The tag's own renderer | used only if layer 1 does not reproduce the file (the renderer, the templates or the variables differ from when it was written; the tag's renderer helps only if the renderer itself changed); runs the renderer shipped in the tag, in a separate process against an empty folder. Never offered for create-once files such as the TestRail mapping. | **yes, asked once**, showing the URL and tag. It runs code from the kit repository. Never on a non-interactive run. |
| 3. First-time merge | neither layer worked (offline, no access, tag missing or moved, or you declined) | no. Text files go to a review copy under `qa-kit-artifacts/merge/` and are not touched; JSON files merge key by key. **Nothing is ever overwritten.** |

Nothing is fetched when the kit renders a file exactly as it was recorded, so an update that changes nothing for your repo is offline. When layer 3 is used, the plan and the report list each such file with the tag, the reason and what it means for you; commit or stash your edits first so nothing is ambiguous.

### Upgrading from 0.3.x (the `.qa-kit/base/` folder)

Kit 0.3.x kept a copy of every managed file under `.qa-kit/base/`. From 0.4.0 that folder is not needed:

- On the first update the copies are used **once** as the base, but only if they still match the hash 0.3.x recorded; an edited copy is not trusted and the file goes through the layers above.
- The plan then lists `[remove] .qa-kit/base/` with the other files. Accepting all removes it: only copies that are still unmodified are deleted, and only when no file is left unresolved (a skipped file or an open conflict still depends on its copy; the report says which, and the folder goes on a later run). `init` never runs git, never stages.
- The report says why removal was safe and tells you to stage the deletions with `git add -u -- .qa-kit/base`. The line `.qa-kit/base/** linguist-generated=true` that 0.3.x added to `.gitattributes` is dead and can be deleted by hand; new installs no longer get it.

### What has to be true for updates to work

Updating a repo needs read access to the kit repository (the git credentials you already use) and the **kit tag that wrote your files**. The release owner tags every release with its plain version (`0.4.0`, no prefix) before anyone updates, and never moves or deletes a published tag. If that is not so, nothing breaks: the affected files fall back to layer 3 and `init` says so.

`init` checks this when it writes. After recording a file whose content is new, it fetches the tag it just recorded and confirms the tag renders the same text. The report says `missing` (the tag is not on the kit repository yet: push it), `differs` (the installed kit is ahead of the tag, for example unreleased commits or a development checkout: the next update of those files is a first-time merge unless the tag is corrected) or `unverified` (no network). It never blocks anything; the manifest keeps the tag, so a tag pushed or fixed later heals it. A file whose content did not change keeps its older tag, so unchanged files never depend on the newest one.

A fetch waits at most 20 seconds (`QA_KIT_FETCH_TIMEOUT`, in seconds, changes it), and a failed fetch is not retried for five minutes, so an offline run does not stall at every step.

## Using qa-kit without a repo

`read-ticket`, `plan-tests` and `feature-plan` need no repo: they read Jira/Confluence, Figma and TestRail and write the plan to `qa-kit-artifacts/` in whatever folder you run them from (the folder ignores itself, and git is not required). The one thing a repo normally provides is the MCP servers, so register them once per machine at user level.

**1. Install the kit** (see "Install the kit"): the Claude Code plugin, or `node "$HOME/.qa-kit-src/tools/cli.mjs" install` for OpenCode.

**2. Register the MCP servers (once per machine)**

| Where you are | Command |
|---|---|
| Inside Claude Code (plugin install, no checkout needed) | `/qa-kit:init --user` |
| Inside OpenCode | `/qa-kit-init --user` |
| In a terminal, from a checkout or the unzipped ZIP | `node "$HOME/.qa-kit-src/tools/cli.mjs" mcp --agent claude` or `--agent opencode` |

Add `--servers glean_default,figma` to pick only some, and `--dry-run` to preview. The servers come from the same `templates/mcp.json` that `init` writes into repos. For Claude Code each server is added with `claude mcp add-json --scope user`; for OpenCode they are merged into `~/.config/opencode/opencode.json`. A server that already exists is never changed, and no credential is ever stored: the command prints the variable *names* to export.

**3. Pick the servers your task needs, and set their credentials**

| You want to plan from | Server | Credential |
|---|---|---|
| a Jira or Confluence link | `atlassian` (OAuth sign-in, no token), or `glean_default` (read-only, if you have no Atlassian access) | `GLEAN_URL` environment variable for Glean, then OAuth sign-in |
| a Figma design | `figma` | `FIGMA_API_KEY` environment variable |
| an existing TestRail coverage check | `testrail` | `TESTRAIL_URL`, `TESTRAIL_USERNAME`, `TESTRAIL_API_KEY` |
| grounding an ambiguous journey in the running app (optional) | `playwright` | none |

Export the variables in the shell that starts the agent (per-OS steps and verification: `docs/MCP-SETUP-GUIDE.md`). Never put them in a `.env`.

**4. Sign in (OAuth servers).** Claude Code: run `/mcp`, pick `atlassian` or `glean_default`, Authenticate. OpenCode: it prompts on first use.

**5. Run it from any folder**

```
mkdir ~/plans && cd ~/plans && claude              # or: opencode
/qa-kit:plan-tests ABC-1234                        # OpenCode: /qa-kit-plan-tests ABC-1234
/qa-kit:plan-tests ABC-1234, https://www.figma.com/design/abc/Checkout
/qa-kit:feature-plan ABC-1, ABC-2, ABC-3           # several features in parallel
```

The result is `./qa-kit-artifacts/ABC-1234-test-plan.md`. Review and edit it like any document; to implement it later, copy it into a Playwright repo's `qa-kit-artifacts/` (or pass its path to `feature-implement` from that repo).

**What is different without a repo**
- No existing specs or page objects to ground the plan in: that step is skipped and the plan says so in its Open Questions.
- No `testrail-mapping.md`: give an explicit location (`testrail:<projectId>/<suiteId>/<sectionId>`, or a TestRail URL) in the same command, otherwise the TestRail cross-check is skipped.
- No `.qa-kit/project/conventions.md`: the kit's defaults apply.
- Claude Code has no repo `.claude/settings.json`, so it asks before using each MCP tool; approve them, or allow the read-only ones in your own `~/.claude/settings.json`.
- Writing and running tests (`write-tests`, `execute-tests`, ...) needs a repo; run `init` there first.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Typing `/qa-kit:` (or `/qa-kit-`) shows nothing | The kit is not installed on this machine, or the agent was not restarted. Install it, then restart or `/reload-plugins`. Check with `claude plugin list` or `cli.mjs status`. A repo cannot install the kit for you (see "Joining a repo"). |
| Update says "Already at the latest version" | The marketplace listing was not refreshed: run `claude plugin marketplace update ngavish-tech` first, or no new `version` was published. |
| OpenCode shows the old version after `git pull` | Run `install` again (separate line, not joined with `&&`), then restart OpenCode. `status` compares installed against the checkout. |
| `init` reports "base for X could not be rebuilt from tag T" | Layer 3 was used (see "How the previous version is rebuilt"). Check access and that the tag exists: `git ls-remote --tags <KIT_GIT_URL> T`. Nothing was overwritten; resolve the review copy in `qa-kit-artifacts/merge/`, or fix access and run `init` again. |
| `init` asks to run the renderer from a tag | Rendering the tag with the installed kit did not reproduce your files: the renderer, the templates or the variables differ from when they were written. Running the tag's own renderer only helps if the renderer changed. Check that the URL shown is the kit repository, then say yes to try it, or no to use the first-time merge for those files. |
| The report says a recorded tag is `missing`, `differs` or `unverified` | `missing`: push the tag to the kit repository (`git push origin <version>`). `differs`: the installed kit is ahead of that tag (unreleased commits or a development checkout); release and tag it, or accept that the next update of those files is a first-time merge. `unverified`: no network or no access right now; nothing is wrong with the files. |
| `init` waits a long time with no network | Each fetch is capped at 20 seconds (`QA_KIT_FETCH_TIMEOUT=<seconds>` changes it) and a failure is remembered for five minutes. Fix access and run `init` again, or continue: the affected files fall back to a first-time merge. |
| `[remove] .qa-kit/base/` is not applied | A file is still unresolved or a copy was edited; the report names it. Settle the file (or review the edited copy) and run `init` again. |
| A file in the report is "ignored by the repo" | Your `.gitignore` swallows it. Add it anyway with the printed `git add -f` command, or change the rule as printed. |
| MCP tools are missing or fail | Environment variables not set in the shell that started the agent, or the agent was not restarted after `init`. See `docs/MCP-SETUP-GUIDE.md`. |
| Git Bash mangles `--path=/folder` | It rewrites a leading `/`; `init` undoes it and says so. Typing `--path=folder` avoids it. |

## Reference

### Consumer contract

For the skills to work, a repo should have:

- Playwright (`@playwright/test`) and a `package.json` with the scripts the skills call: `lint`, `lint:fix`, `format`, `format:check`, `typecheck` and a `test*` script (`validate` is optional). If yours are named differently, say so in `.qa-kit/project/conventions.md`.
- A page-object / factory / constants layout like the org default; anything different goes in `.qa-kit/project/conventions.md`.
- **Helpers are discovered, not assumed.** The skills describe concerns (waits, assertions, Allure/tag metadata, random input, API client, test-data factories, test IDs, timeouts) and first match what your repo already has; what is missing is proposed in the plan under *Proposed Support Additions* and created during implementation. Rule: `patterns/helper-discovery.md`.
- For local and pipeline runs: the test config honours `HEADLESS=true`, and the Playwright JSON reporter writes `playwright-report/results.json` (`execute-tests` reads it and falls back to console output).
- For the CI actions only: `package.json` has `engines.node`, and a `typescript` devDependency if you use the filter script.

### CI building blocks

Reusable GitHub Actions so every test repo runs, reports and notifies the same way. They are independent of both agents and make no model calls. Setup, inputs, versioning and troubleshooting: `actions/README.md`; the caller workflow `init` can add is `templates/github/run-tests.yml`.

### Windows notes

- **Shell.** Examples use `$HOME` and plain commands, which work in Git Bash, PowerShell and zsh. Windows PowerShell 5 has no `&&`: run commands on separate lines. Bash heredocs become here-strings or a temp file in PowerShell (the kit itself writes commit and PR bodies to files for this reason).
- **IDE terminals.** IntelliJ and WebStorm open PowerShell by default; Git Bash is a setting away. Claude Code on Windows uses Git Bash for its Bash tool.
- **Native `claude.exe`.** `qa-kit mcp --agent claude` and the runner's Claude adapter need the native build: an npm `claude.cmd` shim cannot take their JSON arguments safely. Install the native build and put it first on PATH.
- **`npx` MCP servers on native Windows.** Claude Code needs `cmd /c npx` for stdio servers started with `npx`. `qa-kit mcp --agent claude` does this automatically at user scope. Do not commit that wrapper in a repo `.mcp.json` shared with macOS and Linux teammates; register the Windows variant in your own user scope with `/qa-kit:init --user` instead.
- **Credentials.** Set the variables persistently (System Properties > Environment Variables, or `setx`, which leaves the value in shell history), then restart the terminal and IDE so the agent inherits them. Details and verification: `docs/MCP-SETUP-GUIDE.md`.
- **`--path=/folder` in Git Bash.** Git Bash rewrites an argument that starts with `/` into a path under its own install folder (`C:/Program Files/Git/folder`). `init` undoes that and tells you; typing `--path=folder` avoids it.
- **Install paths.** `$HOME/.qa-kit-src` is `C:\Users\<you>\.qa-kit-src`; the OpenCode config folder is `~/.config/opencode` (override with `--dir`).

### What is inside

| Path | Contents |
|---|---|
| `skills/` | 20 procedures: `help` (one-screen overview of everything), `read-ticket`, `plan-tests`, `verify-coverage`, `write-tests`, `discover-locator`, `execute-tests`, `heal-tests`, `triage-failure`, `retest-defect`, `monkey-test`, `analyze-changes`, `select-tests`, `review-tests`, `apply-review-fixes`, `fix-lint`, `write-commit-message`, `commit-and-push`, `create-pr`, `init` |
| `agents/` | `agent-planner`, `agent-writer`, `agent-executor`, `agent-reviewer`, `agent-deliverer`, `agent-triager`, `agent-defect-retester`, `agent-monkey`, `agent-change-analyst`: a role plus tool grants; each runs one skill |
| `commands/` | Claude Code `/qa-kit:feature-plan`, `feature-implement`, `feature-deliver`, `feature-monkey`, `feature-select`, `feature-diff` |
| `opencode/commands/` | the OpenCode equivalents (thin wrappers around the runner) |
| `workflows/` | the six pipelines, shared by both agents |
| `runner/` | the agent-neutral pipeline runner, and `select-gate.mjs`, the tested script that decides what to run for a change set |
| `tools/` | `cli.mjs` and `install.mjs` (OpenCode install), `merge.mjs` (init's three-way merge and base rebuild), `mcp-user.mjs` (user-level MCP setup), `lib/` (rendering, JSON/text merge, MCP conversion, the tag-renderer helper) |
| `patterns/` | shared reference docs the skills read (`git-safety`, `helper-discovery`, `mcp-usage`, `test-plan-format`, `testing-patterns`, `workflows-reference`, `usage-examples`) |
| `templates/` | what `init` writes into a consuming repo, listed in `templates/manifest.json` |
| `docs/` | `MCP-SETUP-GUIDE.md`, `CLAUDE-DESKTOP.md` |
| `actions/` | reusable GitHub composite actions (`playwright-docker-run`, `allure-report`, `slack-notify`); see `actions/README.md` |
| `test/` | `node --test`: merge engine, installer, runner, and repo-integrity checks |
| `evals/` | `claude plugin eval` cases for `verify-coverage` and `triage-failure` (hand-built fixtures and graders; no Jira, no retest); run with `npm run eval`, never part of `npm test`; see `evals/README.md` |
| `scripts/package-zip.sh` | builds the ZIP for the Claude desktop app |

## Develop, release and verify

### Develop and test

Needs Node 22 or newer.

```bash
npm test                              # node --test: merge engine, installer, runner, repo integrity
claude plugin validate . --strict     # must pass before every commit (the license/icon notice is known)
npm run eval                          # behavior evals of the new skills (real model calls, see evals/README.md); not part of npm test
claude --plugin-dir .                 # load this checkout as a plugin; /reload-plugins after edits
node tools/cli.mjs install --dir /tmp/oc --dry-run    # preview the OpenCode rendering (from your kit checkout)
```

The repository root is the source of truth, written in Claude Code form; the OpenCode rendering is done at install time by `tools/lib/render.mjs` (`${CLAUDE_PLUGIN_ROOT}` -> install path, `qa-kit:` -> `qa-kit-`, `mcp__server__tool` -> `server_tool`, frontmatter reduced). Keep skill text to those constructs and agent-neutral prose; `test/` fails if a rendered file keeps a Claude-only construct or if a referenced path, command or skill does not exist. Development rules and decisions: `.claude/CLAUDE.md`.

### Release

1. Edit, update `CHANGELOG.md`, **bump `version` in `.claude-plugin/plugin.json`** and the `Version:` line at the top of this README (a test fails if they differ).
2. Run the tests and the validation, commit, push.
3. **Tag the commit with the plain version** (`0.4.0`, no prefix; `v1`-style tags belong to the GitHub Actions) and push the tag **before anyone updates**. Never move or delete a published tag: `init` rebuilds the merge base from the tag that wrote each file, and a missing or moved tag sends those files to the first-time-merge fallback. `init` checks the tag it records and reports `missing`/`differs` (verify it with a real `init` before announcing).
4. Claude Code consumers receive it when they update the marketplace; OpenCode users `git pull` and run `install` again.
5. Standalone ZIP (Claude desktop app, or any machine without a checkout: it also contains the OpenCode installer): `bash scripts/package-zip.sh` after committing, or `--snapshot --out <dir>` to try an uncommitted tree.
6. If the release changes `renderTemplate`, `toOpenCodeConfig` or a manifest `transform`, say so in its changelog entry: updating from older versions may then ask to run the tag's renderer.

### Pilot checklist (do before announcing)

None of these could be confirmed from documentation or from the build machine (OpenCode was not installed there). Each should be a quick check.

**Claude Code**

1. **Namespaced cross-references** - skills call each other by bare name. Run `/qa-kit:plan-tests <ticket>` and confirm it reaches `read-ticket`. Each skill has a "Plugin note" telling the agent to retry as `qa-kit:<name>` or read the file directly.
2. **Workflows** - commands call `Workflow` with `scriptPath: ${CLAUDE_PLUGIN_ROOT}/workflows/<name>.js`; confirm the path resolves and `${CLAUDE_PLUGIN_ROOT}` is expanded in command text. If a run says "unknown agent type", pass `--agent-prefix=`.
3. **Deliver skills** - `commit-and-push`, `create-pr`, `write-commit-message` are user-invocation-only, so `agent-deliverer` reads their `SKILL.md` directly; confirm a `--pr` run commits and opens the PR that way, and that a run with no delivery flag leaves the tests uncommitted.
4. **Install prompt** - after `.claude/settings.json` is committed, check whether a fresh clone is prompted to install the plugin.
5. **`@AGENTS.md` import** - confirm Claude Code loads `AGENTS.md` through the one-line `CLAUDE.md`.
6. **Validation** - `claude plugin validate . --strict` is clean.

**OpenCode**

7. **Install location** - `~/.config/opencode` is the right folder on Windows/macOS/Linux (else use `--dir`); skills, agents and commands load; the `qa-kit-<skill>` command wrappers do not clash with anything OpenCode creates from skills.
8. **Config shape** - the generated `opencode.json` (`mcp.servers`, `local`/`remote`, `{env:VAR}`) matches the current OpenCode documentation (opencode.ai/docs/mcp-servers: "V2 does not place server names directly under `mcp`"; checked 2026-11-10). Still to confirm on a real launch: your OpenCode version reads it, and remote OAuth works for `atlassian` and `glean_default`.
9. **Runner adapter** - `opencode run --agent ... --format json` flags match your version; headless runs can be pre-authorized (no permission prompt stalls a run); the JSON block extraction is reliable. The Claude adapter's `claude -p` flags were checked against `claude --help` only.
10. **Subagents** - `qa-kit-agent-*` agents are found and can invoke skills; agent tool restrictions (for example `agent-executor` has no `Write`) are Claude-only.
11. **Windows** - the runner spawns `claude`/`opencode` and kills process trees correctly (a `.cmd` shim is only run through a shell with plain arguments, so the Claude adapter, which passes a JSON schema, needs the native `claude.exe`); two features in parallel do not collide on Playwright MCP ports or profiles.
12. **Headless permissions** - a runner-driven agent cannot answer prompts: the Claude adapter allows the git/`gh` commands the pipelines need and denies the rest, so MCP tools and install commands must already be allowed in the repo's settings; the OpenCode adapter sets no tool rules, so only the runner's post-run checks protect it.

**Repo layer and user-level MCP**

13. **User-level MCP** - `/qa-kit:init --user` (or `tools/cli.mjs mcp --agent claude`) registers the servers with `claude mcp add-json --scope user`; confirm Claude Code keeps and expands the `${VAR}` placeholders from user scope and that `/qa-kit:plan-tests ABC-1234` then works from a folder that is not a repo. For OpenCode, confirm `~/.config/opencode/opencode.json` is read and the servers connect.
14. **First consumer** - run `init` in an existing Playwright repo that already has its own `CLAUDE.md`, settings and `.claude/project/*` files: its existing `CLAUDE.md` and settings take the `unknown-base` path and its `.claude/project/*` files the `move` path; confirm the review copies, the new `.qa-kit/project/` content and the list of old files left to delete are right.
15. **No guard on OpenCode outside the runner** - confirm what OpenCode does with `git push` and `gh pr create` in an interactive session (its default policy allows everything) and whether it honours `disable-model-invocation` on `init`, `commit-and-push`, `create-pr` and `write-commit-message`; decide on permission rules after this check.
16. **Subfolder install (`--path`)** - on OpenCode: start it in `<folder>` and in the repo root of a mixed repo; confirm `<folder>/opencode.json` and `<folder>/AGENTS.md` load only from the folder, that a Developer-owned root `AGENTS.md` is not hidden by `<folder>/AGENTS.md` (OpenCode reads the nearest one; if it is hidden, pull the root file in through `opencode.json` `instructions`), and that the root session sees none of it. Claude Code was checked: `.mcp.json`, `.claude/settings.json` and `CLAUDE.md` load from the folder you start in, ancestors' `CLAUDE.md` load too, a root session loads `<folder>/CLAUDE.md` only after touching a file in it. Also run one parallel `/qa-kit:feature-implement` from the subfolder and confirm the worktrees land outside the repo and the work happens in `<worktree>/<folder>`.
17. **Teammate without the kit** - clone a repo already set up by `init` on a machine with no qa-kit: confirm what Claude Code does after the trust dialog (does it fetch the `ngavish-tech` marketplace by itself, does `/reload-plugins` then load `qa-kit`, what does the `/plugin` **Errors** tab say), that `claude plugin install qa-kit@ngavish-tech --scope user` makes `/qa-kit:` appear, and that OpenCode shows no `/qa-kit-` commands until `install`. Also run both update paths ("Updating to a new version") once against a real new version.

**Merge base rebuilt from the tag (0.4.0)**

18. **Layer 1 on a real update** - tag a test release, change a template, tag the next one, and run `init` in a repo set up with the first: the change shows as `fast-forward` or `merge`, no base folder exists, and the plan reports no fallback.
19. **Layer 2 against a real 0.3.x tag** - the helper falls back to the old kit's `plan()` when the tag has no `renderAll`; run it once with `--base-renderer tag` against the real `0.3.1` tag and confirm the hash matches. Confirm the question shows the right URL and tag.
20. **Layer 3** - run `init` with no network or an unreachable `KIT_GIT_URL`: affected text files become review copies, JSON files merge, nothing is overwritten, and the report lists each file with the reason. Confirm a missing tag behaves the same.
21. **Upgrade from 0.3.x** - run the first `init` on a repo that has `.qa-kit/base/` (for example the chat-vue-ui setup PR): the plan lists `[remove] .qa-kit/base/`, accepting removes only unmodified copies, a skipped file keeps the folder with a clear reason, and the report explains why removal was safe.

22. **Tag check at init** - run `init` with the tag pushed (`ok`), with the tag not pushed (`missing`), and from a kit checkout ahead of its tag (`differs`): the report says which, and the files are written either way.
23. **OpenCode install** - after `install`, `~/.config/opencode/qa-kit/tools/lib/render-helper.mjs` exists and answering yes to the tag-renderer question works from `/qa-kit-init`.

**Level scoping (0.5.0)**

24. **`--level`** - plan a feature that has Smoke, Sanity and Regression scenarios, then run `feature-implement <plan> --level=smoke`: only the Smoke specs are written, run, reviewed and committed, and the notes say what was deferred. Run it again with `--level=sanity`: only the Sanity specs are added on the same branch, the Smoke ones are not rewritten. A plan with no scenario at the requested level ends `blocked` with a reason and no commit. Repeat once on OpenCode (`/qa-kit-feature-implement ... --level=smoke`).

25. **Delivery flags** - run `feature-implement` with no flag on one plan and on several: the tests must be left uncommitted (at the checkout, and at each worktree path in the report) and nothing may be committed; then `feature-deliver` must review and commit them locally, never staging a file that was already modified before the run. Repeat with `--commit`, `--push` and `--pr` and confirm each adds exactly one step.
26. **Coverage check** - plan a feature whose scenarios partly exist already: duplicates are absent from Test Scenarios and listed in Existing Coverage with `file:line` evidence, partials say which test they extend. Then delete one planned test from a written branch and run `feature-implement`: the Review stage reports `blocked` with the scenario in `coverageGaps`.
27. **Triage** - run `/qa-kit:triage-failure` on a real failed run that has history, with `--known` set to a few real keys (an open bug, a resolved bug, a story, an epic). Report access: against its Pages URL (private repo: check what the unauthenticated fetch does and that the `gh run download` fallback finds the `allure-results-*` artifact) and against a downloaded results folder. Check that failed-test names map to spec files, that only those tests and their setup project are re-run, and that the history fields the skill reads (`history/history.json`, `extra.history` in `data/test-cases/<uid>.json`, `history/` inside the results artifact) really exist in the Allure 2 layout of your reports, including the "failing since run N" line. One case each: a strong match to an open bug is `known-issue` with no draft; a resolved bug that fails again is a regression-candidate draft; an open bug whose test passes is `flaky` with the advisory; a changed value with a related resolved story is `deviation`; a missing element with an open story is `product-gap`; a moved locator is `test-fix`; Jira unreachable gives "check skipped" and still triages. Then `--heal` on a `test-fix` group (clean spec: healed, re-run, uncommitted; a spec with your own uncommitted edit: `blocked`, untouched), `--from <triage.json> --heal --groups=g4` in a fresh session, and the `qa-kit:agent-triager` agent. Nothing may be created in Jira at any point.
28. **Ledger across runs** - on a real repo: `feature-implement <plan> --level=smoke`, then `--level=sanity` (no `--commit`), then `feature-deliver`. Both runs' specs and any support files they created are committed once; a file you edited by hand before the first run is never staged and appears in `skippedPaths`; the second run's Write prompt names the first run's files and does not list them as yours. Between the runs and the deliver, add a test, edit a support file and change an application file by hand, and also touch a file you had been editing before the first run: all four are committed, listed in `handChanges`, mentioned in the commit message, and the runner prints a warning naming them (the test files are reviewed first). Add a gitignored file: it never shows up. Put a fake `.env` that is not ignored in the folder: `feature-deliver` stops and says so. Repeat in a fresh Claude Code session (no report in the conversation): the first run's files count as yours, so Deliver leaves them out and says so.
29. **Idempotence and `Extends`** - run `feature-implement` twice on the same plan: the second run writes no new test. Plan a feature with a scenario that partly exists: the new test is added to the existing spec and `describe`, reusing its setup, and the existing test is untouched.
30. **Test index** - run `npx playwright test --list --reporter=json` on a real repo and check the fields `verify-coverage`, `plan-tests` and `write-tests` read (file, line, title path, tags, annotations), including with `--grep @feature-tag` on a large suite. Note any repo where the command is slow or fails and set a different *List tests* row in its `conventions.md`.
31. **Evals** - run `npm run eval` once and read `evals/README.md`: the four cases pass (they have never been run yet, so expect to adjust graders and fixtures on the first pass); a deliberate break (edit `triage-failure` so it may file tickets) makes `triage-never-files-jira` fail. `claude plugin eval` is early access and needs a judge model your account can call (`--judge-model`); record the Claude Code version it ran on. The retest, live check, `--heal` safeguard and `--known` matching are not covered by the evals and stay on this checklist.

**Monkey tester (0.7.0)**

32. **Monkey test** - on a real staging app with a test account: `/qa-kit:monkey-test <area> --minutes=2`, then `/qa-kit:feature-monkey <a> <b> --minutes=2 --parallel=2`, through the runner as well (`node runner/qa-kit.mjs feature-monkey <a> --agent opencode`). Check: a production-looking URL is refused; `pages/<key>.md` exists before the first `action-log.jsonl` line for that page and cites plan and test sources; a second run reuses `_cache/` cards and a changed plan file rebuilds them; elapsed time stays within budget plus grace (the workflow clock stops starting new page units); everything created is named `mk-<runid>-` and gone afterwards (`cleanup: clean`), and `--read-only` creates nothing; a killed run leaves a ledger that `leftBehind` / the next report names; no tracked file, git state or `.env` changed (exit code 3 otherwise); no secret or `.env` value in any written file; `findings-plan.md` is accepted by `/qa-kit:feature-implement`. Data safety: before the run, plant on the test account an item named `Source - do not delete`, one named `NOT for cleanup`, one locked or read-only item, and use one record your own tests rely on; after the run all four are unchanged, none was copied or used as the source of a copy, and the report lists them under "left alone"; a delete is never preceded by a select-all or any bulk action in the action log. Also verify what is unverified: that parallel `agent-monkey` agents inside one interactive Claude session really share one Playwright MCP browser (the docs say parallel areas belong in the runner), that the `Workflow` tool honors the per-call `timeoutMs`, and that `Write(./qa-kit-artifacts/**)` needs no extra prompt in `settings.json`.

**Defect retester (0.9.0)**

33. **Retest defect** - on a real staging app with a test account and real defect tickets: `/qa-kit:retest-defect <key>` for (a) a resolved defect with clear steps, (b) an open defect that still exists, (c) a defect with no steps, (d) a defect whose steps need a specific existing record. Check: (a) and (b) give the verdicts you know to be true, with the ticket status shaping the reading (regression candidate, or "maybe fixed"); (c) is `inconclusive` and nothing was attempted; (d) is `inconclusive` and the record is untouched; a production-looking URL is refused; everything created is named `rt-<runid>-` and gone afterwards; no Jira issue changed; no tracked file, git state or `.env` changed (nothing checks this in code, so look). Coverage: a test that only visits the page is not counted as covering; a defect that reproduces while a covering test exists names why that test does not catch it. Answer yes to "plan one now?": a plan appears under `qa-kit-artifacts/`, its Open Questions mention that the test fails until the fix, and nothing is implemented; `--no-plan` never asks. Also verify what is unverified: how much of a ticket's screenshots and attachments the Atlassian and Glean MCP servers actually return (the report must say per attachment whether it was read), and that the `agent-defect-retester` returns `offerPlan` instead of asking.

**Change analysis (0.10.0)**

34. **Change analysis** - on a real repo, with a mapping file and without one, through `/qa-kit:feature-select`, then once through the runner (`node runner/qa-kit.mjs feature-select --agent claude`) and once on OpenCode (`/qa-kit-feature-select`). Local state: a clean tree on the default branch says "no scope identified" and runs nothing; a branch that changes one feature's application code is narrowed to the specs you would pick by hand (with the smoke specs of that feature, `--no-smoke` drops them); an uncommitted edit and a new untracked file both count; `package.json`, the Playwright config, a `Dockerfile` or a migration is `full` (`global-change`); a docs-only branch is `none`, a `.md` under `src/` is not; `--min-confidence=high` turns a one-source change into `full`; `--threshold=30` turns a big selection into `full`; `--base=origin/<other branch>` with and without that branch present locally (blocked with the fetch hint, then fine with `--fetch`); a shallow clone is blocked, never guessed; with a pull request number and with `--since=7`. Pull requests: `--repo=<org>/<app> <pr>` against a real application repo (needs `gh auth`), a pull request with more than 100 files, one the host refuses to diff, a `--since` window with more than 200 merged pull requests (all three must end blocked, not narrowed), and one change that spans two repos (`org/a#1, org/b#2`: both repos' files appear in the report, a bare number is refused, an unreadable repo blocks the whole run). Check that `selection.args` runs as is (`npx playwright test $(cat ...)`), that a project name with a space is refused, that the mapping and inference disagreements the report lists are real, that a leftover `selection.json` from an earlier run never survives a failed run, and that no tracked file, git state, branch or `.env` changed (exit code 3 otherwise). `/qa-kit:feature-diff --since=7 --run-affected`: the gaps match what you know is untested, one plan per gap lands in `qa-kit-artifacts/` and is accepted by `/qa-kit:feature-implement`, `handoff.json` lists the plans, a failing affected test exits 2, and a repo that does not ignore `playwright-report/` still passes the guard. `--plan` on `feature-select`, `--no-select`, the standalone `analyze-changes --coverage` and `select-tests`, and `--record-plans` each once. Also verify what is unverified: that a headless Claude run can use `gh pr list`, `git log` and the gate script without a prompt (repo `settings.json`), how slow the *List tests* index is on a large suite, the `tags` field of your Playwright version's JSON list (without it smoke specs are not added), and how often a real change set exceeds the 300-file guard.

**CI actions** - see the checklist at the end of `actions/README.md`.

## Known limitations

- **Delivery and coverage (decided, documented):** `feature-deliver` does not check that the checked-out branch is the target's, so check it out again after switching branches; a bare `feature-deliver` takes every unblocked entry of the latest implement report, including work already committed with `--commit`, so name the branch to avoid delivering twice; the scenario-to-test mapping is computed in each Review stage and shown in its report, not stored, and `feature-deliver` has no plan so it runs no coverage check; worktrees from multi-plan runs are never removed.
- `write-tests` encodes the org's default conventions (path aliases, `TestFeature` enum, Allure helpers). Repos that differ say so in `.qa-kit/project/conventions.md`; the skills defer to it.
- OpenCode: no generated permission rules, no per-agent tool restrictions, and the pipelines depend on the runner.
- **Residual risk on OpenCode.** Outside the runner, nothing in the kit blocks `git push` or `gh pr create`, and nothing enforces the user-invocation-only skills (`init`, `commit-and-push`, `create-pr`, `write-commit-message`): OpenCode's default permission policy allows everything and its documentation does not list `disable-model-invocation`. The skills' own confirmation prompts and, for runner runs, the post-run checks are the only guards. This is a known gap, to be revisited after the OpenCode check in the pilot checklist.
- The generated `opencode.json` uses OpenCode's V2 schema (`mcp.servers`, `{env:VAR}`); on a V1 install (docs.opencode.ai) move the servers up one level, directly under `mcp`.
- Subfolder install (`init --path`): the agent must be started in that folder; at the repo root nothing loads at start, and Claude Code can still pick up `<folder>/CLAUDE.md` later in a session that reads or edits a file in it. The CI workflow is only offered with a TODO (the actions have no `working-directory` input). Verified with Claude Code; the OpenCode side is item 16 of the pilot checklist.
- Updating a repo needs read access to the kit repository (the git credentials you already use) and the kit tag that wrote your files. Offline, in CI without access, or after a tag was removed or moved, the affected files fall back to a first-time merge (review copy, nothing overwritten) and `init` reports them.
- Atlassian MCP stays on the v1 endpoint for now; move to v2 before 2027-03-01 and re-check tool names and permissions.
- Defect retester: it has no workflow or runner entry, so the runner's post-run checks (no tracked file, git state or `.env` change) do not apply to it. Its limits rest on the skill's rules and the agent's tool list (no `Edit` tool; `Bash` and `Write` are granted). It reads attachments only as far as the Atlassian and Glean tools return them.
- Monkey tester: parallel areas share one app and one test account; the budget is enforced by the workflow clock only when run through `feature-monkey` (a direct `monkey-test` run reads a `node` clock the skill checks itself); a killed run cannot clean up, so the report names the ledger to sweep; traces, video and Allure/Playwright repro specs are not produced yet.
- Change analysis: GitHub only for `--repo` (no other host; at most 10 repos per run); the CI wiring is not built (see "Change-driven testing", Roadmap / TODO); the mapping and inference crossing is advice from evidence, so the inference half is a model's reading and can be wrong (the mapping file and `--min-confidence=high` are the counterweights), importers of a changed support file are found by search (a barrel file, a dynamic import or `test.extend` fixtures can hide a reader: those are marked wide, which means the full suite); `playwright test --list` runs the repo's own config and specs, so on a pull request from a fork it runs untrusted code; a change set of more than 300 files is not analysed (it counts as global); selection works per spec file, not per test title; the deny rules and the post-run guard belong to the runner: through Claude Code's Workflow tool, a direct skill run or OpenCode interactively nothing checks the limits afterwards (the agent is granted `Bash` and `Write`, and OpenCode has no tool allow-list), so there they rest on the skill rules and the gate's own `check`, which a consumer should run before using a selection.
- Skills and commands are namespaced: `/qa-kit:feature-plan` (Claude Code) and `/qa-kit-feature-plan` (OpenCode), not `/feature-plan`.
