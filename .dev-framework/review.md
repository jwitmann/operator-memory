# Review — docs(helper-readme): OpenCode plugin evidence on the npm page

Scope: docs-only, one file. Answers the actionable half of the npm editorial flag on `@jwitmann/vcc-brain-helper` (v1.14.1) — the README example, now added (the "native evidence needs review" half is npm's editors to check, not fixable from here).
This session's changed files:
Edited: `packages/helper/README.md` (gold-standard badges + OpenCode plugin configuration + local install examples).
This artifact: `.dev-framework/review.md`.

## Change

- The npm page for the helper will now show a reader how the OpenCode adapter registers as a native plugin and how to configure it, instead of only the `vcc-brain-helper install` wrapper.

## Battery (docs cadence)

- `bun run lint:md` (repo config, 116 files): 0 issues, exit 0. No product code touched; no specialists required, none re-run.

## Findings

- None blocking. Note: the npm page refreshes on the next helper publish — this edit alone doesn't update what npm shows.
