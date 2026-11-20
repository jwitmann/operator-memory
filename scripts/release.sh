#!/usr/bin/env bash
# Change-detected multi-package release.
#
# Releases ONLY packages with changes since their last tag — untouched
# packages keep their version (no lockstep bumps). A `packages/core`
# change cascades to its consumers (opencode-v2, deepseek, pi, helper),
# since the built dists bundle core. Legacy V1 (`packages/opencode`)
# is excluded: frozen, unpublished, cannot ship.
#
# Usage:
#   ./scripts/release.sh [patch|minor|major|X.Y.Z] [--dry-run]
#
# What it does (unless --dry-run, which stops before step 4):
#   1. Aborts on a dirty tree (tracked modifications; untracked files
#      are ignored) and runs the full validation suite.
#   2. Computes the release set: per-package diff since last tag,
#      plus the core cascade. Root-only changes (docs/, scripts/,
#      .github/, lockfile) release nothing.
#   3. Guards against republishing an already-published version.
#   4. Bumps each version, prepends its CHANGELOG section (with a
#      cascade note when core alone forced the release), commits once,
#      and tags per package — but does NOT push.
set -euo pipefail

cd "$(dirname "$0")/.."

# Version resolution (X.Y.Z arithmetic, no dependencies).
bump_version() {
  local current="$1" requested="$2"
  case "$current" in
    *[!0-9.]* | '' | *.*.*.* | .* | *.) echo "Current package version must be in X.Y.Z format." >&2; return 1 ;;
  esac
  local old_ifs="$IFS" major minor patch
  IFS=.
  # shellcheck disable=SC2086
  set -- $current
  IFS="$old_ifs"
  [ "$#" -eq 3 ] && [ -n "$1" ] && [ -n "$2" ] && [ -n "$3" ] || { echo "Current package version must be in X.Y.Z format." >&2; return 1; }
  major=$1; minor=$2; patch=$3
  case "$requested" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
    *)
      local version="${requested#v}"
      case "$version" in
        *[!0-9.]* | '' | *.*.*.* | .* | *.) echo "Version must be major, minor, patch, or X.Y.Z." >&2; return 1 ;;
      esac
      local oifs="$IFS"
      IFS=.
      # shellcheck disable=SC2086
      set -- $version
      IFS="$oifs"
      [ "$#" -eq 3 ] && [ -n "$1" ] && [ -n "$2" ] && [ -n "$3" ] || { echo "Version must be major, minor, patch, or X.Y.Z." >&2; return 1; }
      echo "$version"
      ;;
  esac
}

DRY_RUN=""
BUMP="patch"
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="1" ;;
    major | minor | patch) BUMP="$arg" ;;
    *) BUMP="$arg" ;;
  esac
done

case "$BUMP" in
  major | minor | patch) ;;
  *)
    if ! bump_version "0.0.0" "$BUMP" >/dev/null 2>&1; then
      echo "Usage: $0 [patch|minor|major|X.Y.Z] [--dry-run]" >&2
      exit 1
    fi
    ;;
esac

PACKAGES="helper opencode-v2 pi codex deepseek claude-code"
CONSUMERS="opencode-v2 deepseek pi helper"

echo "==> Checking tree..."
if [ -n "$(git status --porcelain | grep -v '^??' || true)" ]; then
  echo "Refusing: tracked modifications present. Commit or stash first." >&2
  exit 1
fi

if [ -z "$DRY_RUN" ]; then
  echo "==> Running validation..."
  bun run check
  # Validation auto-formats (check.sh runs format --write on failure),
  # which can dirty the tree after the guard above. Refuse rather than
  # release a tree the release commit would not contain.
  if [ -n "$(git status --porcelain | grep -v '^??' || true)" ]; then
    echo "Validation left tracked modifications (formatter?). Review them, commit or stash, then re-run." >&2
    exit 1
  fi
else
  echo "==> Dry run: skipping validation."
fi

last_tag() {
  git tag --sort=-v:refname | grep -E "^$1@" | head -n 1 || true
}

pkg_version() {
  node -p "require('./packages/$1/package.json').version"
}

pkg_name() {
  node -p "require('./packages/$1/package.json').name"
}

echo ""
echo "==> Computing release set..."

# Core is never versioned itself, but the built dists bundle it: a core
# change newer than a consumer's last release forces that consumer to
# ship it. The window is per consumer (each package's own unpublished
# range) — never a shared anchor, which mis-orders across independent
# version lines.
releases=""
for pkg in $PACKAGES; do
  tag="$(last_tag "$pkg")"
  own=""
  if [ -z "$tag" ]; then
    own="bootstrap (no prior tag)"
  elif [ -n "$(git log --format=%H -1 "${tag}..HEAD" -- "packages/${pkg}" || true)" ]; then
    own="changed since ${tag}"
  fi
  cascade=""
  case " $CONSUMERS " in
    *" $pkg "*)
      core_newer=""
      if [ -z "$tag" ]; then
        core_newer="1"
      elif [ -n "$(git log --format=%H -1 "${tag}..HEAD" -- packages/core || true)" ]; then
        core_newer="1"
      fi
      [ -n "$core_newer" ] && [ -z "$own" ] && cascade="core cascade"
      [ -n "$core_newer" ] && [ -n "$own" ] && cascade="core cascade (also changed)"
      ;;
  esac
  if [ -n "$own" ] || [ -n "$cascade" ]; then
    reason="${own:-$cascade}"
    releases+="${pkg} ${tag:-none} ${reason};"
    echo "  ${pkg}: ${reason}"
  fi
done

if [ -z "$releases" ]; then
  echo "Nothing to release (no package changes since last tags; root-only changes release nothing)."
  exit 0
fi

if [ -n "$DRY_RUN" ]; then
  echo ""
  echo "Dry run: would bump, changelog, commit, and tag the packages above. Stopping."
  exit 0
fi

echo ""
tags=""
summary=""
# Split records on ';' only (reasons contain spaces). The inner parse
# below uses expansion precisely so this IFS never leaks into it.
OLD_IFS="$IFS"
IFS=';'
for item in $releases; do
  [ -z "$item" ] && continue
  # Parse with expansion, not word splitting: no IFS games, "$@" untouched.
  pkg="${item%% *}"
  rest="${item#* }"
  prev="${rest%% *}"
  current="$(pkg_version "$pkg")"
  name="$(pkg_name "$pkg")"
  version="$(bump_version "$current" "$BUMP")"
  if [ "$(npm view "${name}@${version}" version 2>/dev/null || true)" = "$version" ]; then
    echo "Package version already exists on npm: ${name}@${version}" >&2
    exit 1
  fi
  echo "==> ${pkg}: ${current} -> ${version}"
  npm version "$version" --no-git-tag-version --workspaces=false --prefix "packages/${pkg}" >/dev/null
  note=""
  case "$item" in
    *"core cascade"* )
      case "$item" in
        *"also changed"*) ;;
        *) note="Includes shared core updates (packages/core)." ;;
      esac
      ;;
  esac
  if [ "$prev" = "none" ]; then
    ./scripts/changelog.sh "$pkg" "$(git rev-list --max-parents=0 HEAD)" "$version" "" "$note"
  else
    ./scripts/changelog.sh "$pkg" "$prev" "$version" "" "$note"
  fi
  tags+="${pkg}@v${version} "
  summary+="${pkg}: ${version}, "
done
IFS="$OLD_IFS"

echo ""
echo "==> Committing and tagging..."
git add packages/*/package.json packages/*/CHANGELOG.md
git commit -m "Release ${summary%, }"
for tag in $tags; do
  git tag -a "$tag" -m "Release $tag"
done

echo ""
echo "Done. To publish, push the branch and tags (never pushed automatically):"
echo "  git push origin HEAD --tags"
echo ""
echo "CI will publish each tagged package to npm automatically."
