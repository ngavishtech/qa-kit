# CI building blocks (GitHub Actions)

Reusable GitHub **composite actions** so every test repo runs, reports and notifies the same way instead of copy-pasting a long workflow. They are independent of the coding agent: no model calls, no Claude Code or OpenCode involved. The plugin and the OpenCode install ignore this folder. Versions are git tags (`v1`, ...).

| Path | What it does |
|---|---|
| `actions/playwright-docker-run/` | Checkout, Ruby/Node/AWS/ECR setup, filters to `PLAYWRIGHT_ARGUMENTS`, image build, test run through docker compose, "0 tests matched" guard. |
| `actions/allure-report/` | Generate an Allure report from `allure-results`, expose pass/fail counts as outputs, publish to GitHub Pages with history, upload artifacts. |
| `actions/slack-notify/` | Post a run summary (status colour, environment, counts, report and run links) to a Slack channel. |
| `templates/github/run-tests.yml` | The reference workflow a consuming repo copies. |
| `actions/playwright-run.yml` | Standalone copy-paste workflow (no composite actions): the full Playwright run inline. Replace the `<REPLACE ...>` / `<ADD ...>` markers; the required repo files, secrets and variables are listed in its header. Not wired into `init`. |
| `actions/allure-archive/` | Docs and scripts for the per-run Allure archive on a `gh-pages` data branch that `playwright-run.yml` uses: layout, retention, cleanup, how to apply it to a new repo. |

Use all three through the template for a complete run, or any one on its own (for example only `slack-notify` from a different pipeline).

This repo has workflow of its own in `.github/workflows/`: `ci.yml` (runs `node --test`). Doesn't run the actions here. A reusable *workflow* would have to live in `.github/workflows/`, so none is shipped; the template is the reference for chaining the actions.

## One-time setup (admin)

1. Callers write the path `ngavishtech/qa-kit/actions/<name>@v1` in their own workflow. The template already has it; if the repo is ever moved or renamed, update the three `uses:` lines in `templates/github/run-tests.yml`.
2. Publish a version: `git tag v1 && git push origin v1`. Do this only after a successful real run (see "Versioning").
3. Allow other repos to use it: **Settings -> Actions -> General -> Access -> "Accessible from repositories in the organization"**.
4. Put the shared credentials at **organization** level (Settings -> Secrets and variables -> Actions) and share them with the repos that need them:
   - secrets: `ARTIFACTORY_SECRET`, `ARTIFACTORY_USER`, `ARTIFACTORY_NPM_TOKEN`, `ECR_AWS_ACCESS_KEY`, `ECR_AWS_SECRET_ACCESS_KEY`, `ECR_PULL_AWS_ROLE_TO_ASSUME`, `ECR_PULL_AWS_ROLE_EXTERNAL_ID`, `ECR_PULL_AWS_REGION`, `ALERT_BOT_TOKEN`
   - variable: `DEFAULT_LINUX_RUNNER_LABEL`

## Using it from a test repo

1. **Prerequisites in the test repo:**
   - `docker-compose.ci.yml` and `docker-compose.e2e.yml`, with a service that runs the tests
   - `Gemfile.CI` and `Rakefile.CI` (image build)
   - `allure-commandline` as a dev dependency
   - `engines.node` in `package.json` (the Node version is read from it)
   - GitHub Pages enabled on the `gh-pages` branch (Settings -> Pages)
   - optional: `scripts/build-test-grep.js`, which turns the filter inputs into Playwright arguments (skipped when absent; needs a `typescript` devDependency)
2. **Add the workflow.** Once the `v1` tag exists, `/qa-kit:init` offers to copy `templates/github/run-tests.yml` (it skips the CI step before that and says so in its report). Or copy it to `.github/workflows/run-tests.yml` yourself. Change exactly two things: `COMPOSE_SERVICE_NAME` (the docker compose service) and `SLACK_CHANNEL_ID` (a channel ID such as `C0123456789`, not a name). Adjust the `environment` options and the cron time if needed.
3. **Set repo variables:** `TARGET_ENVIRONMENT_URL` (repo level, or per GitHub environment), and optionally `NIGHTLY_TEST_TYPE`, `NIGHTLY_TEST_LEVEL`, `NIGHTLY_TEST_PRIORITY`, `NIGHTLY_TEST_FEATURE`, `NIGHTLY_TEST_EXTRA` to scope the nightly run (unset = full suite).
4. **Commit to the default branch.** Scheduled and manual runs always use the default branch's copy of the workflow.
5. **Run it:** Actions -> E2E Run -> Run workflow, pick the environment and optional filters. It also runs on the nightly schedule.

What happens, in order: clean workspace and checkout, Ruby/AWS/ECR login, filters become `PLAYWRIGHT_ARGUMENTS`, image built, tests run in docker compose (a failing suite does not stop the job), a guard fails the job if the filters selected nothing, Allure report generated and published to Pages with history, artifacts uploaded, Slack message posted.

What you get: the Allure report at `https://<owner>.github.io/<repo>`, `allure-results-<date>` and `playwright-report-<date>` artifacts (30 days), and a Slack message with status, environment, report and run links, and the result counts.

Callers must pass secrets in as inputs; composite actions cannot read secrets. `runs-on`, `environment` and `timeout-minutes` stay on the calling job.

Using one action on its own, after your own test step in any pipeline:

```yaml
      - name: Run my tests
        id: tests
        run: npm run test:smoke
        continue-on-error: true

      - name: Tell the team
        if: always()
        uses: ngavishtech/qa-kit/actions/slack-notify@v1
        with:
          token: ${{ secrets.ALERT_BOT_TOKEN }}
          channel: C0123456789
          status: ${{ steps.tests.outcome }}
          environment: staging
```

## Reference

### `playwright-docker-run`

Only `compose-service` is required.

| Input | Default | Meaning |
|---|---|---|
| `compose-service` | required | docker compose service that runs the tests |
| `compose-files` | `-f docker-compose.ci.yml -f docker-compose.e2e.yml` | compose file flags, passed as-is |
| `container-results-path` | `/test/allure-results` | path inside the container where Allure results are written |
| `build-command` | `bundle exec rake -f Rakefile.CI package` | image build command |
| `checkout` | `true` | `false` if the calling job already checked out the repo |
| `playwright-arguments` | `''` | raw arguments exported as `PLAYWRIGHT_ARGUMENTS`; replaced by the filter script's output when that script exists |
| `grep-script` | `scripts/build-test-grep.js` | filter script; skipped if the file does not exist |
| `test-type` | `''` | comma-separated Test Type filter (blank = no filter) |
| `test-level` | `''` | comma-separated Test Level filter |
| `test-priority` | `''` | comma-separated Test Priority filter |
| `test-feature` | `''` | comma-separated Test Feature filter |
| `test-extra` | `''` | spec path or raw `--grep` expression, passed to the filter script |
| `environment-name` | `''` | exported as `TARGET_ENVIRONMENT_NAME` |
| `environment-url` | `''` | exported as `TARGET_ENVIRONMENT_URL` |
| `ruby-version` | `3.0` | Ruby version for the image build tooling |
| `bundle-gemfile` | `Gemfile.CI` | Gemfile used by bundler (exported as `BUNDLE_GEMFILE`) |
| `fail-on-test-failure` | `false` | `true` fails the action when tests fail; the default keeps the job going and reports through Allure and Slack |
| `artifactory-secret` | `''` | exported as `ARTIFACTORY_SECRET` |
| `artifactory-user` | `''` | exported as `ARTIFACTORY_USER` |
| `artifactory-npm-token` | `''` | exported as `ARTIFACTORY_NPM_TOKEN` |
| `aws-access-key-id` | `''` | AWS access key for ECR |
| `aws-secret-access-key` | `''` | AWS secret key for ECR |
| `aws-role-to-assume` | `''` | AWS role to assume for ECR pulls |
| `aws-role-external-id` | `''` | external ID of the AWS role |
| `aws-region` | `''` | AWS region of the ECR registry |

| Output | Meaning |
|---|---|
| `test-outcome` | outcome of the test step: `success` or `failure` |

The action also exports `CI_BUILD_NUMBER` (the run number) for later steps. Empty inputs are not exported, so values the job already set are left alone.

### `allure-report`

All inputs are optional; `github-token` is needed when `publish` is `true`.

| Input | Default | Meaning |
|---|---|---|
| `results-dir` | `allure-results` | folder with the Allure results |
| `report-dir` | `allure-report` | folder the HTML report is written to |
| `playwright-report-dir` | `playwright-report` | Playwright HTML report folder to upload (skipped if absent) |
| `publish` | `true` | `true` publishes to the Pages branch and keeps run history |
| `pages-branch` | `gh-pages` | branch GitHub Pages serves from |
| `github-token` | `''` | token used to push to the Pages branch |
| `java-version` | `17` | Java version for the Allure CLI |
| `upload-artifacts` | `true` | `true` uploads the Allure results and the Playwright report |
| `retention-days` | `30` | artifact retention |

| Output | Meaning |
|---|---|
| `total` | total tests (`N/A` if no report could be produced) |
| `passed`, `failed`, `broken`, `skipped` | counts per status |
| `success-rate` | pass rate, for example `97%` |
| `report-url` | Pages URL of the published report (empty unless `publish` is `true`) |

### `slack-notify`

Posts with `chat.postMessage` through `slackapi/slack-github-action`. No outputs.

| Input | Required | Default | Meaning |
|---|---|---|---|
| `token` | yes | | Slack bot token; pass a secret |
| `channel` | yes | | channel ID (for example `C0123456789`), not the name |
| `status` | yes | | outcome of the test step; `success` renders green, anything else red |
| `title` | no | `Playwright test run` | headline; avoid double quotes (it is embedded in a YAML payload) |
| `environment` | no | `n/a` | environment that was tested |
| `total`, `passed`, `failed`, `broken`, `skipped`, `success-rate` | no | `N/A` | result counts, usually from `allure-report` outputs |
| `report-url` | no | `''` | link to the report; empty shows "No report published" |

## Versioning

Callers pin `@v1`, never `@main`. Tag only after a successful real run. For a compatible change, commit, then move the tag: `git tag -f v1 && git push -f origin v1` (every caller picks it up on its next run). For a breaking change, release `v2` and let repos migrate when ready. Plugin releases are unrelated (they use `version` in `plugin.json`); they are tagged with the plain version (`0.2.0`), which never collides with the `v1`-style action tags.

## Migrating an existing workflow

Keep your `on:` block, `concurrency`, `permissions` and dispatch inputs; replace the steps under `jobs:` with the three `uses:` steps from the template. Map hard-coded values to inputs (compose service to `compose-service`, Slack channel and text to `channel` and `title`). Run it once against a non-production environment and compare the Allure report, Pages deploy, artifacts and Slack message with the previous run before deleting the old job.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Unable to resolve action ... actions/...` | wrong path or tag (is it `ngavishtech/qa-kit/actions/...@v1`? is the tag pushed?), or the Access setting in "One-time setup" is off |
| `Can't find 'action.yml'` | the tag points at a commit without the `actions/` folder |
| Pages step fails with a permissions error | the calling workflow's `permissions:` block is missing or narrower than the template's |
| ECR or Artifactory steps fail with empty credentials | the secret is not passed as an input, or is not set at org level or shared with this repo |
| Job fails with "0 tests matched the selected filters" | the filters selected nothing; fix the dispatch inputs or the `NIGHTLY_*` variables |
| Runner never starts | `DEFAULT_LINUX_RUNNER_LABEL` is not visible to this repo |
| Slack message has no report link | the report was not published (`publish: false`, or the Pages deploy failed) |

## TODO: running only the tests a change affects

Not built yet. `feature-select` (see "Change-driven testing" in the main README) writes `qa-kit-artifacts/changes/selection.json` and `selection.args`; connecting them to these actions is open until the CI system and template are decided (GitHub Actions or Jenkins). What is missing here:

- `playwright-docker-run` has no changed-files or selection input: it builds its arguments from the tag filters (`scripts/build-test-grep.js`, owned by the consumer) or `playwright-arguments`. A selection (`--project=... <spec files>`) would be passed as `playwright-arguments` or a new input.
- Its "0 tests matched the selected filters" guard fails the job, so a `none` selection ("no scope identified": nothing changed, or only documentation) needs an explicit skip path (do not call the action at all), and a `full` selection means no filter.
- The checkout needs history: `fetch-depth: 0`. A shallow clone is blocked by the analysis, not guessed.
- A pull-request-triggered caller workflow (`templates/github/run-tests.yml` only has `schedule` and `workflow_dispatch`) with a step that runs the runner, with enough checkout history (`fetch-depth`) and `GH_TOKEN` for `gh`.
- A step that reads `handoff.json` and starts `feature-implement` on its plans, with `--commit`, `--push` or `--pr` passed explicitly.
- Rule for any consumer: a non-zero exit, a blocked entry or a missing `selection.json` means run the full suite.

## Checking changes in this repo

`ci.yml` runs `node --test` on pull requests. The actions themselves are not executed here. Before tagging, run `actionlint` against `actions/*/action.yml` and `templates/github/run-tests.yml` if you have it installed, and do one real run from a test repo. The checks to confirm on that first run are in the README's pilot checklist.
