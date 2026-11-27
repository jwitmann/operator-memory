# Peer Review — one compaction provider per session (2026-11-27)

## Scope

This session changed 15 files: product code + tests in `packages/opencode-v2`,
three shared/private spec and working-state docs, and this artifact.

Product code (full battery):

- `packages/opencode-v2/src/compaction-compiler.ts` — `toCompilerNode`
  now maps user messages carrying both `<compacted-checkpoint>` tags to
  `compact-checkpoint` nodes (tag-pair required; single-tag prose excluded).
- `packages/opencode-v2/src/compaction-snapshot.ts` — new
  `findForeignCheckpointHeader` (foreign `-compaction` header recognition
  with revision-and-colon tail; own `[vcc-compaction …]` prefix excluded).
- `packages/opencode-v2/src/tool.ts` — `vcc-brain-recall` hands
  foreign-header checkpoints to the owning engine's recall tool instead of
  reporting zero checkpoints; new `CONTEXT_MANAGEMENT_TOOL_NAMES` export
  (the 4 session-scoped tools stand-down removes; cross-session tools stay).
- `packages/opencode-v2/src/provider-detect.ts` — new module: pure
  `detectExternalCompactionProvider` (exact foreign tool names
  `vcc-recall`/`vcc-search`, plugin id / local path `opencode-vcc-port`;
  fail-closed null) plus best-effort async `findExternalCompactionProvider`
  over `context.plugin.list()` / `context.tool.list()`.
- `packages/opencode-v2/src/index.ts` — setup-time auto-stand-down of
  `contextManagement` on external-engine detection (warning toast;
  preamble/refresh/brain-updates stay on); deferred one-shot re-check on
  first session activity (flips `standDown`, removes the 4 session tools,
  toasts); enforcement hooks gate on `isActive()` (generation AND
  stand-down) while preamble/refresh/brain-updates keep raw `isCurrent()`.

Tests (same battery):

- `packages/opencode-v2/test/compaction-compiler.test.ts` — tagged
  checkpoint node test + single-tag prose negative test.
- `packages/opencode-v2/test/compaction-snapshot.test.ts` — ordinal
  recall over a tagged checkpoint; foreign/own/plain/prose header cases.
- `packages/opencode-v2/test/tool.test.ts` — foreign-checkpoint handoff
  test; session-tool-names match the stand-down removal list.
- `packages/opencode-v2/test/index.test.ts` — setup-time stand-down
  test; late-engine deferred stand-down test (removal + toast + one-shot).
- `packages/opencode-v2/test/provider-detect.test.ts` — new: tool-name,
  plugin-id/path signals; fail-closed without list APIs; host listing read.

Docs (markdown-lint cadence):

- `.vcc-brain-shared/specs/opencode-v2/implementation.md` — new "One
  Compaction Provider Per Session" subsection (`Last Updated` Nov 27).
- `docs/harnesses/opencode-v2.md` — new "One compaction provider per
  session" note under Context Management prerequisites (same rule,
  user-facing wording; added after the audit found the user docs
  silent on coexistence). The intro line and the Context Management
  lead now frame the in-tree engine as the built-in fallback from
  before a standalone engine existed, pointing at the standalone
  `opencode-vcc-compaction` engine as the preference.
- `README.md` — OpenCode options example now shows
  `"enabled": false` with a comment pointing at the one-provider rule,
  instead of a copy-pasteable `"enabled": true` (the old example nudged
  every reader toward the riskiest setting). The "best long-session
  results" block is promoted from an H4 under Setup to its own H3
  ("Pair VCC Brain with deterministic compaction (Recommended)"), the
  cold-start paragraph moved back under Setup, and the OpenCode bullet
  now states the mutual exclusion (disable ours when the external
  engine owns compaction). The Deterministic Context Management
  feature bullet drops the redundant "Brain-gated" and separates the
  two concepts: ours is trim plus snapshot recall plus shaping (the
  built-in fallback), not the VCC deterministic engine — which runs
  under its own configuration where installed. Same correction in
  the harness doc lead (in-tree port named as a fallback subset).
  The single "Deterministic Context Management" bullet is then split
  in two (the shaped fallback can use model judgment, so the old
  title was false): "Deterministic Compaction (Recommended)" for the
  standalone engine, "Context Management (built-in fallback)" for
  ours, off by default and not recommended where the engine runs.
  Full-README coherence re-read: pronoun fix (their→its), Origin line
  drops the conflated phrase, example comment tightened, OpenCode
  engine bullet restructured (install command before the disable
  instruction it previously dangled after), mid-sentence capital
  fixed; "deterministic context management" also removed from
  getting-started and the Pi spec.
- `.vcc-brain-shared/specs/reference/implementation.md` — cross-cutting
  resume/fork rule with cheapest-first retention proofs (earlier this
  session; covered by the 2026-11-26 review, re-listed for completeness).
- `.vcc-brain-shared/specs/codex/implementation.md` — `Last Updated`
  Nov 26; resume/fork known-gap statement (same prior cover).
- `.vcc-brain/specs/working-state.md` — 2026-11-27 entry: dual-stack
  diagnosis, change summary, gate result.
- `.vcc-brain-shared/specs/pi/implementation.md` — "deterministic
  context management" shortened to "context management" (same
  terminology correction; Tier 2 scope unchanged).
- `docs/getting-started.md` — same one-word correction in the
  project-init feature mention.
- `.dev-framework/review.md` — this file, rewritten fresh.

## Cadence applied

- style-enforcer: full pass on the change (clean except one import-order
  nit in `index.ts` — fixed and verified), then delta re-run on the
  post-review fixes (import reorder, regex+comment, two new tests) —
  clean, no action required.
- pattern-guardian: full pass — no duplication/divergence; one
  should-fix (removal-list literal duplication) resolved by the new
  drift-guard test; report otherwise reused (scope unchanged since).
- code-reviewer: full pass — no blocking findings; one should-fix
  (header-regex over-match on prose) resolved by the revision-and-colon
  anchor; delta re-run verified both real headers match, prose shapes
  rejected, no ReDoS, own-prefix exclusion intact. Tag-pair
  false-positive accepted as deliberate and documented.
- test-grounder evidence: `git stash` of the four source files with new
  tests in place → tagged-checkpoint test and both snapshot ordinal
  tests fail on old code; `git stash pop` restores; full gates pass
  (see below). `bun run check packages/opencode-v2` green (20 files,
  187 tests); `bun run check packages/core` green (177 tests);
  `bun run check` root green (69 files, 619 tests).
- Docs cadence: `bun run lint:md` (markdownlint-cli2, 116 files) — 0
  issues, PASS.

## Findings and resolutions

1. (style) `provider-detect` import out of alphabetical order — fixed
   (moved after `project-config`), verified by delta re-run.
2. (pattern) `CONTEXT_MANAGEMENT_TOOL_NAMES` vs inline `name:` literals
   drift risk — resolved with the "session tool names match the
   stand-down removal list" test (fails on missing/renamed/extra/
   reordered registration); passing.
3. (correctness) foreign-header regex over-matched bracketed prose —
   resolved by requiring revision-and-colon tail; both real engine
   headers still match; prose shapes rejected; verified by delta
   re-run plus the new `[post-compaction review]` negative test.
4. (correctness, accepted) user text quoting both tags counts as a
   checkpoint — deliberate, documented in code comment; quoting both
   tags in ordinary prose is unlikely, and the alternative is the
   original blindness. No action.
5. (style note, no action) spread copy in the drift-guard assertion is
   redundant but harmless; mock style matches file conventions.

No blocking findings remain. Review complete.
