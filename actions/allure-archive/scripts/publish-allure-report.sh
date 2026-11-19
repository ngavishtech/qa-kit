#!/usr/bin/env bash
# Publishes a generated Allure report into the gh-pages DATA branch, one permanent folder per run:
#
#   index.html                    landing page: every archived run (generated)
#   <environment>/latest/         newest report; source of the Allure trend history
#   <environment>/<run number>/   one folder per run, never overwritten (pruned beyond KEEP_RUNS)
#
# gh-pages holds data only - this script, the workflow and the docs live on main. If the branch
# is missing (e.g. deleted by mistake) it is recreated as an orphan branch on the next run.
#
# Every attempt starts from the remote tip and re-applies the change (instead of rebasing), so two
# environments finishing together never conflict on index.html; a rejected push is simply retried.
#
# Retention: run folders older than KEEP_DAYS are removed from ALL environments on every publish (an
# environment with nothing left disappears, latest/ included). The branch history is data nobody needs,
# so every publish pushes ONE parentless commit holding the current tree (force-with-lease, pinned to the
# tip it started from) - otherwise git would keep every pruned report forever and the branch would only grow.
#
# Inputs (environment variables):
#   REPORT_DIR       generated Allure report folder (required)
#   PAGES_DIR        checkout of the gh-pages branch; created/initialised if absent (required)
#   REPORT_SUBDIR    environment name used as the top-level folder (required)
#   RUN_ID           run number, the per-run folder name (required, digits)
#   KEEP_DAYS        remove run folders older than this many days, 0 = no age limit (default 60)
#   KEEP_RUNS        optional hard cap of newest runs per environment, 0 = no cap   (default 0)
#   MAX_SITE_MB      warn when the published tree exceeds this size (Pages limit is 1 GB) (default 800)
#   PAGES_BRANCH     data branch                                          (default gh-pages)
#   PAGES_BASE_URL   Pages site root, used to emit report_url/index_url   (optional)
#   MAX_ATTEMPTS     publish attempts before failing                      (default 5)
#   RETRY_DELAY      seconds between attempts                             (default random 2-6)
#   PAGES_REMOTE_URL remote to use when PAGES_DIR is not already a checkout (default: GitHub repo)
#   GITHUB_TOKEN     token for the remote, only used when this script sets the remote up itself
#   INDEX_TITLE      heading of the landing page (default E2E)
#   SUMMARY_*        run metadata written to run-summary.json (see scripts/allure-index.js)
#
# Outputs (GITHUB_OUTPUT, or stdout when run locally): report_url, latest_url, index_url
set -euo pipefail

: "${REPORT_DIR:?REPORT_DIR is required}"
: "${PAGES_DIR:?PAGES_DIR is required}"
: "${REPORT_SUBDIR:?REPORT_SUBDIR is required}"
: "${RUN_ID:?RUN_ID is required}"
PAGES_BRANCH="${PAGES_BRANCH:-gh-pages}"
KEEP_DAYS="${KEEP_DAYS:-60}"
KEEP_RUNS="${KEEP_RUNS:-0}"
MAX_SITE_MB="${MAX_SITE_MB:-800}"
TIP_SHA=""
MAX_ATTEMPTS="${MAX_ATTEMPTS:-5}"
PAGES_BASE_URL="${PAGES_BASE_URL:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() { echo "::error::$*" >&2; exit 1; }

[[ "$REPORT_SUBDIR" =~ ^[A-Za-z0-9._-]+$ && "$REPORT_SUBDIR" != "latest" && ! "$REPORT_SUBDIR" =~ ^\.+$ ]] \
  || fail "REPORT_SUBDIR '$REPORT_SUBDIR' must be a plain folder name (letters, digits, . _ -), not 'latest'"
[[ "$RUN_ID" =~ ^[0-9]+$ ]] || fail "RUN_ID '$RUN_ID' must be a number"
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || fail "KEEP_DAYS '$KEEP_DAYS' must be a number (0 = no age limit)"
[[ "$KEEP_RUNS" =~ ^[0-9]+$ ]] || fail "KEEP_RUNS '$KEEP_RUNS' must be a number (0 = no cap)"
[[ "$MAX_SITE_MB" =~ ^[0-9]+$ ]] || fail "MAX_SITE_MB '$MAX_SITE_MB' must be a number"
[ -f "$REPORT_DIR/index.html" ] || fail "No Allure report to publish: $REPORT_DIR/index.html not found"

REPORT_DIR="$(cd "$REPORT_DIR" && pwd)"
mkdir -p "$PAGES_DIR"
PAGES_DIR="$(cd "$PAGES_DIR" && pwd)"

pages_git() { git -C "$PAGES_DIR" "$@"; }

setup_repo() {
  [ -d "$PAGES_DIR/.git" ] || git init -q "$PAGES_DIR"
  if ! pages_git remote get-url origin >/dev/null 2>&1; then
    local server="${GITHUB_SERVER_URL:-https://github.com}"
    pages_git remote add origin "${PAGES_REMOTE_URL:-$server/${GITHUB_REPOSITORY:?GITHUB_REPOSITORY or PAGES_REMOTE_URL is required}.git}"
    if [ -n "${GITHUB_TOKEN:-}" ]; then
      local auth
      auth="$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')"
      [ "${GITHUB_ACTIONS:-}" = "true" ] && echo "::add-mask::$auth"
      pages_git config "http.$server/.extraheader" "AUTHORIZATION: basic $auth"
    fi
  fi
  pages_git config core.autocrlf false
  pages_git config user.name "github-actions[bot]"
  pages_git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
}

# Make the working tree match the remote branch tip, or start an empty orphan branch if it does not exist.
sync_to_remote() {
  local rc=0
  TIP_SHA=""
  pages_git ls-remote --exit-code --heads origin "$PAGES_BRANCH" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then
    pages_git fetch -q --depth=1 origin "$PAGES_BRANCH" || return 1
    pages_git checkout -q -f -B "$PAGES_BRANCH" FETCH_HEAD || return 1
    TIP_SHA="$(pages_git rev-parse FETCH_HEAD)" || return 1
  elif [ "$rc" -eq 2 ]; then
    echo "Branch '$PAGES_BRANCH' does not exist on the remote - creating it."
    pages_git symbolic-ref HEAD "refs/heads/$PAGES_BRANCH" || return 1
    pages_git read-tree --empty || return 1
  else
    echo "::warning::Could not reach the remote (git ls-remote exit $rc)"
    return 1
  fi
  pages_git clean -fdxq
}

prune_old_runs() {
  node "$SCRIPT_DIR/allure-index.js" prune "$PAGES_DIR" "$KEEP_DAYS" "$KEEP_RUNS" || return 1
  local size_mb
  size_mb="$(du -sm --exclude=.git "$PAGES_DIR" | cut -f1)"
  if [ "$size_mb" -gt "$MAX_SITE_MB" ]; then
    echo "::warning::The report archive is ${size_mb} MB (warning threshold ${MAX_SITE_MB} MB; GitHub Pages sites are limited to about 1 GB). Lower KEEP_DAYS or set KEEP_RUNS."
  fi
}

apply_report() {
  local run_dir="$PAGES_DIR/$REPORT_SUBDIR/$RUN_ID" latest_dir="$PAGES_DIR/$REPORT_SUBDIR/latest"
  rm -rf "$run_dir" "$latest_dir"
  mkdir -p "$run_dir" "$latest_dir"
  cp -a "$REPORT_DIR/." "$run_dir/" || return 1
  SUMMARY_ENVIRONMENT="$REPORT_SUBDIR" SUMMARY_RUN="$RUN_ID" \
    node "$SCRIPT_DIR/allure-index.js" summary "$run_dir/run-summary.json" || return 1
  cp -a "$run_dir/." "$latest_dir/" || return 1
  prune_old_runs || return 1
  touch "$PAGES_DIR/.nojekyll"
  node "$SCRIPT_DIR/allure-index.js" index "$PAGES_DIR"
}

publish_attempt() {
  sync_to_remote || return 1
  apply_report || return 1
  pages_git add -A || return 1
  local tree commit
  tree="$(pages_git write-tree)" || return 1
  if [ -n "$TIP_SHA" ] && [ "$tree" = "$(pages_git rev-parse "$TIP_SHA^{tree}")" ]; then
    echo "Nothing changed - already published."
    return 0
  fi
  # One parentless commit with the whole current tree; the lease makes the push fail (and the attempt
  # retry from the new tip) if another run moved the branch since we fetched it. An empty expected
  # value means "the branch must not exist yet" (bootstrap).
  commit="$(pages_git commit-tree "$tree" -m "report: $REPORT_SUBDIR #$RUN_ID")" || return 1
  pages_git push -q --force-with-lease="refs/heads/$PAGES_BRANCH:$TIP_SHA" origin "$commit:refs/heads/$PAGES_BRANCH"
}

setup_repo

attempt=1
until publish_attempt; do
  [ "$attempt" -lt "$MAX_ATTEMPTS" ] || fail "Could not publish the report to '$PAGES_BRANCH' after $MAX_ATTEMPTS attempts"
  echo "::warning::Publish attempt $attempt/$MAX_ATTEMPTS failed (push rejected or remote unreachable) - retrying"
  sleep "${RETRY_DELAY:-$((RANDOM % 5 + 2))}"
  attempt=$((attempt + 1))
done

base="${PAGES_BASE_URL%/}"
outputs="report_url=$base/$REPORT_SUBDIR/$RUN_ID/
latest_url=$base/$REPORT_SUBDIR/latest/
index_url=$base/"
[ -n "$base" ] || outputs="report_url=
latest_url=
index_url="
echo "$outputs" >> "${GITHUB_OUTPUT:-/dev/stdout}"
echo "Published $REPORT_SUBDIR #$RUN_ID to '$PAGES_BRANCH'."
