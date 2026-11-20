# Review — observation-engine spec v3 (this session)

## Scope — every changed file

- `docs/dev/observation-engine.md` — `c1cda41`: `## Proposal-flow spec`
  rewritten as draft v3 (supersedes v2), closing the second-pass
  verification (6 partial + 3 new contradictions): exact 27-regex
  detector fence with boundary/apostrophe/wildcard semantics + shared
  text normalization + version-bump/re-replay rule; generalized
  shell-prompt marker with replay re-run (identical 23-session cohort);
  §1 receipts carry version+thresholds+denominators on every receipt;
  §2 fail-closed drafting allowlist (3 positive conditions, removed-never-
  labeled, quote-stripping) + adversarial acceptance with expected
  outcomes; §3 era lifecycle (per-project ownership, era-ids on all
  records, no-move fallback at 50 eligible sessions, foreground drafting
  trigger, claim lease session-end/4h with recovery, stable run-ids with
  persisted-result reuse replacing the v2 equality claim);
  snooze/consumption reconciled via standalone pending items; §4
  rejection key `(normalized, scope)`, 200-entry cap, escalation kept
  with numeric defaults (1 per 10 sessions, pending cap 5); §6 outcome
  accounting (edit=accepted, snooze=undecided, rejection reasons vs
  annoyance affordance), era attribution via recorded era-ids,
  segmentation by version AND thresholds, N=20, 25%-over-first-20
  pilot-gate; probe era-cadence question marked resolved; deferred list
  shrunk to genuinely open items. One `+`-continuation and one
  space-in-code-span lint self-catch fixed pre-commit.
- `.dev-framework/review.md` — this artifact, rewritten fresh for this session.

No product code, no tooling, no config. No headings renamed outside the
spec section's own versioning; no anchor impact.

## Findings and resolutions

- **markdownlint (docs cadence, the entire battery per scope rule):**
  `bun run lint:md` → 129 files, **0 issues**, run after the final edit
  and before commit. Two self-caught violations fixed pre-commit
  (MD004 `+` continuation, MD038 code-span space).
- **Commit gate:** pre-commit per-package checks passed on `c1cda41`.
  Full root `bun run check` green on the parent tree; docs-only delta.
- **No specialists required:** docs-only change per the scope rule
  (the verification that drove v3 was consumed design review, already
  folded into the v3 requirements above). No prior specialist scope
  invalidated.
- **Content diligence (author-performed):** replay re-ran against the
  generalized definition (identical cohort — reported honestly);
  every second-pass partial mapped to a v3 mechanism (frozen-vs-tunable
  split, snooze/consumption standalone items, era-ids on records);
  all three new contradictions addressed in-line; DECIDEs resolved as
  marked DEFAULTs with finite values.

## Verification (final tree)

- `bun run lint:md` — exit 0, "Summary: 0 issues in 0 files".
- Changed files are exactly the two above; tree otherwise clean.
- Committed locally as `c1cda41` (pre-commit gates passed).
