# Review — fix(release): idempotent GitHub release create-or-edit

Scope: release-infra robustness, no product behavior. Follow-up to the release-notes fix: `push-release.sh --repush` re-fires the workflow against an already-existing GitHub release, where bare `gh release create` collides.
This session's changed files:
Edited: `.github/workflows/publish-helper.yml`, `.github/workflows/publish-deepseek.yml`, `.github/workflows/publish-pi.yml`, `.github/workflows/publish-codex.yml`, `.github/workflows/publish-claude-code.yml`, `.github/workflows/publish-opencode-v2.yml`, `docs/dev/releasing.md`.
This artifact: `.dev-framework/review.md`.

## Change

- All six "Create GitHub release" steps now probe first: `gh release view` succeeds → `gh release edit --notes-file` (title and assets preserved, body refreshed); otherwise `gh release create --title --notes-file` as before. Re-fires converge; no create collision possible.
- `releasing.md` `--repush` section documents that re-firing also refreshes the release body.
- Side effect (intended): backfilling the three live stub releases (`helper@v1.14.0`, `deepseek@v0.7.0`, `opencode-v2@2.7.0`) no longer needs manual `gh release edit` — `--repush` of each tag refreshes its body through CI.

## Battery

- peer-review (agent-43): PASS — byte-identical block across all six workflows, `view`/`edit --notes-file` flags valid, `edit` preserves title/assets, `if`-guard exempt from `bash -e` errexit so missing-release falls to `else`, redirect suppresses first-fire noise, re-fire converges.
- test-grounder: YAML parses across all six workflows; `grep -c "gh release edit"` = 1 in each; `bun run lint:md` 0 issues in 116 files. No executable product code touched (workflow shell + one docs sentence); full `bun run check` not re-run, prior full green stands.
- style-enforcer / code-reviewer / pattern-guardian: scope unchanged since last reports — reused per cadence.

## Findings

- None blocking.
