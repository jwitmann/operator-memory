#!/usr/bin/env bash
#
# migrate-brain-to-vcc-brain.sh — move one project's brain directories from
# the legacy `.operator*` roots to the primary `.vcc-brain*` roots.
#
# Usage:
#   scripts/migrate-brain-to-vcc-brain.sh [--dry-run] <project-dir>
#
# Policy (mirrors packages/core/src/memory/roots.ts: primary wins, legacy is
# reused only when primary is absent):
#   legacy only  → move (git mv when tracked, plain mv otherwise)
#   primary only → already migrated, skip
#   both exist   → REFUSE; primary shadows legacy at runtime, so diff and
#                  merge by hand, then remove legacy yourself
#   neither      → skip (a fresh init creates the primary)
#
# Also patches <project>/.gitignore when present, and is idempotent:
# re-running a migrated project changes nothing. Never merges, never
# deletes, never touches the home partition (one separate move).

set -euo pipefail

DRY_RUN=0
PROJECT=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] <project-dir>"
      exit 0
      ;;
    -*) echo "Unknown flag: $arg" >&2; exit 2 ;;
    *)
      if [ -n "$PROJECT" ]; then echo "Only one project dir, got: $arg" >&2; exit 2; fi
      PROJECT="$arg"
      ;;
  esac
done

if [ -z "$PROJECT" ]; then
  echo "Usage: $0 [--dry-run] <project-dir>" >&2
  exit 2
fi

case "$PROJECT" in
  /*) ;;
  *) PROJECT="$PWD/$PROJECT" ;;
esac

if [ ! -d "$PROJECT" ]; then
  echo "Not a directory: $PROJECT" >&2
  exit 2
fi

cd "$PROJECT"
echo "Migrating brain roots in: $PWD"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "(dry run: no changes will be made)"
fi

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

REFUSED=0

migrate_one() { # <legacy> <primary>
  local legacy="$1" primary="$2"
  if { [ -e "$primary" ] || [ -L "$primary" ]; } && { [ -e "$legacy" ] || [ -L "$legacy" ]; }; then
    echo "REFUSE: both ./$primary and ./$legacy exist."
    echo "  Runtime reads $primary and shadows $legacy — diff them, merge by"
    echo "  hand, then remove $legacy yourself. Leaving both untouched."
    REFUSED=1
  elif [ -e "$legacy" ] || [ -L "$legacy" ]; then
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
      && git ls-files --error-unmatch -- "$legacy" >/dev/null 2>&1; then
      run git mv -- "$legacy" "$primary"
      HOW="git mv"
    else
      run mv -- "$legacy" "$primary"
      HOW="mv"
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "Would move ($HOW): ./$legacy -> ./$primary"
    else
      echo "Moved ($HOW): ./$legacy -> ./$primary"
    fi
  elif [ -e "$primary" ] || [ -L "$primary" ]; then
    echo "Already migrated: ./$primary exists, no ./$legacy. Skipping."
  else
    echo "Absent: neither ./$legacy nor ./$primary exists. Skipping."
  fi
}

migrate_one ".operator" ".vcc-brain"
migrate_one ".operator-shared" ".vcc-brain-shared"

ensure_line() { # <line> <file>
  if ! grep -qF -- "$1" "$2"; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "[dry-run] append to $2: $1"
    else
      printf '%s\n' "$1" >> "$2"
      echo "Added to .gitignore: $1"
    fi
  fi
}

if [ -f ".gitignore" ]; then
  ensure_line "/.vcc-brain-shared/references/" ".gitignore"
  if ! grep -qF -- "/.vcc-brain/" ".gitignore"; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "[dry-run] append private-partition block to .gitignore"
    else
      {
        printf '%s\n' ""
        printf '%s\n' "# Brain private partition (also in global Git ignore; belt and braces)"
        printf '%s\n' "/.vcc-brain/"
        printf '%s\n' "/.operator/"
      } >> ".gitignore"
      echo "Added private-partition block to .gitignore."
    fi
  fi
else
  echo "No .gitignore here; leaving ignore rules to 'operator-helper project init'."
fi

EXCLUDES="$(git config --get core.excludesFile 2>/dev/null || true)"
if [ -z "$EXCLUDES" ]; then
  EXCLUDES="$HOME/.config/git/ignore"
fi
if [ -f "$EXCLUDES" ] && ! grep -qF -- ".vcc-brain/" "$EXCLUDES"; then
  echo ""
  echo "Note: your global ignore ($EXCLUDES) has no .vcc-brain/ entry yet."
  echo "Run once per machine:  printf '%s\n' '.vcc-brain/' >> $EXCLUDES"
fi

echo ""
if [ "$REFUSED" -ne 0 ]; then
  echo "Done WITH REFUSALS (exit 1): resolve the both-exist partitions by hand."
  exit 1
fi
echo "Migration complete. Verify with: operator-helper project status"
