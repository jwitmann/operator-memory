# Review — this session (fresh 2026-11-24 ~20:40 +07)

Session work: wired the V1-required mutual-peer scope end to end.
`peers` in project config (Private paths), helper mutuality resolution,
`--project-dir` plumbing, both tools passing it, scaffold + specs +
harness docs, live three-way proof (mutual hit, one-sided exclusion,
legacy project-only). Committed below as one unit.

## Scope — every changed file

Product code (full battery below):

- `packages/helper/src/commands/recall-cross/peers.ts` — NEW.
  `readPeerDirs` (first-readable-wins via core `projectConfigPaths`,
  silent fail-closed) + `resolveMutualPeers` (realpath-canonicalized
  mutual check, returns basename scope keys, explicit `--peer` union).
- `packages/helper/src/commands/recall-cross/query.ts` — MODIFIED:
  `projectDir` option, peers resolved per query before `queryRecall`.
- `packages/helper/src/cli.ts` — MODIFIED: `--project-dir` parse +
  keyword exclusion + pass-through (mirrors `--root`/`--project`).
- `packages/deepseek/src/tool.ts` — MODIFIED: search passes
  `--project-dir` with the session cwd (null-guarded with `--project`).
- `packages/opencode-v2/src/tool.ts` — MODIFIED: search passes
  `--project-dir` with the setup-time project directory.
- `packages/helper/src/templates/project/config.ts` — MODIFIED:
  scaffolded `"peers": []` (adapters ignore unknown keys, verified).
- `packages/helper/test/recall-cross-peers.test.ts` — NEW: 7 unit
  tests (mutual, one-sided, bad JSON/missing/non-array, self/missing/
  null dirs, explicit union+dedupe, relative paths, legacy fallback).
- `packages/helper/test/recall-cross-query.test.ts` — MODIFIED:
  end-to-end mutual/one-sided scope test through `recallCrossQuery`.
- `packages/deepseek/test/tool.test.ts`,
  `packages/opencode-v2/test/tool.test.ts` — MODIFIED: invocation
  expectations include `--project-dir`.

Docs-only (lint:md, 0 issues — no specialists):

- `.vcc-brain-shared/specs/deepseek/implementation.md`,
  `.vcc-brain-shared/specs/opencode-v2/implementation.md` — `peers`
  contract in the per-project override sections.
- `docs/harnesses/deepseek.md`, `docs/harnesses/opencode-v2.md` —
  declaration snippet + mutuality rule.
- `.dev-framework/review.md` — THIS ARTIFACT, rewritten fresh.

## Battery

- pattern-guardian (fresh): Blocking none, Should-fix none. No-cache
  justified (one-shot CLI), silent fallback matches recall-cross
  idiom, `peers` top-level key correct, one project-identity path.
- style-enforcer (fresh): 1 Blocking (import grouping) + 4
  Should-fix (Effect idiom, push shape, annotation, comment weight)
  → ALL APPLIED. Follow-up churn (catchAll missing in beta, then
  Effect.catch not catching promise-defects) landed on the
  promise-internal `.catch` form — confirmed separately, see below.
- code-reviewer (fresh full pass + narrow confirm on final
  `canonicalDir`): Blocking none. First-readable-wins, symmetry,
  self-exclusion, degradation, keyword filter, no error escapes,
  adapter guards all PASS. Should-fix: duplicate-flag value leak —
  DECLINED with reason (pre-existing convention across all flags;
  tools never emit duplicates; fixing means rewriting the CLI's
  whole flag contract — out of scope). Notes (basename collision
  inherent to ingest keying; mount-view fail-closed) accepted, no action.
- test-grounder: helper EXIT 0 (15 files, 145/145 — 8 new peers
  tests fail-without-code by construction); deepseek 77/77;
  opencode-v2 174/174; live CLI proof — mutual declares hit
  cross-project, one-sided drops to "No matching turns in scope",
  no-flag stays project-only (backward compatible). Opencode-suite
  timeouts under full parallel load proven flake (13/13 alone).

## Resolutions

- Every Blocking: none raised. Every Should-fix: applied except the
  documented decline. All Notes: recorded, no action.
- Two self-inflicted churns on `canonicalDir` (beta API guesses)
  caught by tests, fixed, confirmed — recorded as the reason this
  battery ran a confirm pass on the final form.

## Gates (final tree)

- `bun run check packages/helper` EXIT 0 (145/145).
- `bun run check packages/deepseek` EXIT 0 (77/77).
- `bun run check packages/opencode-v2` EXIT 0 (174/174).
- `bun run lint:md` 0 issues. odf post-execute lints passed.
