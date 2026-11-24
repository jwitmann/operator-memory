# Review — docs(readme): drop inherited blog and benchmark links

Scope: docs-only. No product code changed.
Files: `README.md`, `.dev-framework/review.md` (this artifact).

## Change

- Removed two lines under "VS Other Memory Plugins": the liao.gg blog
  link (someone else's post, inherited from the fork) and the
  `issues/48` benchmark-comment link (dead). The local
  `docs/comparison.md` link remains; the same blog URL stays cited
  inside `comparison.md` as an attributed external reference.

## Cadence (docs-only)

- `bun run lint:md`: 0 issues in 135 files. Pass.
- Specialists not run: two-line deletion of external links, no product
  code in scope; per gate, lint:md is the entire docs cadence.

## Findings

- None. No other `liao.gg` / `issues/48` links remain outside the
  attributed citation in `comparison.md` (verified by grep).
