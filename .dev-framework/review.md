# Review — observation-engine spec v4 + verification fixes (this session)

## Scope — every changed file

- `docs/dev/observation-engine.md` — two commits: `ef3e72f` (v4
  conversational proposing spec, v3 parked: agent-discretion rubric,
  question-tool proposal, evaporating declines, surviving storage half,
  non-goals with re-entry condition, nag norm, status line) and
  `4e61077` (verification findings fixed: rubric location
  `~/.operator/user/operator.md`; observations surface canonical path +
  explicit Core loading contract — current loader reads only
  `operator.md`/`catalog.md`, so the build must extend loader/preamble/
  fingerprint/render fail-closed and subordinate; project destination
  `.operator/operator.md`; v4-local `observation` switch default-OFF with
  load-independent semantics; host tool names; dedup claim softened for
  compaction).
- `.dev-framework/review.md` — this artifact, rewritten fresh for this session.

No product code, no tooling, no config. Additive/rewritten sections only;
no anchor impact.

## Findings and resolutions

- **markdownlint (docs cadence, the entire battery per scope rule):**
  `bun run lint:md` → 129 files, **0 issues**, run after the final edit
  and before each commit.
- **Commit gates:** pre-commit per-package checks passed on both commits.
  Full root `bun run check` green on the parent tree; docs-only delta.
- **No specialists required:** docs-only change per the scope rule.
  The narrow verification review (3 blocking: rubric partition,
  observations loading, switch semantics; 1 note: compaction/dedup
  wording) was consumed — all fixed in `4e61077`, mapped above.
  No prior specialist scope invalidated.
- **Content diligence (author-performed):** loading claim grounded in the
  cited `packages/core/src/memory/user.ts:45-66` behavior; host tools
  verified by the reviewer against real host sources
  (`opencode/.../question.ts`, `deepseek-harness/.../tool-ask-user`);
  storage destinations chosen to be already-loaded surfaces, not new
  file types, wherever possible.

## Verification (final tree)

- `bun run lint:md` — exit 0, "Summary: 0 issues in 0 files".
- Changed files are exactly the two above; tree otherwise clean.
- Committed locally as `ef3e72f` (v4) + `4e61077` (fixes);
  pre-commit gates passed on both.
