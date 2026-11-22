# Review — partial port of upstream #71, patches 1-3 slices (this session)

## Scope — every changed file

Surgical port of upstream `#71` (patches 1-3 wording only; auto-indexing, subagent
delegation, and index-command retirement stay parked). Product code = Helper seed
prose; docs = two shared files; tests = two new assertions blocks:

- `packages/helper/src/templates/project/operator.ts` — seed gains `Overview`
  (purpose/scope) and `Architecture` (components/boundaries) sections plus a
  `Build and verification commands` bullet. Verbatim upstream patch 2.
- `packages/helper/src/templates/project/setup.ts` — intro gains two paragraphs:
  rerun semantics (follow existing structure/policy, skip completed phases,
  report-don't-rebuild unasked) and harness-agnostic question-tool guidance
  (inline tool or equivalent regardless of name; direct chat for free-response).
  Recast to the guide's imperative voice; fork's Phase 6 `config.json` flow,
  Phase 7 Confirm, and Phase 8 index offer untouched.
- `packages/helper/test/templates.test.ts` — two new tests pinning the above,
  including heading-order assertions and the full report-don't-rebuild clause.
- `.operator-shared/operator.md` — declarative-wording style rule (verbatim
  upstream patch 1).
- `.operator-shared/specs/commands.md` — rerun sentence spliced into Project
  Setup beside the fork's `config.json` clause; `Last Updated` bumped.
- `.dev-framework/review.md` — this artifact, rewritten fresh.

## Findings and resolutions

- **style-enforcer (this session): CLEAN.** No doc/code style violations in the
  diff. Two nits, both accepted without change: (1) "Use direct chat always…"
  kept verbatim upstream rather than reworded — port fidelity wins over polish;
  (2) new `##` headings match the seed's pre-existing H2 pattern (a whole-family
  H2→H3 migration, if ever wanted, is out of scope for this diff).
- **pattern-guardian (this session): NO DRIFT.** `operator.md` line and
  `operator.ts` additions are character-identical to upstream; `setup.ts`
  recasts are justified fork adaptations (imperative voice, "sharing policy",
  dropped "checks integrity lightly" — meaning preserved). Every fork-specific
  sentence verified present and unmodified (`config.json` scaffold, Phase 6/7/8).
  No new helpers, modules, config keys, or dependencies. One note actioned: the
  commit message claimed "patches 1-2" but the rerun sentence derives from patch
  3 — message amended to "patches 1-3".
- **code-reviewer (this session): NO BLOCKING ISSUES.** Rerun sentence does not
  contradict Phase 1 Read-and-Repair (approval-gated; stale content already
  excluded there) or Phase 7 Confirm. Template interpolation intact; new seed
  matches the preamble's expectation that purpose/architecture overviews belong
  in `operator.md`. Spec claims verified against `setup.ts` phases and
  `project/init.ts` (`writeTextIfMissing`, Created-vs-Preserved gate). One note
  actioned: new tests strengthened with heading-order assertions and the full
  report-don't-rebuild clause (still all-`toContain` style, matching neighbors).
  Two notes declined with rationale: "stale or damaged" kept as upstream's
  wording; no `commands.md` line for the question-tool rule (spec omission, not
  inaccuracy).
- **test-grounder (this session, subagent): GROUNDED.** On commit tree: 6/6 pass;
  with `HEAD~1` templates restored: exactly the 2 new tests fail, 4 pre-existing
  pass; tree restored clean. Re-verified by lead after strengthening: 6/6 pass
  on new templates, 2-fail/4-pass on old templates — stronger assertions hold
  both directions.
- **Docs cadence:** `bun run lint:md` — 134 files, 0 issues. The two shared-doc
  edits are prose-only; specialist scope was the product-code templates, covered
  by the full battery above.

## Verification (final tree)

- `bun run check packages/helper` — 9 files, 87 tests pass.
- `bun run check` (root) — 63 files, 524 tests pass.
- `bun run lint:md` — exit 0, 0 issues.
- Fix committed locally (`9331e05`); nothing pushed.
