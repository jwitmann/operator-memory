# Review — docs(readme): badge row on repo landing page

Scope: docs-only, one file. This session added the gold-standard badge row
(npm version, Node 20+, BSD-3-Clause, CI) under the heading in the root
`README.md`, so the GitHub landing page shows the same maintenance signals
as the npm page (`packages/helper/README.md`, badged in an earlier commit).
This session's changed files:
Edited: `README.md` (badge row only, 2 insertions).
This artifact: `.dev-framework/review.md`.

## Change

- Root README now opens with the shields.io badge row mirroring
  `opencode-vcc-compaction` gold-standard shape: npm version (helper
  package), Node.js >= 20, BSD-3-Clause license (`./LICENSE`), CI workflow
  badge. No prose touched.

## Battery (docs cadence)

- `bun run lint:md` (repo config, 116 files): 0 issues, exit 0. Docs-only
  change — no product code touched; no specialists required, none run.

## Findings

- None blocking. Note: GitHub renders the new badges on push; npm is
  unaffected (it renders `packages/helper/README.md`).
