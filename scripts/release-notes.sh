#!/usr/bin/env bash
# GitHub release notes builder.
#
# Body source for tag-push releases: the version section of
# packages/<package>/CHANGELOG.md plus a Full Changelog compare link
# pinned to the previous tag of the SAME package. GitHub's
# --generate-notes picks the previous tag by creation date across all
# packages, which is wrong in this multi-package tag soup (it once
# linked helper@v1.14.0 against claude-code@v0.4.0). Bash-native, no
# dependencies, fully offline.
#
# Usage:
#   ./scripts/release-notes.sh <package>@v<version> > notes.md
#     Print the release body to stdout.
#     Missing CHANGELOG section degrades to the compare link alone;
#     missing previous same-package tag degrades to the section alone.
set -euo pipefail

cd "$(dirname "$0")/.."

REPO_URL="https://github.com/jwitmann/vcc-brain"

tag="${1:?usage: release-notes.sh <package>@v<version>}"
pkg="${tag%@v*}"
version="${tag##*@}"

section="$(awk -v v="$version" '
  /^## \[v/ { if (found) exit; found = ($0 ~ ("\\[" v "\\]")); next }
  found { print }
' "packages/$pkg/CHANGELOG.md")"

prev="$(git tag --list "$pkg@v*" | sort -V | awk -v t="$tag" '$0 == t { print last; exit } { last = $0 }')"

if [ -n "$section" ]; then
  printf '%s\n' "$section"
fi
if [ -n "${prev:-}" ]; then
  if [ -n "$section" ]; then
    printf '\n'
  fi
  printf '**Full Changelog**: %s/compare/%s...%s\n' "$REPO_URL" "$prev" "$tag"
fi
