# Review — observation engine v4 build (this session)

## Scope — every changed file

Product code:

- `packages/core/src/memory/user.ts` — `UserPartitionSnapshot.observations: string | null`; status loop + full loader cover `observations.md` (fail-closed absent → null).
- `packages/core/src/preamble.ts` — `renderUserObservations` subordinate `<user-observations>` block (explicit not-instructions framing), placed after user catalog, before project sections.
- `packages/core/src/preamble-refresh.ts` — user root fingerprints `operator.md` + `catalog.md` + `observations.md`; shared/private unchanged; sorted canonical form preserved.
- `packages/helper/src/templates/user/operator.ts` — observation-proposal rubric in the user-init seed (triggers, question-tool offer, storage scopes, secrets bar, OFF-default switch, nag guard).
- `packages/helper/src/templates/user/setup.ts` — partition file list documents `observations.md` as subordinate injected-when-present surface.

Tests (fail-before/pass-after, see Verification):

- `packages/core/src/memory/load.test.ts` — loads observations, absent → null, obstructed → user error.
- `packages/core/src/preamble.test.ts` — renders subordinate block in order, omits when absent, keeps instructions clean; existing literals carry the new field.
- `packages/core/src/preamble-refresh.test.ts` — observations change moves the fingerprint.
- `packages/helper/test/templates.test.ts` — seed carries the rubric.

Docs and brain (contract, no behavior):

- `.operator-shared/specs/preamble.md` — Composition + machine labels + new `User Observations` section; Last Updated 2026-11-21.
- `docs/dev/observation-engine.md` — Status → v4 implemented; proposal-flow header → implemented 2026-11-21.
- `.operator/specs/working-state.md` — Next line records the v4 build (commits, pilot-gate 3/20, migration parked).
- `.dev-framework/review.md` — this artifact, rewritten fresh.

## Findings and resolutions

- **pattern-guardian (host-dispatched, this session): no blocking drift.** Reuses `readOptionalContent` / `checkOptionalReadableFile` / `fingerprintFile` / `renderFile` shapes; extends per-file conventions; naming mirrors the catalog trio. Two non-blocking Notes, both pre-existing and out of scope: root literals duplicated instead of `PROJECT_SHARED_ROOT` / `PROJECT_PRIVATE_ROOT` (`preamble.ts:9-10`, `preamble-refresh.ts:37-39`); `collectIndexFiles` duplicates `listMarkdownFiles` with `endsWith(".md")` vs `extname` (`preamble-refresh.ts:119-141`). Not introduced by this change; left untouched per scope discipline.
- **code-reviewer (host-dispatched, this session): no correctness issues.** Status/full-mode error semantics preserved (ENOENT tolerated, obstructed/unreadable propagate with precise paths); only-observations-present yields `exists:true`; empty string renders (matches catalog); fingerprint early-return + sort intact; template escapes correct; all snapshot initializers carry the field. Two non-blocking Notes, both pre-existing: `.md` dotfile filter divergence (conservative-only, spurious refresh at worst); mtime-only granularity (spec-mandated tradeoff).
- **style-enforcer (host-dispatched, this session): no style issues.** Naming, placement, `Result` shapes, import grouping, template escaping, and test structure match siblings and `biome.json`; Markdown follows each file's existing convention.
- **Prior-round subagent reports reused:** pattern-guardian and code-reviewer findings from the pre-commit round are unchanged (no product edits since); the host-dispatched battery above supersedes them with the same verdict.
- **test-grounder (evidence):** fail-before via `git stash` of the 5 product files → 7 failed / 40 across the 4 touched suites; pass-after on the final tree → 40 passed / 40. Full suites: core 147 passed, helper 85 passed; root 522 passed. No skipped or flaky tests.
- **Scope discipline:** no new helpers, dependencies, config keys, or error patterns; no unrelated refactors. `USER_FILES` untouched (no auto-created empty `observations.md`); user status treats it as freeform. Project-scoped writes reuse `.operator/operator.md`.
- **Out of scope (parked, noted):** v3 automation stays parked; existing `## Observations` lines migrate only via separately approved migration (promotion ≠ replacement).

## Verification (final tree)

- `bun run check` (root) — exit 0: 63 test files, 522 tests passed; format/lint/typecheck clean.
- `bun run lint:md` — exit 0: 134 files, 0 issues.
- `dev_framework_verify` — PASS.
- Committed locally as `a35298d` (core), `1dec2c6` (helper + specs), `a255e0a` (review); pre-commit per-package gates green. This rewrite amends the review artifact; working tree otherwise clean.
