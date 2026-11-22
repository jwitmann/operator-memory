# Review — index-staleness phase 1 implementation (this session)

## Scope — every changed file

Phase 1 of `.operator-shared/specs/index-staleness.md`: Helper owns the
stamp/lint loop. No core changes (preamble nudge is phase 3):

- `packages/helper/src/tree-hash.ts` (new) — `computeTreeHash` (git
  `ls-files --cached -z` inside a work tree, silent walk fallback with the
  spec's closed ignore set, `rev-parse HEAD` with null-on-failure),
  `stampFrontmatter` (textual splice preserving all other bytes),
  `readStampFields` (YAML-parser reads with a key-presence `complete` flag;
  an explicit null commit reads back as null without breaking completeness),
  shared `FRONTMATTER_PATTERN`, named `StampInput`.
- `packages/helper/src/commands/index/stamp.ts` (new) — per-partition mains
  via the shared `PARTITIONS`, hard error when no main exists or frontmatter
  is malformed, shared `stampedAt` across mains in one run.
- `packages/helper/src/lint.ts` — staleness second pass (unstamped /
  incomplete warnings, lazy single hash computation, error finding on hash
  failure, hash-transition stale message), `PARTITIONS` exported as the
  single root list, frontmatter regex single-sourced from
  `packages/helper/src/tree-hash.ts`.
- `packages/helper/src/commands/index/init.ts` — reuses `PARTITIONS` from
  `packages/helper/src/lint.ts` instead of its own root tuple (behavior
  identical, order preserved).
- `packages/helper/src/cli.ts` — `index stamp` help row + dispatch.
- `packages/helper/src/templates/project/index-setup.ts` — Phase 5 runs
  stamp-then-lint; Phase 6 reports the stamp result; pre-existing
  "together together" duplication fixed (proven pre-existing: present in
  parent, untouched by this diff).
- `packages/helper/test/stamp.test.ts` (new) — splice/parse unit tests,
  null-commit and quoted-value/comment round-trips, walk/git/fallback hash
  tests, CLI round-trip, drift/churn fixtures, failure cases.
- `packages/helper/test/lint.test.ts` — staleness warnings, incomplete-stamp
  warning, hash-failure error; title-test expectations updated; git-runner
  mock in the shared `run` helper.
- `packages/helper/test/cli.test.ts` — `index stamp` help-row assertion.
- `.operator-shared/specs/index-staleness.md` — drift message fixed to the
  honest hash-transition form (no history is stored, so paths cannot be
  named); test-plan sentence notes the git-runner mock.
- `.dev-framework/review.md` — this artifact, rewritten fresh.

## Findings and resolutions

- **style-enforcer (own battery): 4 blocking, 3 nits — all fixed.**
  Dynamic test imports hoisted; seam booleans required and explicit;
  `PARTITION_ROOTS` removed for exported `PARTITIONS`; `StampFields`
  gains key-presence `complete` (normalizing `"null"` to null was rejected
  — it would perpetual-warn non-git projects — the type now tells the
  truth); the `function*`-direct `Effect.fn` nit rebutted with evidence.
- **pattern-guardian (own battery): 1 blocking, 4 notes — all fixed.**
  Phase 6 stamp-result line added; spec test-plan sentence fixed;
  null-handling resolved by `complete`; import hoisting done.
- **code-reviewer (own battery): NO BLOCKING ISSUES.** 7 notes, all
  accepted as no-action (non-atomic multi-main write, inline-comment
  hashes, quoted-key edges, backend asymmetry, BOM/empty block, CRLF
  tails, error+warning duplication on missing frontmatter).
- **test-grounder (own battery): GROUNDED**, plus lead stash
  re-verification post-fix (41/41 pass; without src: module-missing +
  4 lint failures, 3 pre-existing pass; tree restored).
- **Framework style-enforcer (odf-style-enforcer-8): 1 should-fix, applied.**
  Pre-existing "together together" duplication in
  `packages/helper/src/templates/project/index-setup.ts` (proven
  pre-existing, fixed opportunistically); no other violations across all
  ten files reviewed.
- **Framework code-reviewer (odf-code-reviewer-9): clean.** No correctness
  issues.
- **Framework pattern-guardian (odf-pattern-guardian-7): 2 should-fix,
  both applied.** `commands/index/init.ts` now reuses `PARTITIONS` from
  `packages/helper/src/lint.ts` (single source in the index area; the
  `project/common.ts` hoist would invert the `commands/ → src-root`
  import direction and touch unrelated commands — recorded, deferred);
  `readStampFields` now parses via `parseDocument` with `uniqueKeys`
  (single-quoted values, comments handled; write path keeps the
  line-preserving splice); cross-package `FRONTMATTER_PATTERN` duplication
  left as-is per the note (no new cross-package dependency for one line).
- **Docs cadence:** `bun run lint:md` — 135 files, 0 issues (MD038 and
  the review's own MD004 fixed in-pass).

## Verification (final tree)

- `bun run check packages/helper` — 10 files, 101 tests pass.
- `bun run check` (root) — 64 files, 538 tests pass.
- `bun run lint:md` — exit 0, 0 issues.
- Committed locally; nothing pushed.
