# Review — this session (fresh 2026-11-24 ~18:45 +07)

Session work: Phase 2 OpenCode sqlite adapter for cross-session recall
(helper `opencode.ts` + `store.ts`, query/index wiring, opencode-v2 tool
pair, fixture tests), two review-battery fix rounds, live proof against the
real 18GB store, local commit `7f0e47f`. Gate `bun run check` exit 0
(71 files, 616 tests) + `lint:md` 0 issues.

## Scope — every changed file, literally

Product code (full specialist battery; reports reused below — no product
file changed since the confirm round except the 2-line double-DELETE
removal, which the green gate covers):

- `packages/helper/src/commands/recall-cross/opencode.ts` — NEW. v2-table ingest, read-only open, delta sync, tombstones, expiry. Fix rounds: ordinal-keyed tool parts, `:tool:<ordinal>` pointer suffix, 500-chunked IN batches, sticky forget, hashed sourceKey segment, expiry on fast path, read-only cold probe.
- `packages/helper/src/commands/recall-cross/store.ts` — NEW. Shared sqlite kernel (coercion, insert batch with DELETE, opener, retention, tombstone reader). One-way dependency.
- `packages/helper/src/commands/recall-cross/index.ts` — MODIFIED: store reuse, DSH orphan sweep excludes `opencode:` keys, forgotten-id filtering, dual-sync `recallCrossIndex`.
- `packages/helper/src/commands/recall-cross/query.ts` — MODIFIED: `syncOpencodeForQuery` cold rule, prefix-directed recall sync, home/dbPaths plumbing.
- `packages/helper/src/commands/recall-cross/dsh.ts` — MODIFIED: `RECALL_TOOL_NAMES` export, `readNumber` → shared `coerceNumber` (`readString` stays local, commented).
- `packages/helper/test/recall-cross-opencode.test.ts` — NEW: 13 tests, incl. second-tool-part pin, forget stickiness, hasParts=false, EXPLAIN plan-shape.
- `packages/helper/test/recall-cross-index.test.ts` — MODIFIED: DSH forget stickiness assertion.
- `packages/helper/test/recall-cross-query.test.ts` — MODIFIED: home-arg plumbing only.
- `packages/opencode-v2/src/tool.ts` — MODIFIED: `registerSearchSessionsTool` + `registerRecallSessionTool`, helper-subprocess backing.
- `packages/opencode-v2/src/index.ts` — MODIFIED: registers both tools.
- `packages/opencode-v2/test/tool.test.ts` — MODIFIED: hoisted builtin import, 6 new tests.
- `packages/opencode-v2/test/index.test.ts` — MODIFIED: toolTransform count 4 → 6.
- `packages/deepseek/src/tool.ts` — MODIFIED: both id prefixes in descriptions.

Docs (docs cadence: `lint:md` on the files, 0 issues — no specialists):

- `docs/dev/cross-session-recall-build-plan.md` — UNTRACKED, from prior spans; NOT modified this session. Lint clean.
- `docs/dev/cross-session-recall-build-plan.md.review.md` — same; lint clean.
- `docs/dev/cross-session-recall-need-audit.md` — same; lint clean.
- `docs/dev/rule-verbatim-survival-audit.md` — same; lint clean.

Meta / non-changes:

- `.dev-framework.yml` — MODIFIED in tree, pre-existing, NOT mine: one added line (`lint_changed: true`) predating this session (last commit `bc5a2a2` framework activation; recorded as pre-existing in the prior review artifact). Untouched by me; left as-is.
- `"2"` (gate file list entry) — no such file exists in the tree; gate-list noise, nothing to review.
- `.dev-framework/review.md` — THIS ARTIFACT, rewritten fresh.

## Findings and resolutions (specialist reports reused)

Round 1 (pattern-guardian / style-enforcer / code-reviewer, parallel subagents):

- Pattern-guardian — 2 blocking FIXED (dead `opencode_state` table dropped; retention single-sourced in `store.ts`); 4 should-fix FIXED (store kernel; descriptions synced). Residual double-DELETE FIXED post-confirm (outer DELETEs removed; single DELETE in `store.insertTurns` verified present before trusting the removal).
- Style-enforcer — 0 blocking. Import-order violation FIXED (hoisted static import, `vi.mock` hoisting relied upon); `?`-convention kept (pre-existing Phase-1 helper style); adapter duplication accepted (third copy promotes to core).
- Code-reviewer — 4 blocking FIXED (ordinal-keyed parts; pointer suffix with integer-seq restore; chunked IN; sticky forget in both syncs); 3 should-fix FIXED (hashed sourceKey; fast-path expiry; read-only cold probe, catch→cold).

Round 2 (confirm-only re-runs on final code): both clean — tombstone/files round-trip, pointer-vs-CAST interplay, per-batch lookup locality, probe safety, import direction all verified; no remaining blocking/should-fix. The post-confirm 2-line DELETE removal is behavior-preserving (idempotent statement) and covered by the green gate, not a re-review trigger.

Test-grounder role: fail-before evidence — CR1/CR2/CR4 fixes each have pinning tests (second tool part, pointer-suffix restore, forget+resync-zero-rows); new files grounded by construction (12/12 + hasParts test green, suite 616/616). Commands run: `bun run check` (exit 0), `bun run typecheck` (caught + fixed one readonly regression), `bun run lint:md` (0 issues), live `recall-cross index`/`query` proofs (cold ~10 min one-time, delta 1s, query 1s with ranked hits).

Blocking findings: none open.
