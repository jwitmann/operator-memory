# Review — index-staleness spec, post-review revision (this session)

## Scope — every changed file

Docs-only revision of yesterday's new spec, driven by two review passes.
No product code, no templates, no tests touched:

- `.operator-shared/specs/index-staleness.md` — rewritten to pin the 9
  blocking precision items from the feasibility review plus the spec-quality
  notes: stamp completeness rule (`tree_hash` drives the preamble nudge,
  full-triple completeness enforced by lint), normative hash construction
  (UTF-8, `/`-joined, code-unit sorted, `\n`-joined, no trailing newline,
  empty-set rule, links never followed), one project-wide hash stamped into
  each main index, git probing with silent walk fallback and erroring genuine
  failures, closed walk ignore set, `stamped_commit` sourcing, textual-splice
  YAML approach, fixed drift message template with cap 10, tests split by
  package, and an Implementation surface section (including `preamble.md` as
  a touched file). Unwrapped to sibling long-line style per the hard-wrap
  rule; fixed a stray-backtick MD038 violation.
- `.operator-shared/catalog.md` — unchanged this session (entry from the
  prior commit stands as approved).
- `.dev-framework/review.md` — this artifact, rewritten fresh.

## Findings and resolutions

- **Design review, feasibility (subagent, this session): CHANGES REQUESTED
  → all 9 resolved.** Verified clean as-is: additive frontmatter, exit-0
  warning semantics, CLI dispatch shape, I/O-free preamble read of loaded
  bodies, guide slot, no `commands.md` conflict, mtime fingerprint
  unaffected. The 9 blocking precision items (preamble parse approach,
  hash construction, per-partition scope, git ownership/failures, closed
  ignore set, commit sourcing, YAML splice, message template + cap, test
  split) are each pinned in the revised spec — resolutions summarized in
  Scope above. Two notes: `commands.md` one-liner deferred to implementation;
  Phase 8 handoff confirmed against the project-init template (hands off to
  `index init` + guide, which owns the stamp step).
- **Design review, spec quality (subagent, this session): APPROVED WITH
  NOTES → all applied.** Hard-wrap fixed (unwrapped); `stamped_at` /
  `stamped_commit` / ignore-set / cap pinned (overlaps the feasibility
  items); two-sources-of-truth resolved by authority rule (normative
  behavior here, `preamble.md` gains a deferring warnings entry);
  upstream-idea hygiene passed with no action.
- **Docs cadence:** `bun run lint:md` — 135 files, 0 issues (exit 0), run
  after the final revision; one MD038 caught and fixed in the pass.
- **Prior reports reused unchanged:** the `9331e05` template-port battery
  stands — none of those files touched.

## Verification (final tree)

- `bun run lint:md` — exit 0, 0 issues (135 files).
- Committed locally; nothing pushed.
