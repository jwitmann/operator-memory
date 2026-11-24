# Review — Phase 2 OpenCode sqlite adapter (fresh 2026-11-24 ~18:35 +07)

## Scope — every gated path, literally

Product code:

- `packages/helper/src/commands/recall-cross/opencode.ts` — NEW (~700 lines): v2-table ingest (`session_v2` + `session_message` + `session_part`), read-only open, JS-fold fingerprint, per-db transaction, `data_version` gate, cold/backfill + query-delta split, forget tombstones, orphan sweep, expiry. Two fix rounds (below).
- `packages/helper/src/commands/recall-cross/store.ts` — NEW: shared sqlite kernel (`coerceText`/`coerceNumber`, `insertTurns` with DELETE, `openDatabase`, `SqliteDatabase`, `RECALL_RETENTION_MS`, `readForgottenIds`). One-way dependency (syncs → store).
- `packages/helper/src/commands/recall-cross/index.ts` — MODIFIED: store reuse (coercion/insert/opener/retention), DSH orphan sweep excludes `opencode:` keys, `syncDshIndex` filters forgotten ids (fingerprint still recorded), `recallCrossIndex` runs both syncs.
- `packages/helper/src/commands/recall-cross/query.ts` — MODIFIED: `syncOpencodeForQuery` (cold → clean error for explicit opencode, silent DSH-only for all/dsh), `queryRecall`/`recallSessionTurns`/`recallCrossQuery`/`recallCrossRecall` carry home + opencodeDbPaths; prefix-directed recall sync.
- `packages/helper/src/commands/recall-cross/dsh.ts` — MODIFIED: `RECALL_TOOL_NAMES` exported (shared guard), `readNumber` → shared `coerceNumber` (`readString` stays local, nullable contract, commented).
- `packages/helper/test/recall-cross-opencode.test.ts` — NEW: 13 tests (parsers, sync, no-change, delta, recall+pointers, cold error, forget+stickiness, read-only proof, missing-table, no-parts, plan-shape EXPLAIN).
- `packages/helper/test/recall-cross-query.test.ts` — MODIFIED: home-arg plumbing only.
- `packages/helper/test/recall-cross-index.test.ts` — MODIFIED: forget test asserts resync yields zero rows (stickiness).
- `packages/opencode-v2/src/tool.ts` — MODIFIED: `registerSearchSessionsTool` + `registerRecallSessionTool` (helper-subprocess, `--project` from setup-time directory, dash/enum/seq validation, `{content}` returns) + `runHelperBinary`/`HELPER_*`.
- `packages/opencode-v2/src/index.ts` — MODIFIED: registers both tools with project directory.
- `packages/opencode-v2/test/tool.test.ts` — MODIFIED: hoisted `node:child_process` import (no eslint-disable), 6 new tests (registration, invocation shapes, validation no-spawn pins, degrade).
- `packages/opencode-v2/test/index.test.ts` — MODIFIED: toolTransform count 4 → 6.
- `packages/deepseek/src/tool.ts` — MODIFIED: descriptions list both id prefixes; inline sessionId description synced.

Docs (unchanged; `bun run lint:md` via root gate, 139 files, 0 issues):

- `docs/dev/cross-session-recall-build-plan.md` — UNCHANGED this round (Phase 2 implemented per its delta-over-indexes design; v2-table pivot recorded here: legacy tables frozen, v2 live).
- Others — UNCHANGED; reused.

Meta:

- `.dev-framework.yml` — UNCHANGED by me (pre-existing `lint_changed: true`); no action.
- `.dev-framework/review.md` — THIS ARTIFACT, rewritten fresh.

## Findings and resolutions

Round 1 battery (pattern-guardian / style-enforcer / code-reviewer, parallel):

- Pattern-guardian — 2 blocking FIXED: dropped dead `opencode_state` table; `RECALL_RETENTION_MS` single-sourced in `store.ts` (both syncs use it). 4 should-fix FIXED: store.ts kernel (coercion/insert/opener shared; `readString` intentionally local); deepseek description synced to two-prefix form. Note accepted: `runHelperBinary` duplication across adapters (independent bundles; promote to core only on third copy). Residual (double DELETE) FIXED in round 2.
- Style — 0 blocking. Should-fix: import-order eslint-disable FIXED (hoisted static import); `?`-convention kept (established Phase-1 helper style, pre-existing); duplication note same as above. Notes accepted (dynamic sqlite import intentional; header/operator conventions kept).
- Code-reviewer — 4 blocking FIXED: (1) tool parts re-keyed `mid#ordinal` with ordinal in SQL — second fixture part pins it; (2) tool pointers suffixed `:tool:<ordinal>` (seq column still parent int, `--seq` restores message+tools); (3) IN batches chunked at 500; (4) forget made sticky via `forget.log` tombstones consulted by both syncs (fingerprint recorded, zero rows). 3 should-fix FIXED: (5) sourceKey hashes full path; (6) expiry runs on fast path; (7) cold probe read-only, catch→cold. Notes accepted: unprefixed-recall double sync (correct, explicit path); `--harness all` cold silence (documented in tool descriptions); cold_done-with-zero-dbs (harmless); sweep non-atomic (self-healing).

Round 2 (confirm-only re-runs): code-reviewer — no remaining blocking/should-fix (tombstone/files round-trip, pointer/suffix vs CAST filter, per-batch seqById, expiry-on-fast-path, no import cycle all verified; one cosmetic note: search labels render `[id#seq=N]` without suffix — deferred). Pattern-guardian — no remaining blocking (residual double-DELETE fixed by removing outer DELETEs; store owns the single DELETE).

Timeouts: heaviest opencode tests at 30s (full-suite contention class); hook flake fixed structurally (seed-on-demand; parser tests pay no sqlite setup; fixture transactions single-commit); plan-shape fixture mirrors live selectivity (many small sessions).

Live proof (scratch HOME, symlinked stores, removed after): cold backfill 586s (~10 min, one-time, explicit step only; 2810 opencode sources → 199k turns, 184k expired by the 30-day backstop) + DSH 87s (438 sources → 22k turns, 0 skips); second `index` run 1s no-op (`data_version` gate); live `query --harness opencode --project finnomena` returns ranked excerpts with pointers in 1s.

Blocking findings: none open.

## Verification (commands actually run)

- `bun run check packages/helper` — green, 14 files, 137/137.
- `bun run check packages/opencode-v2` — green, 19 files, 174/174.
- `bun run check packages/deepseek` + `packages/core` — green (root covers).
- `bun run check` (root) — green, 71 files, 616/616, exit 0 (includes `lint:md` 139 files, 0 issues).
- `bun run typecheck` — clean (caught the readonly-accumulator regression mid-round, fixed with local lets).
