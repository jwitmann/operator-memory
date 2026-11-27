# Peer Review — rename context mode to `"vcc"` (2026-11-27)

## Scope

This session renames the unreleased context-management mode from `"trim-only"` to `"vcc"`, with no compatibility alias. It also clarifies the OpenCode ownership split and corrects documentation contradictions found during review.

Changed files:

- `packages/opencode-v2/src/context-config.ts` — mode union and validation accept `"full"` and `"vcc"`; comments updated.
- `packages/opencode-v2/src/context.ts` — `"vcc"` comments now distinguish suppressed threshold compaction calls from retained end-of-run calls.
- `packages/opencode-v2/src/index.ts` — mode coexistence comments updated.
- `packages/opencode-v2/src/tool.ts` — full-mode removal-set comment identifies the `"vcc"` subset.
- `packages/opencode-v2/test/context-config.test.ts` — accepts `"vcc"`, retains `"full"` default, and uses a neutral result variable.
- `packages/opencode-v2/test/context.test.ts` — mode value and test name cover no snapshot or threshold compaction requests in `"vcc"` mode.
- `packages/opencode-v2/test/index.test.ts` — external-engine ownership-partition test uses `"vcc"`.
- `.vcc-brain-shared/specs/opencode-v2/implementation.md` — coexistence contract names full mode versus supported `"vcc"` coexistence, and distinguishes threshold from task-complete calls.
- `README.md` — the Context Management bullet uses “with built-in fallback” and states the OpenCode-specific full/`"vcc"` ownership mapping; the example and pairing section name `"vcc"` coexistence.
- `docs/harnesses/opencode-v2.md` — setup guidance qualifies full mode; the overview separates trim from full-mode snapshot recall and compaction override; trigger and option text matches actual call behavior.
- `.dev-framework/review.md` — this review, rewritten fresh for this session.

The untracked local `.vcc-brain/config.json` was also changed to `"mode": "vcc"` so this checkout does not fail validation after restart; it is not part of the repository diff.

## Review cadence and findings

- **style-enforcer:** found contradictory coexistence guidance, a stale `trimmed` test variable, and unformatted code values. All were corrected; targeted re-review found no remaining style issues.
- **pattern-guardian:** found that documentation implied threshold compaction calls remained active in `"vcc"` mode and that setup guidance contradicted coexistence. It later caught adapter-neutral README wording, an unconditional snapshot/override description, and an overbroad test name. All were corrected; targeted re-review found no remaining blockers.
- **code-reviewer:** found no correctness defects. It identified the misleading “compaction requests are never ours” comment, which was corrected to distinguish threshold and completion calls; targeted re-review confirmed the behavior matches the gating.
- **test-grounder:** temporarily restored the four pre-rename source files. The focused suite then failed exactly two tests: config parsing rejected `"vcc"`, and setup did not register the expected ownership-partition hooks. The rename was restored with `git stash pop`; the same tests pass in the final tree. A repository-wide search found no `trim-only`, `trim_only`, or `trimOnly` remnants.

No blocking or should-fix findings remain.

## Verification on the final tree

- `bun run check packages/opencode-v2` — 20 files, 191 tests passed; format, lint, and typecheck passed.
- `bun run check` — 69 files, 623 tests passed; workspace format, lint, typecheck, and Markdown lint passed.
- Repository-wide old-mode search — no matches.
