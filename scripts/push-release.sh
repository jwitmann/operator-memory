#!/usr/bin/env bash
# Push a release the way Actions can hear: branch first, then one tag
# per push, so every tag-push event fires its publish workflow. A
# combined `git push --tags` does not reliably deliver tag events.
#
# OPERATOR-ONLY. Agents must never run this script: pushing the branch
# and tags is a deliberate human action. Enforcement is structural, not
# just convention: confirmation requires an interactive terminal, so
# piped/redirected stdin (how an agent would drive it) always aborts.
# There is intentionally no --yes flag.
#
# Usage:
#   ./scripts/push-release.sh [--repush] [<tag>...]
#
# With no <tag> args, pushes every local <pkg>@v* tag pointing at HEAD
# (i.e. the release just tagged). --repush deletes each tag from
# origin first: needed when a tag already reached the remote without
# firing its workflow, since re-pushing an unchanged tag fires no event.
set -euo pipefail

cd "$(dirname "$0")/.."

REPUSH=""
tags=""
for arg in "$@"; do
  case "$arg" in
    --repush) REPUSH="1" ;;
    -h | --help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    -*)
      echo "Unknown flag: $arg (see --help)." >&2
      exit 1
      ;;
    *)
      tags+="$arg "
      ;;
  esac
done

if [ -z "$tags" ]; then
  tags="$(git tag --points-at HEAD --list '*@v*')"
  if [ -z "$tags" ]; then
    echo "No release tags point at HEAD. Pass them explicitly:" >&2
    echo "  $0 [--repush] <pkg>@v<version>..." >&2
    exit 1
  fi
fi

branch="$(git symbolic-ref --quiet --short HEAD || true)"
if [ -z "$branch" ]; then
  echo "Detached HEAD: switch to the release branch first." >&2
  exit 1
fi

echo "Will push branch '$branch', then one push per tag:"
for tag in $tags; do
  if [ -n "$REPUSH" ]; then
    echo "  delete + push $tag"
  else
    echo "  push $tag"
  fi
done
if [ ! -t 0 ]; then
  echo "Refusing: run this script yourself in a terminal, not via a pipe or an agent." >&2
  exit 1
fi
printf "Proceed? [y/N] "
read -r answer
case "$answer" in
  y | Y | yes | YES) ;;
  *)
    echo "Aborted."
    exit 0
    ;;
esac

git push origin "$branch"
for tag in $tags; do
  if [ -n "$REPUSH" ]; then
    if [ -n "$(git ls-remote --tags origin "refs/tags/$tag")" ]; then
      git push --delete origin "$tag"
    fi
  fi
  git push origin "$tag"
done

echo ""
echo "Done. Verify each tag shows a publish run in the Actions tab."
