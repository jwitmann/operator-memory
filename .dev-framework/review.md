# Review — observation-engine spec v4 (this session)

## Scope — every changed file

- `docs/dev/observation-engine.md` — `ef3e72f`: new `## Proposal-flow
  spec (draft v4, NEXT BUILD)` replacing automation with conversation
  (agent offers in-flow with the canonical "permanent rule" shape, user
  agrees on the spot): agent-discretion trigger with 3-line rubric,
  question-tool proposal with evaporating declines (context window as
  dedup), surviving §5 storage half, explicit non-goals with re-entry
  condition (manual volume triggers detection automation), one-per-session
  nag norm; v3 demoted to PARKED (preserved, with revival condition);
  status line updated. No lint violations introduced.
- `.dev-framework/review.md` — this artifact, rewritten fresh for this session.

No product code, no tooling, no config. Additive section + header/status
demotions; no anchor impact.

## Findings and resolutions

- **markdownlint (docs cadence, the entire battery per scope rule):**
  `bun run lint:md` → 129 files, **0 issues**, run after the final edit
  and before commit.
- **Commit gate:** pre-commit per-package checks passed on `ef3e72f`.
  Full root `bun run check` green on the parent tree; docs-only delta.
- **No specialists required:** docs-only change per the scope rule.
  No prior specialist scope invalidated.
- **Content diligence (author-performed):** v4 is a scope reduction
  driven by user direction (conversational proposing), not new claims —
  every retained mechanism (storage, kind/scope, project-bar, secrets,
  subordinate rendering) is carried over verbatim from reviewed v3 text;
  v3 preserved intact below the parked marker (no silent deletion).

## Verification (final tree)

- `bun run lint:md` — exit 0, "Summary: 0 issues in 0 files".
- Changed files are exactly the two above; tree otherwise clean.
- Committed locally as `ef3e72f` (pre-commit gates passed).
