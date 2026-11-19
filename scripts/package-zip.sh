#!/usr/bin/env bash
# Builds qa-kit-<version>.zip for the Claude desktop app (Customize > Plugins > Add > Upload plugin,
# or Organization settings > Plugins & skills > Add > Upload a plugin). Runs the tests and the plugin
# validation first.
#
# The ZIP is created with `git archive`, so it holds only tracked content minus the paths marked
# `export-ignore` in .gitattributes (actions, tests, this script, dotfiles).
#   default     the COMMITTED files at HEAD; refuses to run on a dirty tree. Use for releases.
#   --snapshot  the current working tree (new files included, ignored files excluded), taken through
#               a temporary index: nothing is staged or committed. Use to try a build before committing.
#   --out DIR   output folder (default: dist)
#
# Usage:  bash scripts/package-zip.sh [--snapshot] [--out DIR]
set -euo pipefail

cd "$(dirname "$0")/.."

SNAPSHOT=0
OUT_DIR=dist
while [ $# -gt 0 ]; do
  case "$1" in
    --snapshot) SNAPSHOT=1 ;;
    --out) OUT_DIR="${2:?--out needs a folder}"; shift ;;
    *) echo "usage: bash scripts/package-zip.sh [--snapshot] [--out DIR]" >&2; exit 1 ;;
  esac
  shift
done

MANIFEST=".claude-plugin/plugin.json"
[ -f "$MANIFEST" ] || { echo "error: $MANIFEST not found - run from the plugin repo" >&2; exit 1; }

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" | head -n 1)"
[ -n "$VERSION" ] || { echo "error: no \"version\" in $MANIFEST - set one so uploads can be told apart" >&2; exit 1; }

if [ "$SNAPSHOT" = 1 ]; then
  TMP_INDEX="$(mktemp -u)"
  trap 'rm -f "$TMP_INDEX"' EXIT
  GIT_INDEX_FILE="$TMP_INDEX" git add -A
  REF="$(GIT_INDEX_FILE="$TMP_INDEX" git write-tree)"
  SOURCE="working tree snapshot on top of $(git rev-parse --short HEAD) (uncommitted - not for release)"
else
  if [ -n "$(git status --porcelain)" ]; then
    echo "error: uncommitted changes - commit (or stash) them first, or use --snapshot to try a build" >&2
    exit 1
  fi
  REF=HEAD
  SOURCE="commit $(git rev-parse --short HEAD)"
fi

echo "Running tests..."
node --test

if command -v claude >/dev/null 2>&1; then
  echo "Validating plugin..."
  claude plugin validate . --strict
else
  echo "warning: 'claude' CLI not found - skipping plugin validation" >&2
fi

if ! git ls-tree -r "$REF" --name-only | grep -qx "$MANIFEST"; then
  echo "error: $MANIFEST is not in the archive source ($SOURCE)" >&2
  exit 1
fi
if git ls-tree -r "$REF" --name-only | grep -qE '^bin/'; then
  echo "error: a top-level bin/ folder makes claude.ai and Cowork reject the whole plugin" >&2
  exit 1
fi

OUT="${OUT_DIR}/qa-kit-${VERSION}.zip"
mkdir -p "$OUT_DIR"
git archive --format=zip -o "$OUT" "$REF"

echo "Built $OUT ($(wc -c < "$OUT") bytes) from $SOURCE"
echo "Files in the ZIP: $(git archive --format=tar "$REF" | tar -tf - | grep -vc '/$')"
echo "Upload it in the Claude desktop app, and bump \"version\" in $MANIFEST before the next build."
