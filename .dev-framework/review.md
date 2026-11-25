# Review — docs(readme): direct-install sections per harness

Scope: docs-only. Restructures the root Installation area per request:
an NPM section with help, plus direct (no-Helper) installs for
OpenCode, DeepSeek Harness, and Pi. Every command below is verified
against its source — nothing invented.
This session's changed files:
Edited: `README.md` (`vcc-brain-helper --help` hint; new "Direct
harness installs (no Helper)" subsection: OpenCode hand registration,
`dsh plugin --profile <profile-name> add @jwitmann/vcc-brain-deepseek`,
`pi install npm:@jwitmann/vcc-brain-pi`).
This artifact: `.dev-framework/review.md`.

## Change

- OpenCode block kept (gold-mirror shape, live-verified line intact),
  nested under the new heading.
- DeepSeek direct command taken verbatim from
  `docs/harnesses/deepseek.md`; package name confirmed in
  `packages/deepseek/package.json`.
- Pi direct command taken from the Helper's own implementation
  (`packages/helper/src/commands/install/pi.ts` runs `pi install
  npm:@jwitmann/vcc-brain-pi`); package name confirmed in
  `packages/pi/package.json`.
- Codex/Claude Code have no one-line direct route (marketplace flows),
  so they stay Helper-only with guide pointers — no invented commands.

## Battery (docs cadence)

- `bun run lint:md` (repo config, 116 files): 0 issues, exit 0. Docs-only
  change — no product code touched; no specialists required, none run.
- `vcc-brain-helper --help` executed during the session; output matches
  the documented user/agent command set.

## Findings

- None blocking. The npm editorial notice still clears on human
  re-review, not on commit or publish.
