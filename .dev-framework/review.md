# Review — index-staleness detection spec (this session)

## Scope — every changed file

Docs-only: a new system contract plus its catalog entry. No product code,
no templates, no tests touched:

- `.operator-shared/specs/index-staleness.md` — new spec: stamp fields
  (`tree_hash`, `stamped_at`, `stamped_commit`), structural-hash definition
  (SHA-256 over sorted relative paths; edits invisible, add/remove/rename
  visible), covered file set (`git ls-files` preferred, fixed-ignore walk
  fallback, brain partitions and `.git` always excluded), Helper `index stamp`
  / `index lint` behavior with warning-level (exit-0) drift findings,
  preamble limits (unstamped-nudge only, no per-prompt tree hashing),
  test plan, and non-goals.
- `.operator-shared/catalog.md` — catalog entry for the new spec
  (Description + Read If), placed after `commands.md` in the `specs/` section.
- `.dev-framework/review.md` — this artifact, rewritten fresh.

## Findings and resolutions

No specialists required: docs-only changes get the docs cadence in full.

- **Docs cadence:** `bun run lint:md` — 135 files, 0 issues in 0 files
  (exit 0, run after both files were final, before commit). Covers the new
  spec's Markdown (H1 title + `##` sections matching neighbor spec files,
  backticked code spans, no tables, no hard-wrap) and the catalog entry
  shape (Description / Read If bullets matching adjacent entries).
- **Self-review of contract coherence** (no product code to ground, so
  checked by reading, not tests): stamp fields are additive to the
  already-required frontmatter (`description`, `read_if`) — no conflict with
  `lint.ts` `readMetadata`, which ignores unknown fields; warning-level
  drift findings fit the existing `LintFinding.error: boolean` channel and
  keep `indexLint` exit-0 semantics; the "no per-prompt hashing" limit is
  consistent with the cold-prompt-cache cost rule; the self-staling
  exclusion (brain partitions out of the file set) is stated explicitly.
  No blocking issues.
- **Prior reports reused unchanged:** the `9331e05` template-port battery
  (style-enforcer CLEAN, pattern-guardian NO DRIFT, code-reviewer NO BLOCKING
  ISSUES, test-grounder GROUNDED) stands — none of those files were touched
  this session, nothing re-run.

## Verification (final tree)

- `bun run lint:md` — exit 0, 0 issues (135 files).
- Committed locally (`1a2a6c2` spec + follow-up review commit); nothing pushed.
