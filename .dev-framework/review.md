# Review — observation-engine spec v2 (this session)

## Scope — every changed file

- `docs/dev/observation-engine.md` — `cf8da07`: `## Proposal-flow spec`
  rewritten as draft v2 (supersedes v1), systematically addressing the
  11-blocking-findings red-team: new `### 0. Detector v0.1` (14 correction
  and 13 recall patterns in-spec, one-boolean-per-class semantics,
  span-level paste hygiene, ≥3-message eligibility, replayed cohort:
  584 eligible → 23-session trigger, hand-label verdict ~3–5 durable /
  session precision ≈15–20%, 5 adversarial cases); `§1` honest machinery
  inventory (no session-end hook/receipt exists; new vs reused enumerated);
  `§2` drafting-input sanitization as prompt-injection boundary;
  `§3` per-project era ownership, atomic claim/idempotent drafting,
  crash reconciliation, caps + oldest-first deferral (per-era replay
  impossible, stated); `§4` bounded escalation (next-interaction delivery,
  exactly-once outbox, one-per-session, cooldown, snooze) + bounded
  rejection (permanent vs snooze, deterministic identity, capped
  retention); `§5` kind/scope declarations, project-bar, promotion≠
  replacement, secrets exclusion, subordinate surface, revalidation,
  recorded LLM limits; `§6` denominator metrics (retired copies, min
  sample with DECIDE N); `§7` OFF retention table + selection-bias
  statement; `§3` corpus reconciliation note (197k all-roles then vs
  28,239 user-role now). Three DECIDEs marked (escalation keep/cut,
  min-sample N, 15–20% precision worth drafting).
- `.dev-framework/review.md` — this artifact, rewritten fresh for this session.

No product code, no tooling, no config. One `+`-continuation lint fix
inside the new section (self-caught pre-commit).

## Findings and resolutions

- **markdownlint (docs cadence, the entire battery per scope rule):**
  `bun run lint:md` → 129 files, **0 issues**, run after the final edit
  and before commit.
- **Commit gate:** pre-commit per-package checks passed on `cf8da07`.
  Full root `bun run check` green on the parent tree; docs-only delta.
- **No specialists required:** docs-only change per the scope rule
  (the red-team that drove v2 was a design review on the new model,
  already consumed — its 12 findings are the v2 requirements above).
  No prior specialist scope invalidated.
- **Content diligence (author-performed):** detector replay actually
  re-ran (`detector.ts` + `label.ts` scratch, 23-session cohort
  hand-read); numbers in-spec match script output; corpus reconciliation
  verified against live SQLite counts (385,064 rows / 28,586 user-role);
  no red-team finding left unmapped (each v2 section cites its own).

## Verification (final tree)

- `bun run lint:md` — exit 0, "Summary: 0 issues in 0 files".
- Changed files are exactly the two above; tree otherwise clean.
- Committed locally as `cf8da07` (pre-commit gates passed).
