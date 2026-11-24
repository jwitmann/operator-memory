# Review — docs(recall): peer declaration in README and getting-started

Scope: docs-only. No product code changed.
Files: `README.md`, `docs/getting-started.md`.

## Change
- README recall bullet now names the mechanism (declare in `.vcc-brain/config.json`, mutual-or-nothing).
- getting-started "Past sessions are searchable" gains the JSON snippet plus the mutuality rule, mirroring the harness pages.

## Cadence (docs-only)
- `bun run lint:md`: 0 issues in 135 files. Pass.
- Specialists not run: no product code in scope; per gate, lint:md is the entire docs cadence.

## Findings
- None. Prose mirrors the already-reviewed harness sections verbatim in contract (mutual-or-nothing, config path, snippet shape).
