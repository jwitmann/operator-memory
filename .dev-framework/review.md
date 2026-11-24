# Review — docs(readme): drop shipped observation engine from roadmap

Scope: docs-only. No product code changed.
Files: `README.md`, `.dev-framework/review.md` (this artifact).

## Change

- Removed the Observation Engine bullet from the README Roadmap
  section. The engine shipped (core `observations.md` loading and
  preamble rendering, helper `user-init` rubric template, public
  coverage in getting-started and architecture, pilot tally logged),
  so listing it as future work was false. The section keeps its
  header and intro sentence; no replacement bullet — the deferred
  items in `decisions.md` are tripwire-gated, not promises.

## Cadence (docs-only)

- `bun run lint:md`: 0 issues in 135 files. Pass.
- Specialists not run: two-line deletion, no product code in scope;
  per gate, lint:md is the entire docs cadence.

## Findings

- None.
