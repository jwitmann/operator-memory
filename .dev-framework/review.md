# Review — README OpenCode VCC correction (this session)

## Scope — every changed file

- `README.md` — "For the best long-session results" OpenCode bullet only.
  Replaced the "no extra install — bundled compiler" claim with the
  symmetric VCC requirement: install `opencode-vcc-compaction` alongside
  the Operator plugin (`opencode plugin add opencode-vcc-compaction`).
  Without it, compaction falls back to the in-tree reference port plus
  the host summarizer — works but not the same (no
  `vccRev`/`vccConfigHash` stamping, no tunables, debug-rev header).
- `.dev-framework/review.md` — this artifact.

No product code. Docs-only change.

## Findings and resolutions

- **Finding (user): bundled reference port is not VCC — best results
  requires the engine on both harnesses.**
  Verified: `packages/opencode-v2` has no dependency on
  `opencode-vcc-compaction`; its `src/compaction-compiler.ts` ports the
  same `COMPILER_REV` (`vcc-compiler-debug-2`) and defaults (8192/6) but
  emits header `[vcc-compaction …]` vs standalone
  `[opencode-vcc-compaction …]` and persists
  `event.result = { summary, metadata: { keepID } }` only, against the
  standalone (`/home/jerome/opencode-vcc-port/adapter.mjs`) which stamps
  `{ keepID, vccRev, vccConfigHash }`, supports tunable options, and
  ships as `opencode-vcc-compaction@0.4.0` (`opencode plugin add
  opencode-vcc-compaction`, live-verified on host v2.3.2).
  Operator without the standalone still compacts (deterministic-first,
  shaped fallback) but that path is reference-grade, not full VCC.
  Resolution: bullet now mirrors the DeepSeek half — install the engine
  alongside, name the fallback cost honestly.
- **Cadence: docs-only, no specialists.**
  Markdown lint is the entire battery. No specialist re-runs; nothing to
  invalidate.

## Verification (final tree)

- `bun run lint:md` — 135 files, 0 issues.
- `git diff --stat` — `README.md` only (plus this artifact). Uncommitted;
  no push.
