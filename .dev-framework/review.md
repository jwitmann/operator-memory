# Review — observation-engine rubric extension (this session)

## Scope — every changed file

- `docs/dev/observation-engine.md` — one commit: `d50780a`
  (v4 §1 rubric gains a fourth trigger: agent-proposed process/tool
  improvements, with its own higher bar — visible repetition ≥3 or
  stated-as-pattern, concrete reversibility, workflow-only, product
  ideas out of scope).
- `.dev-framework/review.md` — this artifact, rewritten fresh for this session.

No product code, no tooling, no config. Eight added lines in the rubric;
no headings renamed; no anchor impact.

## Findings and resolutions

- **markdownlint (docs cadence, the entire battery per scope rule):**
  `bun run lint:md` → 129 files, **0 issues**, run on the final tree.
- **Commit gate:** pre-commit per-package checks passed on the commit.
  Full root `bun run check` green on the parent tree; docs-only delta.
- **No specialists required:** docs-only change per the scope rule.
  The extension is author-and-user judgment (descriptive vs prescriptive
  claim types, miss-cost reasoning), not a code delta; no prior
  specialist scope invalidated.
- **Self-review note:** the extension was user-proposed ("propose
  improvements as new process or even tools"), author-shaped (higher bar
  for prescriptions), user-tacit-approved by continuation. The brief now
  records a fourth trigger the v4 flow must honor at build time.

## Verification (final tree)

- `bun run lint:md` — exit 0, "Summary: 0 issues in 0 files".
- Changed files are exactly the two above; tree otherwise clean.
- Committed locally as `d50780a` (pre-commit gates passed).
