# Review — feat(release): attach CHANGELOG section to GitHub release body

Scope: release-infra fix, no product behavior. The `helper@v1.14.0` GitHub release body held only a `--generate-notes` stub linking a cross-package compare (`claude-code@v0.4.0...helper@v1.14.0`); repo CHANGELOGs were correct but never reached the release.
This session's changed files:
New: `scripts/release-notes.sh`.
Edited: `.github/workflows/publish-helper.yml`, `.github/workflows/publish-deepseek.yml`, `.github/workflows/publish-pi.yml`, `.github/workflows/publish-codex.yml`, `.github/workflows/publish-claude-code.yml`, `.github/workflows/publish-opencode-v2.yml`, `scripts/changelog.sh` (comment), `docs/dev/releasing.md`.
This artifact: `.dev-framework/review.md`.

## Change

- New `scripts/release-notes.sh <package>@v<version>` prints the release body: the version section from `packages/<pkg>/CHANGELOG.md` plus a `Full Changelog` compare link pinned to the previous same-package tag (`git tag --list`, `sort -V`). Degrades cleanly: missing section → compare link alone; first release (no prev tag) → section alone.
- All six publish workflows build the body with the script and pass `--notes-file` instead of `--generate-notes`. No per-workflow hardcoding: the script derives the package from `$GITHUB_REF_NAME`.
- `changelog.sh` header corrected (CHANGELOG ships in repo only — npm tarballs carry `dist`; release body is now sourced from it) and `releasing.md` documents the new flow.

## Battery

- peer-review (agent-42): PASS — quoting, awk matching, `set -u` safety, `sort -V` on ubuntu-latest with full tag history, identical 4-line YAML steps across all six workflows, trigger filters matching the script's package derivation.
- test-grounder: `bash -n` clean; YAML parses; live runs — `helper@v1.14.0` prints 5-bullet section + correct `helper@v1.13.0...helper@v1.14.0` link (exit 0), `deepseek@v0.7.0` likewise vs `v0.6.0`; first-tag edge yields section-only; unknown version yields empty body, exit 0. `bun run lint:md` 0 issues in 116 files. Full `bun run check` not re-run: no TS/product file touched (script + workflows + comments only); prior full green stands.
- style-enforcer / code-reviewer / pattern-guardian: scope unchanged since their last reports on product files — reused per cadence (this change touches no product code).

## Findings

- None blocking. Backfill for the three live stub releases is a user-side `gh` action (needs auth): `gh release edit <tag> --notes-file <(./scripts/release-notes.sh <tag>)` for `helper@v1.14.0`, `deepseek@v0.7.0`, `opencode-v2@2.7.0`.
