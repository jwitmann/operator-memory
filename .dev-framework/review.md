# Review — observation-engine spec draft (this session)

## Scope — every changed file

- `docs/dev/observation-engine.md` — `76038c2`: status line
  exploration→spec-drafted (unapproved); new `## Proposal-flow spec`
  section: balanced trigger decision (per-session deterministic detection
  at session end with paste hygiene + receipt flags `CORRECTION_RICH` /
  `RECALL_HIT` at calibrated thresholds; era-boundary LLM proposal over
  the flagged cohort with topic identity, clause isolation, user-partition
  dedup, evidence pointers; batched question-tool approval with rejection
  memory; `RECALL_HIT` immediate escalation; user-partition storage with
  explicit-wins authority; default-OFF switch with frustration counter as
  health metric; kill criteria 1–2 as acceptance thresholds; deferred
  implementation details listed).
- `.dev-framework/review.md` — this artifact, rewritten fresh for this session.

No product code, no tooling, no config. Additive section only; no headings
renamed; no anchor impact.

## Findings and resolutions

- **markdownlint (docs cadence, the entire battery per scope rule):**
  `bun run lint:md` → 129 files, **0 issues**, run after the final edit
  and before commit. No violations introduced by the spec section.
- **Commit gate:** pre-commit per-package checks passed on `76038c2`.
  Full root `bun run check` green on the parent tree; docs-only delta.
- **No specialists required:** docs-only change per the scope rule.
  No prior specialist scope invalidated.
- **Content diligence (author-performed):** every spec element traces to
  a measured input — thresholds to the §4 calibration, escalation rarity
  (6 sessions) to the strict recall count, batching to the ~26-session
  cohort size, authority rule to the survey's market consensus, default-OFF
  to the house opt-in rule. Deferred items explicitly listed, not hidden.

## Verification (final tree)

- `bun run lint:md` — exit 0, "Summary: 0 issues in 0 files".
- Changed files are exactly the two above; tree otherwise clean.
- Committed locally as `76038c2` (pre-commit gates passed).
