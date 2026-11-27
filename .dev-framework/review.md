# Peer Review — contextManagement trim-only mode (2026-11-27)

## Scope

This session adds `contextManagement.mode: "full" | "trim-only"`
(default `"full"`) so trim and end-of-run compaction survive alongside
an external VCC engine, partitioned by construction: we trim, trigger,
and serve omissions; the engine summarizes and recalls. Product code
first, then the two doc files that describe the mode.

Product code:

- `packages/opencode-v2/src/options.ts` — new `readOptionString`
  (absent→default, wrong-type→failure), mirroring
  `readOptionNumber`/`readOptionBoolean`.
- `packages/opencode-v2/src/context-config.ts` — `ContextManagementMode`
  union, `mode` field (default `"full"`), literal validation failing
  loudly on anything but `"full"`/`"trim-only"`; new single
  `isFullContextMode` predicate for every mode branch.
- `packages/opencode-v2/src/context.ts` — trim and receipts run in both
  modes; snapshot maintenance and threshold compaction requests are
  full-mode only (completion-trigger task-complete requests still flow
  in trim-only).
- `packages/opencode-v2/src/index.ts` — engine stand-down (setup +
  deferred) skipped in trim-only; compaction hook and per-session
  recall/search register in full mode only; read_omitted, prune, and
  the engine-independent cross-session tools register in both. All
  mode checks go through `isFullContextMode`.
- `packages/opencode-v2/src/tool.ts` — comment only: documents that
  `CONTEXT_MANAGEMENT_TOOL_NAMES` is the full-mode set and trim-only
  registers a subset, with removal of never-registered names a no-op.

Tests:

- `packages/opencode-v2/test/context-config.test.ts` — full block now
  expects `mode`, invalid mode rejected, trim-only accepted, default
  is full.
- `packages/opencode-v2/test/context.test.ts` — trim-only trims with
  omission notice, writes a trim receipt, but writes no snapshot and
  never requests compaction.
- `packages/opencode-v2/test/index.test.ts` — trim-only partitions
  registration with an engine listed (no stand-down toast, no
  compaction hook, omission + cross-session tools only); invalid mode
  toasts naming the option path and leaves the feature disabled.
- `packages/opencode-v2/test/compaction.test.ts`,
  `packages/opencode-v2/test/events.test.ts` — config literals gain
  `mode: "full"` (no behavior change).

Docs (markdown-lint cadence):

- `.vcc-brain-shared/specs/opencode-v2/implementation.md` — trim-only
  mode paragraph (ownership partition, both modes' surfaces, loud
  invalid values).
- `docs/harnesses/opencode-v2.md` — `mode` key in the option reference.
- `.dev-framework/review.md` — this file, rewritten fresh.

## Cadence applied

- pattern-guardian: full pass on the delta — no blocking; two
  should-fix items, both resolved (single `isFullContextMode` helper
  used at all four branch sites; tool-subset documented against the
  removal constant). Report otherwise reused unchanged.
- style-enforcer: full pass — no blocking; two should-fix items, both
  resolved (`rawMode` renamed to `mode` matching sibling locals;
  lengthened setup condition wrapped with leading `&&`).
- code-reviewer: full pass — no blocking; one should-fix, resolved
  (invalid-mode path now has a test proving the toast fires and the
  feature stays off). Verified snapshot/request gating order,
  completion-trigger flow in trim-only, hook/tool registration per
  mode, and project-config merge carrying `mode`.
- test-grounder evidence: `git stash` of the four source files with
  new tests in place → 5 failures on old sources (3 config, 1
  context, 1 index), all other tests passing; `git stash pop`
  restores; `bun run check packages/opencode-v2` green (20 files,
  191 tests); `bun run check packages/core` green (177 tests).
- Docs cadence: `bun run lint:md` (markdownlint-cli2, 116 files) — 0
  issues, PASS.

## Findings and resolutions

1. (pattern) `fullMode` predicate in four places — resolved with
   `isFullContextMode` in `context-config.ts`, used in `context.ts`
   and all three `index.ts` sites.
2. (pattern) trim-only tool subset vs removal constant — resolved with
   a comment on `CONTEXT_MANAGEMENT_TOOL_NAMES` stating the full-mode
   scope and the trim-only subset.
3. (style) `rawMode` naming — renamed to `mode`.
4. (correctness) invalid mode toast untested — new test asserts the
   error toast names the option path and only the preamble hook
   registers.
5. Post-review formatter reflow (2 files) — re-ran the package gate
   on the final tree: green.

No blocking findings remain. Review complete.
