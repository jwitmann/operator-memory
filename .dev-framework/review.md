# Review — Step 5 DSH tool wiring + helper recall command (fresh 2026-11-24 ~16:55 +07)

## Scope — every gated path, literally

Product code:

- `packages/deepseek/src/tool.ts` — MODIFIED: `vcc-brain-search-sessions` + `vcc-brain-recall-session` (helper-subprocess backed via `node:child_process` `execFile`, argv array, 60s `HELPER_TIMEOUT_MS`), `readSessionCwd` reusing `readSession`, harness allow-list + dash-guards in execute, stderr-wins-on-failure output, header comment justifying the raw builtin. Full battery (below).
- `packages/deepseek/test/tool.test.ts` — MODIFIED: apply test now 4 tools + 4 disposers; 5 new tests (search shells with `--project` scope, validation no-spawn, recall by id+seq, recall validation, helper-missing degrade); `vi.mock("node:child_process")` + commented `mockReset`; dash-guard pins. 15/15.
- `packages/core/package.json` — UNCHANGED; stands.
- `packages/core/src/recall-cross/` — directory; files below unchanged this session.
- `packages/core/src/recall-cross/types.ts` — UNCHANGED; stands.
- `packages/core/src/recall-cross/ranking.ts` — UNCHANGED; stands.
- `packages/core/src/recall-cross/ranking.test.ts` — UNCHANGED; stands.
- `packages/helper/src/commands/recall-cross/` — directory; files below.
- `packages/helper/src/commands/recall-cross/dsh.ts` — MODIFIED (one line): `normalizeProject` exported for query reuse; ingest behavior untouched.
- `packages/helper/src/commands/recall-cross/index.ts` — UNCHANGED behaviorally (exports reused by query recall); stands.
- `packages/helper/src/commands/recall-cross/query.ts` — MODIFIED: `recallSessionTurns` (SELECT by session_id, optional `CAST(seq)` filter, LIMIT 200, `not-found`) + `recallCrossRecall` (blank-id usage error) via shared `collectRecords`; `normalizeProject` replaces removed `projectForCwd` (explicit `--project` normalized, raw session cwd safe); stale header fixed.
- `packages/helper/src/cli.ts` — MODIFIED: `recall-cross recall <session-id> [--seq N] [--root]` branch (missing-value/surplus-positional usage errors, integer-validated seq), `--topN` renamed `--top` (lowercase flag idiom), help row, canonical usage line.
- `packages/helper/test/recall-cross-dsh.test.ts` — UNCHANGED; 8/8 stands.
- `packages/helper/test/recall-cross-index.test.ts` — UNCHANGED (timeouts from Step 4); stands.
- `packages/helper/test/recall-cross-query.test.ts` — MODIFIED: +1 recall test (full restore, seq filter, `not-found`).

Docs (unchanged; `bun run lint:md` via root gate, 139 files, 0 issues):

- `docs/dev/cross-session-recall-build-plan.md` — UNCHANGED; Step 5 implemented as specified.
- `docs/dev/cross-session-recall-build-plan.md.review.md` — UNCHANGED; reused.
- `docs/dev/cross-session-recall-need-audit.md` — UNCHANGED; reused.
- `docs/dev/rule-verbatim-survival-audit.md` — UNCHANGED; reused.

Meta:

- `.dev-framework.yml` — UNCHANGED by me (pre-existing `lint_changed: true`); no action.
- `.dev-framework/review.md` — THIS ARTIFACT, rewritten fresh.

## Findings and resolutions

Step 5 battery (this session):

- Style — 3 blocking FIXED: `node:child_process` import reordered first; nested ternary rewritten as if/else with stderr-wins rule; `./dsh.ts` import sorted before `./index.ts`. Should-fix applied: query header mentions recall; `HELPER_TIMEOUT_MS` const; `readSessionCwd` reuses `readSession`; mockReset commented. Deferred with reason: branch-specific CLI usage lines kept (more helpful than one canonical line); `let topN/let seq` kept (integer validation needs early-return statements, const-ternary cannot reject); `(args.harness as string)` cast kept (removing it reintroduces TS2367 — the framework enum type has no `""` member); `String(args.seq)` kept (optional-param type is not narrowed to string).
- Code-reviewer — no blocking. 2 should-fix applied: harness allow-list re-validated in execute (defense-in-depth past `defineTool` enum validation, which throws before execute for invalid values — verified live, so the in-execute path is untestable via `tool.execute` and intentionally unpinned); dash-prefixed keywords/sessionId rejected (no `--` separator support in the helper CLI; argv array already rules out shell injection). Notes accepted: `error.code` mapping covers string codes/timeout-kill; try/catch around the never-rejecting runner kept as belt-and-braces; recall-by-ID intentionally unscoped (ID-addressed pull needs no project); malformed IDs yield `not-found`, not usage errors (parameterized, no injection).
- Pattern-guardian — no blocking. 4 should-fix applied: `readSessionCwd` reuses `readSession`; `recallSessionTurns` routes through `collectRecords` (one row→record path); `--topN` renamed `--top` (helper CLI keeps `topN` option field; DSH tool has no limit passthrough — intentional, model gets default top 5, humans narrow via CLI); execFile justification recorded in the file header. Notes accepted: `empty*` trio and `formatRecallReply` fork are intentional (different result types); `vi.mock("node:child_process")` is the only builtin mock, justified alongside the spawn.
- Test-grounder — GROUNDED with stated limitation (new files, no pre-fix tree, no live mutants): 20/20 observed green (deepseek 15 + helper query 5), per-test mutant mapping by inspection (invocation shape, no-spawn pins, `--seq` passthrough, degrade path, seq-filter/`not-found` pins).

Timeouts: all 15s closings retained (FTS5-trigram load flake class, proven earlier).
Blocking findings: none open.

## Verification (commands actually run)

- `bun run check packages/deepseek` — green, 9 files, 77/77 (one transient exit-1 was an edit racing the gate; per-stage rerun FMT/LINT/TSC/VITEST all 0, wrapper rerun exit 0).
- `bun run check packages/helper` — green, 13 files, 124/124.
- `bun run check packages/core` — green, 177/177.
- `bun run check` (root) — green, 70 files, 598/598, exit 0 (includes `lint:md` 139 files, 0 issues).
