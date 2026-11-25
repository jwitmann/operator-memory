# Review — docs(readme): install headings + per-harness subheadings

Scope: docs-only. Restructures the root Installation area: a "Using
npm (recommended)" section with help, plus direct (no-Helper) installs for OpenCode,
DeepSeek Harness, and Pi. Every command verified against its source —
nothing invented. The live OpenCode verification from earlier this
session used scratch files outside the repo; they are named below and
were deleted after use.
This session's changed files:
Edited and committed: `README.md` (`vcc-brain-helper --help` hint; new
"Direct harness installs (no Helper)" subsection with per-harness
`#####` subheadings plus a `#### Setup` heading for the follow-up steps: OpenCode hand
registration incl. options-object configuration and local `dist`
install, `dsh plugin --profile <profile-name> add
@jwitmann/vcc-brain-deepseek`, `pi install npm:@jwitmann/vcc-brain-pi`).
Verification scratch, created during live OpenCode boot tests and
deleted afterwards (all under `/tmp/vcc-install-test/`, none in the
repo, none committed): `opencode.json` (README config verbatim),
`serve-npm.log`, `serve2.log`, `serve-debug.log`, `tui-local.log`.
This artifact: `.dev-framework/review.md`.

## Change

- OpenCode block kept (gold-mirror shape, live-verified line intact),
  nested under the new heading.
- DeepSeek direct command verbatim from `docs/harnesses/deepseek.md`;
  package name confirmed in `packages/deepseek/package.json`.
- Pi direct command is the exact command the Helper shells
  (`packages/helper/src/commands/install/pi.ts`); package name
  confirmed in `packages/pi/package.json`.
- Codex/Claude Code stay Helper-only (marketplace flows, no one-line
  direct route) — no invented commands.
- Scratch logs proved the local-`dist` route boots green on OpenCode
  `v2.4.1` (plugin count 14→15, footer `Ready (Local Build)`), then
  were removed; they were evidence, not deliverables.

## Battery (docs cadence)

- `bun run lint:md` (repo config, 116 files): 0 issues, exit 0. Docs-only
  change — no product code touched; no specialists required, none run.
- `vcc-brain-helper --help` executed; output matches the documented
  command set. Live server/TUI boots executed for the OpenCode routes.

## Findings

- None blocking. The npm editorial notice still clears on human
  re-review, not on commit or publish.
