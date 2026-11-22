# Allure report archive (gh-pages as a data branch)

How `actions/playwright-run.yml` keeps **every** Allure report, each at its own permanent URL, instead of overwriting one report on every run. This page explains what happens, why it is built this way, how retention and cleanup work, and what a new repo needs to use it.

| In this folder | What it is |
|---|---|
| `scripts/publish-allure-report.sh` | publishes one report, prunes old runs, pushes (with retries) |
| `scripts/allure-index.js` | `summary` (per-run metadata), `index` (landing page), `prune` (retention) |
| `scripts/cleanup-gh-pages.sh` | on-demand cleanup by hand (dry run by default) |

The workflow is `actions/playwright-run.yml` (one level up). Both the workflow and the scripts are **copied** into the consuming repo; nothing here runs from qa-kit at CI time. Not wired into `/qa-kit:init`.

## What you get

```
index.html                    landing page: latest per environment + table of all runs (generated)
<environment>/latest/         newest report of that environment; source of the Allure trend history
<environment>/<run number>/   one folder per workflow run, never overwritten
```

- Slack links straight to **this run's** report, plus the landing page ("all runs").
- Every run keeps the trend graph of its own environment's earlier runs.
- Old runs disappear automatically after 60 days (configurable).
- Each run also uploads a self-contained single-file report as a workflow artifact (30 days).

## What happens in a run

All steps are in `playwright-run.yml`, after the tests ran (every step uses `if: always()` so a failed test run still reports).

| Step | What and why |
|---|---|
| Load Allure History | checks out the `gh-pages` branch into `./gh-pages`. `continue-on-error`: on the very first run the branch does not exist. `persist-credentials: true` so the publish step can push with the same auth. |
| Generate Allure Report | copies `gh-pages/<environment>/latest/history` into `allure-results/history` **before** generating, then generates and reads the pass/fail counts. Allure 2 builds the trend from `<results>/history`; copying history into the finished report (the old approach) does nothing. |
| Resolve GitHub Pages URL | asks the Pages API for the site root. A private repo's site is on a generated domain, not `<owner>.github.io/<repo>`. Falls back to the public form with a warning. |
| Publish report to gh-pages | runs `publish-allure-report.sh` (below). Skipped when generation itself failed (nothing valid to publish). |
| Generate single-file Allure report | `allure generate --single-file`: everything embedded in one `index.html`. `continue-on-error`; only feeds the artifact. |
| Uploads | `allure-report-<date>` (the single-file report), `allure-results-<date>`, `playwright-report-<date>`, 30 days each. |
| Post to Slack | "Allure Report" = this run's folder, "all runs" = landing page. If publishing failed, both fall back to the Pages root. |

### What `publish-allure-report.sh` does, per attempt

1. **Sync** the `gh-pages` working tree to the remote tip (or start an empty orphan branch if the branch does not exist).
2. **Apply**: delete and recreate `<environment>/<run number>/` from the report, write `run-summary.json` next to it, copy it to `<environment>/latest/`.
3. **Prune** by retention (below), warn if the archive is large.
4. **Index**: touch `.nojekyll`, regenerate `index.html` from every `run-summary.json`.
5. **Commit and push** as one parentless commit holding the whole tree, with `--force-with-lease` pinned to the tip it started from.
6. If the push is rejected, wait 2-6 s and repeat from step 1 (up to `MAX_ATTEMPTS`, default 5).

Outputs for later steps: `report_url`, `latest_url`, `index_url`.

## Why it is built this way

| Decision | Reason |
|---|---|
| **`gh-pages` is a data-only branch**, everything else lives on the default branch | Pages needs a branch to serve. Keeping scripts, workflow and docs on the default branch means the data branch can be wiped or recreated without losing logic. If the branch is deleted, the next run recreates it (only the archived history is lost). |
| **One folder per run** (`<run number>`) | Permanent, linkable, comparable. Re-running the same workflow run overwrites that number's folder (same run number, higher attempt). |
| **Per-environment folders and history** | Environments share one workflow. A single `history/` would mix e.g. a test environment and a production one in the same trend. |
| **`latest/` as history source** | The newest report always holds the full Allure `history/`; no need to search for it. |
| **Single parentless commit per publish** | Pruned reports must also leave git history, otherwise the branch (and the repo) only ever grows and the 1 GB Pages limit is approached through history, not content. The branch history has no value, so each publish replaces it. |
| **`--force-with-lease`, retry from the remote tip instead of rebase** | Concurrency is per environment, so two environments can finish together. A rebase would conflict on `index.html`; re-applying the change on the new tip cannot. The lease turns "someone else pushed" into a clean retry instead of a lost update. |
| **Index and summaries generated, not hand-edited** | `run-summary.json` (date, branch, trigger, scope, counts, run URL) is the only metadata. Retention reads the run date from it, because file times mean nothing in git. |
| **Single-file artifact** | A normal Allure 2 report loads its data over HTTP and shows a blank page when opened from disk. The single-file version opens by double-click, so a downloaded copy is usable offline. |
| **`.nojekyll`** | Stops Pages from running Jekyll over the archive (slow, and can skip files starting with `_`). |

## Retention and cleanup

### Automatic (every publish)

`allure-index.js prune <dir> <KEEP_DAYS> <KEEP_RUNS>` runs across **all** environments, so one that stopped running still ages out.

| Setting (in the publish step `env`) | Default | Meaning |
|---|---|---|
| `KEEP_DAYS` | `60` | remove run folders older than this; `0` = no age limit |
| `KEEP_RUNS` | `0` | optional cap of newest runs kept per environment; `0` = no cap |
| `MAX_SITE_MB` | `800` | warns when the tree is bigger (Pages sites are limited to about 1 GB) |

Rules worth knowing:
- A run folder **without a readable `run-summary.json` is never removed** (so legacy or hand-added content is safe).
- A folder is only treated as an environment if it holds `latest/` or numbered run folders; anything else at the root is left alone.
- An environment with no runs left is removed completely, `latest/` included. The `latest/` of an active environment is never touched.
- `latest/` is a second copy of the newest run, so the archive holds roughly (runs + 1) reports per environment. Reports with traces or videos are large: lower `KEEP_DAYS` or set `KEEP_RUNS` if the size warning appears.
- Partial runs (filtered scope) are archived with their scope shown on the landing page, but they still feed the trend. Compare like with like.

### On demand: `cleanup-gh-pages.sh`

For things retention does not cover: an old flat report left at the branch root from before this solution, a retired environment, one bad run, or a one-off shorter window. **Dry run unless `--apply`**: always run it without first and read the plan (what would go, file count and size before and after).

```bash
scripts/cleanup-gh-pages.sh --legacy-root                     # dry run: old flat report at the branch root
scripts/cleanup-gh-pages.sh --legacy-root --backup old.tar.gz --apply
scripts/cleanup-gh-pages.sh --env test01 --apply  # a retired environment
scripts/cleanup-gh-pages.sh --run test01/131 --apply
scripts/cleanup-gh-pages.sh --older-than 30 --apply           # same rule as KEEP_DAYS, other number
```

- Needs git, node and push access to `gh-pages`; run it from a clone of the consuming repo.
- Refuses to start while the workflow has a run in progress or queued (`--force` skips; needs the `gh` CLI, otherwise it warns and relies on the push lease). The workflow file name is `playwright-run.yml`; set `WORKFLOW_FILE` if yours differs.
- Pushes one replacement commit like a publish does; the push is rejected, changing nothing, if the branch moved meanwhile. Just run it again.
- `--backup <file.tar.gz>` saves the branch as it was. Once pushed, a removal cannot be undone otherwise.
- It never checks out the legacy root folders (old nested `history/history/...` paths exceed the Windows path limit).
- GitHub reclaims the repository space with some delay after the push.

## Applying it to a new repo

1. **Copy the files.**
   - `actions/playwright-run.yml` to `.github/workflows/playwright-run.yml`.
   - `actions/allure-archive/scripts/*` to `scripts/` (the workflow calls `scripts/publish-allure-report.sh`; keep the three together).
2. **Keep shell scripts LF.** Add `scripts/*.sh text eol=lf` to `.gitattributes` (CRLF breaks the shebang on the Linux runner).
3. **Ignore the new output folder** `allure-report-single/` in `.gitignore`, `.prettierignore` and the eslint ignores (next to `allure-report/`).
4. **Edit the workflow markers** (search for `<`): `run-name`, your project env vars, compose service name, Slack channel id and title, and in the publish step `INDEX_TITLE` and, if wanted, `KEEP_DAYS` / `KEEP_RUNS`. The header of the workflow lists everything else the repo must provide.
5. **Enable Pages:** Settings -> Pages -> Build and deployment -> Deploy from a branch -> branch `gh-pages`, folder `/ (root)`. The branch does not need to exist yet; if the setting is not selectable before the first run, run once, then set it.
6. **Branch rules:** if `gh-pages` is protected by a ruleset, it may block **deletion** but must **allow force-push** (every publish is a force-with-lease push of a new root commit). The default branch is unaffected.
7. **Workflow permissions** (already in the file): `contents: write` to push the data branch; the Pages API read uses the same `GITHUB_TOKEN`. Org policy must let `GITHUB_TOKEN` have write access.
8. **Visibility:** for a private repo the Pages site is visible only to people who can read the repo (an org setting); the links in Slack work for them.
9. **First run:** the history checkout fails and the trend starts empty (expected, a warning at most); the publish step creates `gh-pages`. Check `<site>/<environment>/<run number>/` and the landing page, then run a second time and confirm `latest/` shows a trend.
10. **Legacy content:** if `gh-pages` already holds an old flat report, remove it once with `cleanup-gh-pages.sh --legacy-root` (dry run first).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Could not publish the report ... after 5 attempts" | the push keeps being rejected: a ruleset blocks force-push on `gh-pages`, the token lacks `contents: write`, or the remote is unreachable (see the warnings above that line) |
| Slack links to the Pages root, not the run | publish failed or was skipped (report generation failed); read the "Publish report" step |
| Trend graph starts empty on every run | `<environment>/latest/history` missing: first run for that environment, or `latest/` was cleaned; also check the history checkout step did not fail for another reason |
| Landing page 404 | Pages source not set to `gh-pages` / root, or the first Pages build has not finished (check the `pages-build-deployment` run) |
| Warning "archive is N MB" | lower `KEEP_DAYS`, set `KEEP_RUNS`, or clean by hand |
| Report folder missing for a run | run number was pruned by retention, or that run failed before generation |
| `bad interpreter` / `\r` errors from a script | script committed with CRLF: add the `.gitattributes` line and re-commit LF |

## Verification status

Check the points above on the first real run in a new repo.