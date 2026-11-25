# Review — docs(release): checklist pins release-notes body over generate-notes

Scope: docs-only follow-up to the release-notes fix. One file:
edited `.vcc-brain-shared/specs/reference/release.md` (Release Automation bullet now requires `scripts/release-notes.sh` + `--notes-file`, forbids `--generate-notes`).
This artifact: `.dev-framework/review.md`.

## Change

- Tie-off from the Caterpillar review (DOC/script/changelog coherence pass): `docs/dev/releasing.md` already documents the new body flow, all six `publish-*.yml` workflows already build it, `changelog.sh`/`release-notes.sh` comments already agree — but the shared contributor checklist still said only "mirroring the Codex pipeline," so a future adapter could copy the shape without the notes step. Now pinned explicitly.

## Battery (docs cadence)

- `bun run lint:md`: 0 issues in 116 files. No product code touched; no specialists required, none re-run. Full `bun run check` not re-run (single markdown bullet; prior full green stands).

## Findings

- None blocking. Pre-existing observation (unchanged by this work, no action): `push-release.sh --repush` re-fires the workflow on an existing GitHub release, so `gh release create` may collide with the live release — true before and after the notes change; flagging for the next repush, not this commit.
