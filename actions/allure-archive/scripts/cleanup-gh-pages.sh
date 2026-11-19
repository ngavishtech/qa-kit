#!/usr/bin/env bash
# On-demand cleanup of the gh-pages DATA branch (the Allure report archive, see actions/allure-archive/README.md).
# Removes what you ask for, rebuilds the landing page, and pushes the result as ONE parentless
# commit (force-with-lease), exactly like publish-allure-report.sh does, so the removed files also
# leave git history. It is a DRY RUN unless you pass --apply.
#
# Usage:  scripts/cleanup-gh-pages.sh <what to remove>... [options]
#
# What to remove (combine freely, at least one is required):
#   --legacy-root          the old flat report at the branch root: assets/ data/ export/ history/ widgets/
#   --env <name>           a whole environment folder (e.g. a retired environment)
#   --run <env>/<number>   one archived run (its latest/ copy is not touched)
#   --older-than <days>    every run older than that many days, in all environments (same rule as the
#                          automatic KEEP_DAYS retention, with a different number)
#
# Options:
#   --apply                actually push; without it nothing is pushed and the plan is only printed
#   --yes                  do not ask for confirmation when running in a terminal
#   --backup <file.tar.gz> save the branch content as it is now before pushing
#   --force                skip the "a workflow run is in progress" check
#   -h, --help             show this help
#
# Environment: PAGES_BRANCH (default gh-pages), WORKFLOW_FILE (the workflow checked for running runs, default vutef-run.yml), PAGES_REMOTE_URL (default: this repo's 'origin').
# Needs git and node; the in-progress check also needs the GitHub CLI (skipped with a warning if absent).
#
# Examples:
#   scripts/cleanup-gh-pages.sh --legacy-root                     # dry run
#   scripts/cleanup-gh-pages.sh --legacy-root --backup old.tar.gz --apply
#   scripts/cleanup-gh-pages.sh --env test01 --apply
#   scripts/cleanup-gh-pages.sh --run test01/131 --apply
#   scripts/cleanup-gh-pages.sh --older-than 30 --apply
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAGES_BRANCH="${PAGES_BRANCH:-gh-pages}"
WORKFLOW_FILE="${WORKFLOW_FILE:-vutef-run.yml}"
LEGACY_ROOT_ITEMS=(assets data export history widgets)

APPLY=false
YES=false
FORCE=false
BACKUP=""
LEGACY=false
OLDER_THAN=""
ENVS=()
RUNS=()

fail() { echo "ERROR: $*" >&2; exit 1; }
usage() { sed -n '2,/^set -/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --legacy-root) LEGACY=true ;;
    --env) shift; ENVS+=("${1:?--env needs an environment name}") ;;
    --run) shift; RUNS+=("${1:?--run needs <env>/<number>}") ;;
    --older-than) shift; OLDER_THAN="${1:?--older-than needs a number of days}" ;;
    --apply) APPLY=true ;;
    --yes) YES=true ;;
    --force) FORCE=true ;;
    --backup) shift; BACKUP="${1:?--backup needs a file name}" ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; fail "Unknown argument: $1" ;;
  esac
  shift
done

NAME_RE='^[A-Za-z0-9._-]+$'
for e in ${ENVS[@]+"${ENVS[@]}"}; do
  [[ "$e" =~ $NAME_RE && ! "$e" =~ ^\.+$ ]] || fail "--env '$e' must be a plain folder name"
done
for r in ${RUNS[@]+"${RUNS[@]}"}; do
  [[ "$r" =~ ^[A-Za-z0-9._-]+/[0-9]+$ && ! "$r" =~ ^\.+/ ]] || fail "--run '$r' must look like <env>/<run number>"
done
[ -z "$OLDER_THAN" ] || [[ "$OLDER_THAN" =~ ^[1-9][0-9]*$ ]] || fail "--older-than '$OLDER_THAN' must be a positive number of days"
if ! $LEGACY && [ -z "$OLDER_THAN" ] && [ "${#ENVS[@]}" -eq 0 ] && [ "${#RUNS[@]}" -eq 0 ]; then
  usage >&2
  fail "Nothing to do: pass at least one of --legacy-root, --env, --run, --older-than"
fi

# A publish running right now would race this push; the lease would reject it, but better not to start.
if ! $FORCE; then
  if command -v gh >/dev/null 2>&1; then
    active=0
    for status in in_progress queued; do
      n="$(gh run list --workflow "$WORKFLOW_FILE" --status "$status" --json databaseId --jq length 2>/dev/null)" || n=""
      if [ -z "$n" ]; then active=-1; break; fi
      active=$((active + n))
    done
    if [ "$active" -lt 0 ]; then
      echo "WARNING: could not query GitHub for running workflows (gh not authenticated or not in the repo) - continuing; the push lease still protects the branch." >&2
    elif [ "$active" -gt 0 ]; then
      fail "$active $WORKFLOW_FILE run(s) are in progress or queued. Wait for them, or pass --force."
    fi
  else
    echo "WARNING: GitHub CLI not found - cannot check for running workflows (the push lease still protects the branch)." >&2
  fi
fi

REMOTE="${PAGES_REMOTE_URL:-$(git remote get-url origin)}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PAGES="$WORK/pages"
pages_git() { git -C "$PAGES" "$@"; }
# Sizes come from git itself (uncompressed blob bytes of a tree), so they do not depend on what is checked out.
tree_mb() { pages_git ls-tree -r -l "$1" | awk '{s += $4} END {printf "%d", s / 1048576}'; }
tree_files() { pages_git ls-tree -r "$1" | wc -l | tr -d ' '; }
# True when a root folder holds latest/ or numbered run folders, i.e. it is a real environment.
is_environment() { pages_git ls-tree --name-only "HEAD:$1" 2>/dev/null | grep -qE '^(latest|[0-9]+)$'; }

echo "Cloning '$PAGES_BRANCH' from $REMOTE ..."
git clone --quiet --no-checkout --depth 1 --single-branch --branch "$PAGES_BRANCH" "$REMOTE" "$PAGES" \
  || fail "Could not clone branch '$PAGES_BRANCH' (does it exist, and do you have access?)"
pages_git config core.autocrlf false
git -C "$PAGES" config user.name >/dev/null 2>&1 || pages_git config user.name "gh-pages cleanup"
git -C "$PAGES" config user.email >/dev/null 2>&1 || pages_git config user.email "gh-pages-cleanup@users.noreply.github.com"

# The legacy folders are never needed on disk (and the old nested history/history/... exceeds the Windows
# path limit), so check out everything except them; they are removed from the index directly below.
SKIP_ITEMS=()
for item in "${LEGACY_ROOT_ITEMS[@]}"; do
  is_environment "$item" || SKIP_ITEMS+=("$item")
done
pages_git config core.sparseCheckout true
{
  echo '/*'
  for item in ${SKIP_ITEMS[@]+"${SKIP_ITEMS[@]}"}; do echo "!/$item/"; done
} > "$PAGES/.git/info/sparse-checkout"
pages_git read-tree -m -u HEAD

TIP="$(pages_git rev-parse HEAD)"
SIZE_BEFORE="$(tree_mb "$TIP")"
FILES_BEFORE="$(tree_files "$TIP")"
DESCRIPTION=""

if $LEGACY; then
  for item in "${LEGACY_ROOT_ITEMS[@]}"; do
    pages_git ls-tree --name-only HEAD -- "$item" | grep -qx "$item" || continue
    if is_environment "$item"; then
      echo "WARNING: '$item' looks like an environment folder, not legacy data - left alone." >&2
      continue
    fi
    pages_git ls-files -- "$item" | pages_git update-index --force-remove --stdin
  done
  DESCRIPTION="$DESCRIPTION legacy-root"
fi
for e in ${ENVS[@]+"${ENVS[@]}"}; do
  [ -d "$PAGES/$e" ] || fail "Environment folder '$e' does not exist on the branch."
  rm -rf "${PAGES:?}/$e"
  DESCRIPTION="$DESCRIPTION env:$e"
done
for r in ${RUNS[@]+"${RUNS[@]}"}; do
  [ -d "$PAGES/$r" ] || fail "Run folder '$r' does not exist on the branch."
  rm -rf "${PAGES:?}/$r"
  DESCRIPTION="$DESCRIPTION run:$r"
done
if [ -n "$OLDER_THAN" ]; then
  node "$SCRIPT_DIR/allure-index.js" prune "$PAGES" "$OLDER_THAN" 0
  DESCRIPTION="$DESCRIPTION older-than:${OLDER_THAN}d"
fi

touch "$PAGES/.nojekyll"
node "$SCRIPT_DIR/allure-index.js" index "$PAGES"
pages_git add -A
TREE="$(pages_git write-tree)"
if [ "$TREE" = "$(pages_git rev-parse "$TIP^{tree}")" ]; then
  echo "Nothing to clean - the branch already matches. Nothing pushed."
  exit 0
fi

echo
echo "Would remove (top-level paths, with file counts):"
pages_git diff --cached --name-only --diff-filter=D \
  | awk -F/ '{ print (NF > 2 && ($2 ~ /^[0-9]+$/ || $2 == "latest")) ? $1 "/" $2 : $1 }' \
  | sort | uniq -c | sort -rn | head -25 | sed 's/^/  /'
echo "Files: $FILES_BEFORE -> $(tree_files "$TREE")   Size: ${SIZE_BEFORE} MB -> $(tree_mb "$TREE") MB   (index.html is regenerated)"

if ! $APPLY; then
  echo
  echo "DRY RUN - nothing was pushed. Re-run with --apply to push this as one commit to '$PAGES_BRANCH'."
  exit 0
fi

if [ -t 0 ] && ! $YES; then
  read -r -p "Push this to '$PAGES_BRANCH' as a single replacement commit? This cannot be undone. [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || { echo "Aborted - nothing pushed."; exit 1; }
fi

if [ -n "$BACKUP" ]; then
  BACKUP_ABS="$(cd "$(dirname "$BACKUP")" && pwd)/$(basename "$BACKUP")"
  git -C "$PAGES" archive --format=tar.gz -o "$BACKUP_ABS" "$TIP"
  echo "Backup of the branch as it was: $BACKUP_ABS"
fi

COMMIT="$(pages_git commit-tree "$TREE" -m "cleanup:${DESCRIPTION}")"
pages_git push -q --force-with-lease="refs/heads/$PAGES_BRANCH:$TIP" origin "$COMMIT:refs/heads/$PAGES_BRANCH" \
  || fail "Push rejected - the branch moved since it was cloned (a publish ran?). Nothing changed; just run the script again."
echo "Pushed. '$PAGES_BRANCH' is now a single commit. Check the 'pages-build-deployment' run and open the landing page; GitHub reclaims the repo space with some delay."
