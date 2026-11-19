# Using qa-kit in the Claude desktop app (Windows and Mac)

Everything below is done with clicks, no terminal and no commands. The steps are the same on Windows and macOS. Menu names come from Anthropic's plugin documentation; items marked **unconfirmed** have not been tried with this plugin yet. If your app version labels a menu differently, look for the same words under **Customize** in the sidebar (it is the page that holds connectors, skills and plugins).

## Which way to install

| Way | Best for | Updates |
|---|---|---|
| **A. Add the marketplace from GitHub** (recommended) | everyone who can reach the repo on GitHub | one click, or automatic |
| **B. Upload the ZIP** | no access to the repo from the app, or a quick trial | you upload each new ZIP yourself |
| **C. Organization install** (Team / Enterprise owners) | a whole team, with "installed by default" or "required" | the owner syncs the repo; members get it automatically |

## Desktop install or terminal command: the same plugin or not?

No, they are two installs in two places. Pick by where you work.

| You install with | It is saved to | Chat | Cowork | Code tab | Terminal and IDE |
|---|---|---|---|---|---|
| **Customize > Plugins** (this guide) | your claude.ai **account** | yes | yes | yes, as a synced plugin (`qa-kit@synced`) | only in a session signed in with the same claude.ai account (Claude Code 2.1.273 or newer); then `/reload-plugins` or restart |
| **Terminal:** `claude plugin install qa-kit@ngavish-qa --scope user` | this **machine** | no | no | yes: the Code tab reads the same machine settings as the terminal | yes |

- A command-line install does **not** appear under **Customize > Plugins**: Anthropic's documentation says plugins installed from the command line "stay on that machine and aren't added to your claude.ai account".
- Terminal sync of an account plugin needs a claude.ai sign-in. It is skipped when the credential comes from `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` or an `apiKeyHelper`. A terminal that uses Bedrock or another provider is not signed in that way, so expect **no** sync there (not on the documented exclusion list by name, so **unconfirmed**): install with the command instead.
- Both together is harmless: the machine install wins in the terminal and the synced copy is reported as not loaded. They update separately, so update both (the command route is in the README, "Updating to a new version").
- Recommendation: if you work in the terminal, an IDE or the Code tab, install with the command. Add the **Customize > Plugins** install only if you also want qa-kit in Chat or Cowork.
- Clicks instead of the command, same result as the command: in the **Code** tab, **+** next to the prompt box, **Add plugins**, choose the scope **user**. This writes to the machine settings, not to your account. Whether the marketplace can be added from that screen is **unconfirmed**; `/plugin marketplace add ngavishtech/qa-kit` in a Code tab session does it.

The rest of this guide is the account install from **Customize > Plugins**.

## A. Add the marketplace from GitHub

1. Open the Claude desktop app and sign in.
2. Click **Customize** in the sidebar, then **Plugins**.
3. Click **Add**, then **Add marketplace**. (You can also look under **Discover**; the marketplace you add appears there next to the others.)
4. Enter the repository: `ngavishtech/qa-kit` or `https://github.com/ngavishtech/qa-kit`. Confirm.
5. The repository is public, so this normally works without any GitHub connection. If the dialog asks you to connect GitHub (for example your GitHub organization restricts apps), click **Connect GitHub**, sign in, then **Install the Claude GitHub App**. A GitHub organization owner may have to approve the Claude GitHub App first; ask them before you start.
6. When the marketplace `ngavish-qa` has been added, open it, select the plugin **qa-kit** and click **Add**.
7. Check it worked (below).

A marketplace you add yourself counts against a limit of 25 per account.

## B. Upload the ZIP

1. Get `qa-kit-<version>.zip` from the person who built it (they run `bash scripts/package-zip.sh`, see "Building the ZIP").
2. Click **Customize**, **Plugins**, **Add**, **Upload plugin**.
3. Pick the `.zip` file. Do not unzip it.
4. Check it worked (below).

## C. Organization install (owners)

Organization settings, **Plugins & skills**, **Add**, **Upload a plugin** (or sync the GitHub repository), then set availability per group: **Available to install**, **Installed by default** or **Required**. Members then find it under **Customize > Plugins** without adding anything; a required plugin cannot be turned off.

## Check that it worked

1. Open **Customize > Plugins**, open **qa-kit**. Its page lists **Skills**, **Commands** and **Agents** on separate tabs.
2. In a conversation type `/`. The menu lists the skills with the plugin name, for example `qa-kit:plan-tests`. Type `qa-kit` to narrow it.
3. In the **Code** tab, open a session on your computer and type `/qa-kit:`; the commands appear. Run `/qa-kit:help` for a one-screen overview of everything qa-kit offers.

## What works where

| Component | Chat | Cowork | Code tab |
|---|---|---|---|
| Skills (`help`, `plan-tests`, `read-ticket`, `write-tests`, `review-tests`, `create-pr`, ...) | loads | loads | loads |
| Commands (`feature-plan`, `feature-implement`, `feature-deliver`, `feature-monkey`) | loads as skills | loads | loads |
| Agents (`test-planner`, `test-writer`, `test-executor`, `test-reviewer`, `test-deliverer`, `test-triager`, `test-monkey`) | ignored | loads | loads |
| Workflows (the parallel pipeline in `workflows/*.js`) | **unconfirmed, assume no** | **unconfirmed, assume no** | **unconfirmed**, the terminal and IDE are the tested route |
| Paths from skills to the plugin's `patterns/` folder | **unconfirmed** | **unconfirmed** | works |

Expect single-feature work (`plan-tests`, `read-ticket`, `write-tests`, `review-tests`, `create-pr`) in the desktop app. Skills that run git, tests or lint need a session on your own computer: the **Code** tab with a local session, or Cowork running on your machine. Plugins do not work in cloud sessions or in WSL sessions.

## Set up a repo from the desktop app

1. Open the **Code** tab and start a **local** session in the repository folder (for a repo that is not only automation, in the subfolder, see below).
2. Type `/qa-kit:init` and follow the questions. Add `--path=<folder>` in a repository that is not only test automation.
3. Read the plan, accept the files, then read the report at the end: it lists what to commit and which files your `.gitignore` swallows.
4. Commit and open the PR the way you normally do.

Settings in a repository's `.claude/settings.json` apply in Code tab sessions the same way as in the terminal. With a subfolder install, start the session **in that folder**.

## Credentials (TestRail, Figma)

The MCP servers for Jira, Figma and TestRail belong to the repository (`.mcp.json`) and need `TESTRAIL_URL`, `TESTRAIL_USERNAME`, `TESTRAIL_API_KEY`, `FIGMA_API_KEY` and (for the Glean fallback) `GLEAN_URL` in the environment the app is started from. A desktop app does not read your terminal's `export` lines.

- **Windows:** set them as user environment variables (Start menu, search "Edit environment variables for your account"), then quit the app completely and start it again.
- **macOS:** set them where GUI apps can see them (for example `launchctl setenv NAME value`), or start the app from a terminal that has them exported; then restart the app.

For chat and Cowork, where `.mcp.json` is not used, use **Customize > Connectors** for Jira and Figma. Whether a TestRail connector is available there is **unconfirmed**.

## Updating

### A. Marketplace install - update with clicks

What the release owner does first (otherwise nothing changes): bump `version` in `.claude-plugin/plugin.json`, add a `CHANGELOG.md` entry, commit and push to the repository's default branch. A plugin whose version string did not change is not updated.

What each person does:

1. Click **Customize**, then **Plugins**.
2. Open the **ngavish-qa** marketplace and click **Check for updates**.
3. Open **qa-kit** and confirm the new version is shown. A new version that syncs from the source reaches your account automatically; there is nothing to accept.
4. Start a **new** Cowork task or a **new** Code tab session so the new version is the one loaded. In an already open Claude Code terminal session run `/reload-plugins`.
5. In every repository set up with an older version, **one person** runs `/qa-kit:init` again (Code tab, local session, in the install folder) and commits the files the report lists. Everyone else pulls.

Turn on **Sync automatically** for the marketplace (available for marketplaces you added yourself from github.com) and step 2 happens by itself; you still do steps 4 and 5.

### B. ZIP install - update by uploading again

A ZIP does not update by itself.

1. The release owner bumps `version`, commits, builds the ZIP and shares it.
2. Click **Customize**, **Plugins**, **Add**, **Upload plugin** and pick the new ZIP.
3. If the app says the plugin already exists, open the old **qa-kit** from **Customize > Plugins**, open its menu, **Remove**, then upload the new ZIP. **Unconfirmed** whether a re-upload replaces the old version in place.
4. Do steps 4 and 5 of the marketplace update above.

Organization owners installing by upload get **Upload new version**, with history and rollback.

## Disable or remove

**Customize > Plugins**, open **qa-kit**, turn off **Disable plugin** (the toggle) to switch it off, or open its menu and select **Remove**.

## Building the ZIP

```bash
# 1. bump "version" in .claude-plugin/plugin.json and add a CHANGELOG entry
# 2. commit everything
bash scripts/package-zip.sh          # tests, validates, then writes dist/qa-kit-<version>.zip
bash scripts/package-zip.sh --out qa-kit-artifacts   # same, into another folder
```

The script uses `git archive`, so the ZIP holds exactly the committed files; `--snapshot` takes the working tree for a trial build that is not for release. Paths marked `export-ignore` in `.gitattributes` (`actions/`, `scripts/`, `test/`, repo dotfiles) are left out because they are not plugin content. Limits: 200 MB and 5,000 files per plugin; a top-level `bin/` folder is rejected by the app (the script refuses to build if one exists). Never put secrets in the repo: every installer receives every file.

## If something is off

| Symptom | Likely cause and fix |
|---|---|
| The dialog says it cannot read the repository | usually an organization policy that restricts apps or network access: choose **Connect GitHub** or **Install the Claude GitHub App**; a GitHub owner approves the app first. Check that `github.com` is reachable from the app |
| **Add marketplace** is missing or refuses | on Team and Enterprise an owner can restrict which sources members may add; ask an owner, or use the ZIP |
| No `/qa-kit:` commands in the Code tab | open a new session after installing; sign in with the same account that installed it; in a terminal session run `/reload-plugins` |
| Chat shows skills but no agents | expected: chat ignores agents; use Cowork or the Code tab |
| `monkey-test` cannot reach the app or log in | it needs the Playwright MCP server and the test account from your own `.env` on your computer: use the **Code** tab with a local session in the repo, not chat; it refuses production-looking hosts on purpose |
| `feature-implement` does not run in the desktop app | the parallel pipeline is tested in the terminal and IDE only; use the single-feature skills, or the terminal |
| MCP tools fail with a missing variable | start the app from an environment that has the variables (see "Credentials") |
| Still the old behaviour after an update | the version string did not change, so nothing was published: check `version` in `plugin.json` on the default branch, then **Check for updates** |

## Checklist (none of this could be tested from the build environment)

1. **Marketplace add** - Customize > Plugins > Add > Add marketplace accepts `ngavishtech/qa-kit`, and the plugin `qa-kit` appears under **Discover** with its skills.
2. **ZIP upload** - Customize > Plugins > Add > Upload plugin accepts `qa-kit-<version>.zip` without errors and the skills appear.
3. **Paths** - in Cowork, `/qa-kit:plan-tests` can read the plugin's `patterns/` folder (if not, skills cannot find their reference files in chat and Cowork).
4. **Workflows** - check whether `/qa-kit:feature-plan` runs at all in the desktop app; if not, state "terminal and IDE only" in the command descriptions.
5. **Update path** - after a version bump, **Check for updates** shows the new version and a new Code tab session uses it; a re-uploaded ZIP replaces the old version in place or needs **Remove** first.
6. **Account sync** - a plugin installed here appears as a synced plugin in a terminal Claude Code session signed in to the same account (v2.1.273 or newer), after `/reload-plugins`.
