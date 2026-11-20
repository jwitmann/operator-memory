# Review — observation-engine v4 re-read fixes (this session)

## Scope — every changed file

- `docs/dev/observation-engine.md` — `827befe`: careful re-read pass
  over the v4 spec, 8 over-claim/under-specify fixes, no design changes:
  §3 retitled (was pointing at a wrong-draft section number); rubric
  distribution made prescriptive (ships in user-init template, picked up
  by memory-aware loop) instead of stated-as-fact; "visibly before"
  replaced (agents can't see previous sessions) with in-session-or-stated-
  pattern; approval record shape specified (appended
  `- [YYYY-MM-DD] (scope:user) text` line); project destination narrowed
  to an `## Observations` heading inside `.operator/operator.md`
  (separation preserved structurally, loading free); render order
  defers to the preamble's existing layer order (was asserting an
  unverified order); stale-flag replaced with conversational drift
  catch (no background machinery in v4); re-entry condition grounded in
  the observations file as its own record (was requiring pipeline
  metrics from a spec with no pipeline); config key located in the
  user-partition config with shared fail-closed vocabulary.
- `.dev-framework/review.md` — this artifact, rewritten fresh for this session.

No product code, no tooling, no config. No headings renamed; no anchor impact.

## Findings and resolutions

- **markdownlint (docs cadence, the entire battery per scope rule):**
  `bun run lint:md` → 129 files, **0 issues**, run after the final edit
  and before commit.
- **Commit gate:** pre-commit per-package checks passed on `827befe`.
  Full root `bun run check` green on the parent tree; docs-only delta.
- **No specialists required:** docs-only change per the scope rule.
  The re-read was author-performed against the verification report and
  the v3 text; every fix is traceable to a concrete over-claim
  (unverifiable order, nonexistent cross-session visibility, missing
  write shape, blurred separation, phantom pipeline metrics).
  No prior specialist scope invalidated.
- **Content diligence (author-performed):** each fix narrows the spec
  toward what is buildable/verifiable rather than adding content;
  the narrow verification's "build-ready" verdict is preserved (fixes
  are precision, not structure).

## Verification (final tree)

- `bun run lint:md` — exit 0, "Summary: 0 issues in 0 files".
- Changed files are exactly the two above; tree otherwise clean.
- Committed locally as `827befe` (pre-commit gates passed).
