# Review — docs(readme): hand OpenCode plugin setup mirroring gold Install

Scope: docs-only. The npm editorial flag asks for an OpenCode plugin
configuration or local plugin installation example in the GitHub
(root) README. Earlier attempts put it on package READMEs (wrong file)
and posted npm-command-only snippets (redundant with the Helper route,
neither configuration nor local). This change mirrors the gold-standard
Install section (`opencode-vcc-compaction#install`) part-for-part for
this adapter.
This session's changed files:
Edited: `README.md` (hand-registration block in Installation: `opencode
plugin add`, `opencode.json` string form, options-object form with the
real `vcc-brain.contextManagement` block, from-source clone + build +
local `dist` path).
Touched then fully reverted: `packages/opencode-v2/README.md` (a
misplaced "Native Plugin Setup" section; restored to HEAD, net zero —
see revert commit `2e7706f` for the earlier landing-page attempt).
This artifact: `.dev-framework/review.md`.

## Change

- Root README carries the complete hand-install shape: command, string
  form, configuration (options object), local path install. The options
  example uses the real `vcc-brain.contextManagement` block (verified
  against `packages/opencode-v2/src/options.ts` +
  `src/context-config.ts`); the local path matches the documented
  `<dir>/index.js` resolution and the package `main`
  (`packages/opencode-v2/dist`).

## Battery (docs cadence)

- `bun run lint:md` (repo config, 116 files): 0 issues, exit 0. Docs-only
  change — no product code touched; no specialists required, none run.

## Findings

- None blocking. The editorial notice clears on human re-review of the
  published page, not on commit or publish.
