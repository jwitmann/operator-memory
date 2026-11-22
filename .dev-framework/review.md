# Review — index-staleness phase 3 implementation (this session)

## Scope — every changed file

Phase 3 of `.operator-shared/specs/index-staleness.md`: core owns the
preamble unstamped-nudge plus its spec entries. No Helper changes
(phase 1 already shipped the stamp/lint loop):

- `packages/core/src/memory/frontmatter.ts` — `IndexFrontmatter` gains
  required `treeHash`/`stampedAt`/`stampedCommit` (`string | null`,
  explicit null over optional fields); parser populates them via one
  shared `readStampString` helper (string passthrough, YAML `Date`
  timestamp to ISO string, else null — modeled on Helper's
  `readStampFields.getString`; explicit `stamped_commit: null` reads as
  null, same as missing, which is all the presence-only nudge needs).
- `packages/core/src/preamble.ts` — new `collectUnstampedWarnings`
  (per-partition main-index lookup reusing `SHARED_ROOT`/`PRIVATE_ROOT`;
  warns only when frontmatter parses but `treeHash` is not a non-empty
  string; invalid frontmatter stays covered by the listing error line);
  hooked as the `else` of the existing missing-main-index warning, so
  no-main keeps its warning and any-main gets per-partition nudges. No
  extra I/O, no tree hashing — reads already-loaded bodies only.
- `packages/core/src/memory/frontmatter.test.ts` (new) — stamp
  extraction, absent-stamp nulls, unquoted-timestamp ISO conversion;
  `unwrap` helper modeled on `load.test.ts`.
- `packages/core/src/preamble.test.ts` — existing main-index fixtures
  stamped (exact-match test keeps its bytes); two new nudge tests
  (single-partition warning text; per-partition duplication plus
  stamped-silence with 64-hex hashes so common substrings cannot false
  match, and stamp values asserted absent from listings).
- `packages/core/src/memory/load.test.ts` — frontmatter equality gains
  the three explicit-null stamp fields.
- `.operator-shared/specs/preamble.md` — warnings-list entry for the
  unstamped nudge, deferring to `index-staleness.md`; Last Updated
  bumped to November 22, 2026.
- `.operator-shared/specs/commands.md` — one sentence pointing at the
  stamp/lint loop with a link to `index-staleness.md`.
- `.dev-framework/review.md` — this artifact, rewritten fresh.

## Findings and resolutions

- **pattern-guardian: 2 blocking, 2 should-fix — all fixed.** Duplicate
  `readStampCommit` collapsed into `readStampString(value, key)`; stamp
  fields made required `string | null` (matches `StampFields` and
  `ProjectPartitionSnapshot`); warning paths built from `SHARED_ROOT`/
  `PRIVATE_ROOT` instead of literals. Triple main-index traversal
  (`hasMainIndex`/`renderPartitionIndex`/`collectUnstampedWarnings`)
  noted but left — each answers a different question over an in-memory
  array. Bare `` `index stamp` `` command shape confirmed consistent
  with the phase-1 lint message; partial-stamp preamble/lint split
  confirmed intentional per spec (presence-only nudge, completeness is
  lint's job).
- **style-enforcer: 1 blocking, 4 should-fix — fixed or rebutted.**
  Optional-nullable fields fixed (same change as above); duplicate
  helper fixed; all six stamp-less fixtures now explicit-null;
  `frontmatter.test.ts` rewritten with an `unwrap` helper in
  `load.test.ts` style. Mid-file test-helper placement rebutted as
  pre-existing (type at old line 368, wrapper at old 418 — untouched by
  this diff, renaming churns unrelated tests).
- **code-reviewer: NO BLOCKING ISSUES.** Narrowing
  (`main?.frontmatter.ok === true` to `.value`), empty-string handling,
  both-partitions logic, and `hasMainIndex` interplay verified sound;
  whitespace-hash and wrong-type-stamp notes accepted as no-action
  (presence-only contract; validity is lint's job).
- **Confirm pass:** fixes are the specialists' own recommendations
  applied verbatim; gates re-run green instead of respawning the
  battery (biome `useLiteralKeys`/`useOptionalChain` findings from the
  first gate run fixed in-pass).

## Verification (final tree)

- `bun run check packages/core` — exit 0, 16 files, 152 tests pass.
- `bun run check packages/opencode-v2` — exit 0, 19 files, 166 tests pass.
- `bun run check` (root) — exit 0, 65 files, 543 tests pass.
- `bun run lint:md` — 135 files, 0 issues.
- Working tree holds phase-3 changes uncommitted; nothing pushed.
