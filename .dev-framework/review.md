# Review — docs(readme): native OpenCode plugin setup on landing page

Scope: docs-only, one file. The npm editorial flag asks for an OpenCode
plugin configuration or local plugin installation example in README.md —
the root landing page, not a package README. The root install table only
showed the Helper route.
This session's changed files:
Edited: `README.md` (native OpenCode plugin block under the harness
table: `opencode plugin add`, `opencode.json` string form, options-object
form with the real `vcc-brain.contextManagement` block, local `dist`
directory install).
This artifact: `.dev-framework/review.md`.

## Change

- Root README now carries the plugin configuration example directly, so
  the flagged README contains it. Reverted an uncommitted wrong-guess
  edit to `packages/opencode-v2/README.md` — left the tree untouched
  there.

## Battery (docs cadence)

- `bun run lint:md` (repo config, 116 files): 0 issues, exit 0. Docs-only
  change — no product code touched; no specialists required, none run.
- Per-commit hook on this commit: core 177 + opencode-v2 174 tests green.

## Findings

- None blocking. The editorial notice clears on human re-review, not on
  commit or publish.
