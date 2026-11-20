# Review — observation-engine confound notes (this session)

## Scope — every changed file

- `docs/dev/observation-engine.md` — two commits: `7cfaff2`
  (calibration-confound note: monthly correction trend, three
  indistinguishable forces, corrections-are-now-novel-work-repair finding,
  calibration-expiry consequence for any v3 revival) and `f3f9991`
  (fourth force: model evolution). No design changes; evidence
  qualification only.
- `.dev-framework/review.md` — this artifact, rewritten fresh for this session.

No product code, no tooling, no config. Additive paragraph + one-line
amendment; no headings renamed; no anchor impact.

## Findings and resolutions

- **markdownlint (docs cadence, the entire battery per scope rule):**
  `bun run lint:md` → 129 files, **0 issues**, run after the final edit
  and before each commit.
- **Commit gates:** pre-commit per-package checks passed on both commits.
  Full root `bun run check` green on the parent tree; docs-only delta.
- **No specialists required:** docs-only change per the scope rule.
  The monthly trend numbers come from a re-run of the existing pilot
  scratch script over the same corpus (no new method); the confound
  reading (workload character over tooling era) is author judgment
  recorded as such, with the raw monthly table present for re-analysis.
  No prior specialist scope invalidated.
- **Content diligence (author-performed):** no claim exceeds the data —
  the trend is reported as confounded rather than explained; the design
  consequence (calibration expiry, manual-flow justification) follows
  without inventing attribution the numbers cannot support.

## Verification (final tree)

- `bun run lint:md` — exit 0, "Summary: 0 issues in 0 files".
- Changed files are exactly the two above; tree otherwise clean.
- Committed locally as `7cfaff2` + `f3f9991` (pre-commit gates passed).
