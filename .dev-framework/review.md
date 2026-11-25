# Review — chore(v1): remove unsupported OpenCode V1

Scope: product-code deletion plus doc/brain fallout. No new behavior.
Files:
Deleted: `packages/opencode/` (entire V1 adapter package), `packages/helper/src/commands/install/opencode.ts`, `docs/harnesses/opencode.md`, `.vcc-brain-shared/specs/opencode/implementation.md`.
Edited product: `packages/helper/src/cli.ts`, `packages/helper/src/templates/project/shared-readme.ts`, `packages/helper/test/install-update.test.ts`, `packages/helper/test/npm-registry.test.ts`, `package.json`, `bun.lock`.
Edited docs/brain: `docs/architecture.md`, `docs/dev/follow-ups.md`, `docs/dev/releasing.md`, `docs/harnesses/opencode-v2.md`, `packages/helper/README.md`, `packages/opencode-v2/README.md`, `.vcc-brain-shared/README.md`, `.vcc-brain-shared/catalog.md`, `.vcc-brain-shared/index/helper.md`, `.vcc-brain-shared/index/index.md`, `.vcc-brain-shared/specs/reference/implementation.md`, `.vcc-brain-shared/vcc-brain.md`, `scripts/release.sh`.
This artifact: `.dev-framework/review.md`.

## Change

- V1 package, installer, `install opencode-v1` command, V1 tests, V1 harness doc, and V1 contract spec removed. Help entry, template, and registry fixture updated; `@opencode-ai/plugin` dropped with a real `bun install` lockfile refresh (temp cache dir; hooks path restored and verified).
- Every user-facing surface now says "OpenCode V1 is not supported" — no "frozen/legacy" language anywhere outside history (CHANGELOGs, closed follow-up tombstone, private working notes).
- `docs/dev/follow-ups.md` V1-installer item closed as removed, not fixed.

## Battery

- style-enforcer: 1 blocking find (stale `architecture.md:71` package claim) — fixed as suggested. Re-verified clean otherwise: import order, help text, template, zero `@opencode-ai/plugin` matches.
- code-reviewer: PASS — no `installOpenCode` refs, no dead imports, switch intact, `opencode`/`opencode-v2` alias preserved, tests coherent.
- pattern-guardian: 4 blocking drifts (shared README, shared instructions count, helper index line, reference-contract link) — all fixed and re-confirmed PASS; plus its follow-up catch (`index/index.md:19` frozen-V1 clause) fixed; plus the shared-instructions doctrine line (`vcc-brain.md:62`) reworded. Final sweep: only intentional "not supported" notices remain.
- test-grounder: full `bun run check` green — 68 files, 608 tests pass (17 fewer than before = the deleted V1 suite; helper 143/143 after dropping 2 V1 tests). `bun run lint:md` 0 issues in 132 files.

## Findings

- None blocking. All specialist reports PASS after fixes; lockfile churn beyond the removal is legitimate workspace version sync.
