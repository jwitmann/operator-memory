#!/usr/bin/env bash
# Per-package changelog generator.
#
# Record of what shipped, per package: packages/<name>/CHANGELOG.md
# ships in the repo (and the npm tarball) as the human-readable history.
# Tag-push CI creates the GitHub release with generated notes; this file
# is the durable record, not the release body. Bash-native, no
# dependencies, fully offline.
#
# Adapted from the single-package flow (opencode-dev-framework,
# opencode-vcc-port): same buckets and header shape, plus a package path
# filter and an optional cascade note for core-driven releases.
#
# Usage:
#   ./scripts/changelog.sh <package> <prev-ref> <version> [date] [note]
#     Prepend packages/<package>/CHANGELOG.md section for <version>
#     covering <prev-ref>..HEAD filtered to packages/<package>/.
#     Release commits ("Release ...") are excluded; the release commit
#     itself is created after generation, so it never appears.
#     [note] (optional) is appended under Other, e.g. to record that a
#     core change forced this package's release.
#   ./scripts/changelog.sh --backfill <package>
#     Rewrite packages/<package>/CHANGELOG.md from scratch for every
#     <package>@* tag (newest first), using each tag's date. Idempotent.
set -euo pipefail

cd "$(dirname "$0")/.."

REPO_URL="https://github.com/jwitmann/operator-memory"
CHANGELOG_NOTE="${5:-}"

section_for() {
  local package="$1" prev="$2" range_end="$3" version="$4" date="$5"
  local feats="" fixes="" docs="" other=""

  while IFS= read -r line; do
    local hash="${line%% *}"
    local subject="${line#* }"
    # Some historical subjects embed literal \n sequences — keep the head.
    subject="${subject%%\\n*}"
    case "$subject" in
      Release\ *) continue ;;
    esac
    local type="${subject%%:*}"
    # Strip scopes: feat(core): x buckets under Features, not Other.
    type="${type%%(*}"
    local rest="${subject#*: }"
    [ "$rest" = "$subject" ] && rest="$subject"
    local entry="- ${rest} ([\`${hash:0:7}\`](${REPO_URL}/commit/${hash}))"
    case "$type" in
      feat) feats+="${entry}"$'\n' ;;
      fix) fixes+="${entry}"$'\n' ;;
      docs) docs+="${entry}"$'\n' ;;
      *) other+="${entry}"$'\n' ;;
    esac
  done < <(git log --reverse --format='%H %s' "${prev}..${range_end}" -- "packages/${package}")

  if [ -n "$CHANGELOG_NOTE" ]; then
    other+="- ${CHANGELOG_NOTE}"$'\n'
  fi

  {
    echo "## [${version}] - ${date}"
    echo ""
    if [ -n "$feats" ]; then echo "### Features"; echo ""; printf '%s' "$feats"; echo ""; fi
    if [ -n "$fixes" ]; then echo "### Fixes"; echo ""; printf '%s' "$fixes"; echo ""; fi
    if [ -n "$docs" ]; then echo "### Documentation"; echo ""; printf '%s' "$docs"; echo ""; fi
    if [ -n "$other" ]; then echo "### Other"; echo ""; printf '%s' "$other"; echo ""; fi
  }
}

write_header() {
  local package="$1"
  {
    echo "# Changelog"
    echo ""
    echo "<!-- markdownlint-disable MD024 --><!-- repeated bucket headings -->"
    echo ""
    echo "Generated from conventional commits (\`scripts/changelog.sh\`)."
    echo "Human-readable record of what shipped, per package."
    echo ""
  }
}

# Collapse accidental blank runs (buckets, section joints) and strip
# trailing blank lines — generated file only, no fenced blocks to protect.
normalize() {
  awk 'BEGIN{blanks=0} /^$/{blanks++; if (blanks<=1) print; next} {blanks=0; print}' "$1" > "$1.tmp"
  printf '%s\n' "$(cat "$1.tmp")" > "$1"
  rm -f "$1.tmp"
}

if [ "${1:-}" = "--backfill" ]; then
  package="${2:-}"
  if [ -z "$package" ]; then echo "Usage: $0 --backfill <package>" >&2; exit 1; fi
  mapfile -t tags < <(git tag --sort=-v:refname | grep -E "^${package}@" || true)
  if [ "${#tags[@]}" -eq 0 ]; then
    echo "No tags found for package: ${package}" >&2
    exit 1
  fi
  out="packages/${package}/CHANGELOG.md"
  {
    write_header "$package"
    for idx in "${!tags[@]}"; do
      tag="${tags[idx]}"
      version="${tag#*@}"
      if [ "$idx" -eq $((${#tags[@]} - 1)) ]; then
        # Oldest tag: no predecessor in range, seed instead of an empty section.
        echo "## [${version}] - $(git log -1 --format=%cs "$tag")"
        echo ""
        echo "Initial tracked release line."
        echo ""
        continue
      fi
      prev="${tags[idx+1]}"
      section_for "$package" "$prev" "$tag" "$version" "$(git log -1 --format=%cs "$tag")"
    done
  } > "$out"
  normalize "$out"
  echo "Backfilled ${out} (${#tags[@]} versions)."
  exit 0
fi

if [ $# -lt 3 ]; then
  echo "Usage: $0 <package> <prev-ref> <version> [date] [note]" >&2
  exit 1
fi

package="$1"
out="packages/${package}/CHANGELOG.md"
tmp="$(mktemp)"
section_for "$package" "$2" "HEAD" "v$3" "${4:-$(date +%F)}" > "$tmp"
{
  write_header "$package"
  cat "$tmp"
  if [ -f "$out" ]; then
    awk '/^## \[/{on=1} on' "$out" || true
  fi
} > "${out}.new"
normalize "${out}.new"
mv "${out}.new" "$out"
rm -f "$tmp"
echo "Prepended ${package}@v$3 section."
