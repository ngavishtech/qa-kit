# MCP setup guide

qa-kit uses **Model Context Protocol (MCP)** servers to reach Jira/Confluence, Figma, TestRail and a real browser while it plans and writes tests. The same five servers are used by Claude Code and OpenCode. This guide covers what each server is for, how it gets configured, the per-person credentials, and how to check it works.

## Servers

The list lives in one place, [`templates/mcp.json`](../templates/mcp.json). Packages, URLs and variable names below match it.

| Server | Used for | Transport | Credential | Blocking or optional |
|---|---|---|---|---|
| `playwright` | Drive a browser, discover locators, confirm a fix | local: `npx -y @playwright/mcp@latest` | none | Optional for planning; needed for locator discovery and healing |
| `atlassian` | Read Jira issues and Confluence pages; write back to Jira | remote SSE: `https://mcp.atlassian.com/v1/sse` | OAuth sign-in on first use | Blocking for a bare Jira key, unless `glean_default` works |
| `glean_default` | Enterprise search; read-only route to Jira and Confluence | remote HTTP: the URL in `GLEAN_URL` | `GLEAN_URL` (your Glean MCP URL), then OAuth sign-in on first use (separate grant from Atlassian) | Same as `atlassian`; one of the two is enough for reading. Without `GLEAN_URL` the server is still listed but cannot connect (Claude Code warns about the missing variable in `/mcp` and `claude mcp list`) |
| `testrail` | Coverage cross-check and case mapping | local: `npx -y @bun913/mcp-testrail@latest` | `TESTRAIL_URL`, `TESTRAIL_USERNAME`, `TESTRAIL_API_KEY` | Optional: planning lists it as unavailable |
| `figma` | Design specs from a Figma link | local: `npx -y figma-developer-mcp@latest --stdio` | `FIGMA_API_KEY` | Optional, unless the Figma link is the only source |

How a missing server is handled (blocking vs optional, Atlassian/Glean fallback, read-only Glean) is defined once in `patterns/mcp-usage.md`. The packages follow `@latest` and are started with `-y` (no install prompt). `testrail` and `figma` are community packages, not vendor-maintained: review their source before trusting them with a token.

## How the servers get configured

**No repo?** Register them once at user level instead: `/qa-kit:init --user`, or `node "$HOME/.qa-kit-src/tools/cli.mjs" mcp --agent claude|opencode` from the kit checkout (cloned once, outside any project repo: `git clone <git url of this repo> "$HOME/.qa-kit-src"`; update with `git -C "$HOME/.qa-kit-src" pull`). It uses the same server list, leaves existing servers untouched and stores no credentials.

Run the kit's init in the test repo (`/qa-kit:init`). It reads `templates/mcp.json` and writes the server list into the repo, never overwriting what exists:

| Agent | File written | Notes |
|---|---|---|
| Claude Code | `.mcp.json` | Same shape as the template. `${VAR}` values are expanded from your environment at launch. |
| OpenCode | `opencode.json` | Converted from the same list: local servers become `{type: "local", command: [...], environment: {KEY: "{env:KEY}"}}`, remote ones `{type: "remote", url}`. |

MCP servers are declared in the consuming repo on purpose, so tool names stay predictable. To change the server list, edit `templates/mcp.json` in this kit, not the generated files. Commit the generated file so teammates get the same servers. Restart the agent after init (or `--user`) so it loads the servers that were added or changed.

Tool names depend on the agent, and each agent builds them from the server name and the tool name in its own way. The skills here are written for the agent you installed them for.

Do not hardcode tool names. List the live tools and use what the server reports.

## Credentials (per person)

Credentials are personal. Each person exports their own in their own environment. Never put them in a repo `.env`, in a committed file, in a chat, or on a command line (it ends up in shell history and the process list). The servers do not read `.env`.

| Variable | Where to get it |
|---|---|
| `TESTRAIL_URL` | Your TestRail instance URL, for example `https://your-instance.testrail.io` |
| `TESTRAIL_USERNAME` | Your TestRail login email |
| `TESTRAIL_API_KEY` | TestRail > My Settings > API Keys > Generate key (an admin must have enabled the API under Administration > Site Settings > API) |
| `FIGMA_API_KEY` | Figma > Account Settings > Personal access tokens > Generate token (read-only access is enough) |
| `GLEAN_URL` | The MCP URL of your Glean instance (ask your Glean admin; it looks like `https://<company>-be.glean.com/mcp/default`). Only needed for the Glean fallback |

Atlassian needs no variable; it signs in through the browser. Glean needs `GLEAN_URL` and then signs in through the browser too.

### macOS and Linux

Add an `export` line per variable to `~/.zshrc` or `~/.bashrc` with your editor, open a new terminal and start the agent from it:

```bash
export FIGMA_API_KEY="<paste in the editor, not on the command line>"
export GLEAN_URL="<your Glean MCP URL>"
```

Apps started from the Dock or a launcher do not read shell profiles. Start the agent from a terminal that has the variables.

### Windows

Preferred: Start menu > "Edit environment variables for your account" > New, once per variable. This keeps values out of shell history. Then fully quit and reopen the terminal or IDE (a running process does not see new variables).

PowerShell alternative that does not echo the value into history:

```powershell
[Environment]::SetEnvironmentVariable("FIGMA_API_KEY", (Read-Host "FIGMA_API_KEY"), "User")
[Environment]::SetEnvironmentVariable("GLEAN_URL", (Read-Host "GLEAN_URL"), "User")
```

`setx NAME value` also persists the variable, but the value sits on the command line and in history; avoid it for tokens.

Git Bash inherits your Windows user variables when it starts, so no extra step is needed after the above. To set them for Git Bash only, add `export` lines to `~/.bashrc` with an editor.

### Check they are set (prints names only)

```bash
for v in FIGMA_API_KEY GLEAN_URL TESTRAIL_URL TESTRAIL_USERNAME TESTRAIL_API_KEY; do [ -n "${!v}" ] && echo "$v set" || echo "$v MISSING"; done
```

```powershell
"FIGMA_API_KEY","GLEAN_URL","TESTRAIL_URL","TESTRAIL_USERNAME","TESTRAIL_API_KEY" | ForEach-Object { if ([Environment]::GetEnvironmentVariable($_)) { "$_ set" } else { "$_ MISSING" } }
```

## First use, per agent

| Step | Claude Code | OpenCode |
|---|---|---|
| Approve project servers | On first open of the repo, approve the servers from `.mcp.json`. Until then `claude mcp get <name>` shows `Pending approval`. To be asked again: `claude mcp reset-project-choices` in that repo. | No approval step is known (unverified, confirm in the pilot). |
| Sign in to Atlassian and Glean | Run `/mcp`, pick `atlassian` (and `glean_default`), choose **Authenticate**, finish the browser sign-in. | Remote servers authenticate on first use (unverified, confirm in the pilot). If no browser opens, see the MCP section of the OpenCode docs. |
| TestRail and Figma | Nothing to do beyond the exported variables, set before the agent starts. | Same. |

## Verify

| Check | Claude Code | OpenCode |
|---|---|---|
| Server status | `/mcp`, or `claude mcp list` | `opencode mcp list` (unverified; if the command is missing, see the MCP section of the OpenCode docs) |
| Real data | Ask: "read Jira ticket ABC-1234", "list my TestRail projects", "take a snapshot of <your app URL>", "fetch layout info for <Figma file URL>" | Same prompts |

Every server should show as connected. A reply that looks invented rather than fetched means the server is not really connected; fix that before planning. `/qa-kit:init` also reports which variables are missing (names only, never values).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Server not connecting, nothing listed | MCP servers start only at launch. Quit and restart the agent. Confirm `node --version` (22 or newer) and `npx --version` work in the same terminal. |
| Claude Code shows `Pending approval` | Approve the project servers; see "First use". |
| `testrail` or `figma` fails to start | Variable not set in the shell the agent was started from. Run the check above, then restart the agent from that terminal. A value only in a `.env` file does not reach the server. |
| Package will not start | Run it by hand in a terminal that has the variables, for example `npx -y figma-developer-mcp@latest --stdio`. Never pass the key as an argument. |
| `npx` not found when launched from an app | The app has a minimal `PATH`. Start the agent from a terminal, or use the absolute path of `npx` in the generated file. |
| Windows: `npx` not found or the server exits at once | Claude Code on native Windows needs `cmd` as the command: `"command": "cmd", "args": ["/c", "npx", ...]`. `node "$HOME/.qa-kit-src/tools/cli.mjs" mcp --agent claude` and `/qa-kit:init --user` do this automatically at user scope. Do not commit the wrapper in a repo `.mcp.json` shared with macOS and Linux teammates; register the Windows variant in your own user scope instead. For OpenCode use `["cmd", "/c", "npx", ...]` in `opencode.json`. Check that the Node install folder is in `PATH`, then reopen the terminal. |
| OAuth loop or expired session | Re-authenticate: Claude Code `/mcp` > server > Authenticate. Check that `mcp.atlassian.com` and the host in `GLEAN_URL` are not blocked by a proxy or firewall. Atlassian and Glean are separate grants: one working does not imply the other. |
| Tools missing or called by the wrong name | Tool names depend on the agent and the server. List the live tools and use those names. |
| Atlassian works but cannot write | Check you used `atlassian`, not `glean_default`: Glean is read-only. |
| Jira key cannot be read at all | Neither Atlassian nor Glean is signed in. Sign in to one, or paste the ticket text. |
| Playwright MCP cannot find locators | Browsers are not installed (`npx playwright install` in the test repo), or the app under test is not reachable. |

## Atlassian endpoint

The config uses the v1 SSE endpoint `https://mcp.atlassian.com/v1/sse`. Plan to move to the v2 endpoint before 2027-03-01, then re-check tool names and the permission rules in `templates/settings.json.template`. This needs an owner decision (see `.claude/CLAUDE.md`).

## Security notes

1. Treat API keys like passwords. Rotate them regularly (every 90 days is a good default); OAuth grants are revoked in your account instead.
2. Use the least access available: a read-only Figma token is enough.
3. Review third-party MCP packages before connecting real credentials.
4. Never commit a file that contains a token.
