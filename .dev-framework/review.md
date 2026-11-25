# Review — docs(opencode-v2): full-shape npm README

Scope: docs-only. No product code changed.
Files: `packages/opencode-v2/README.md`,
`.dev-framework/review.md` (this artifact).

## Change

- Rewrote the npm package README to the release-spec shape (what it
  is, install, verify, commands, update, harness-guide link), mirroring
  the Claude and DeepSeek pages. Adds the missing verify step, the
  `opencode plugin check/update` flow, the recall tool pair with the
  `recall-cross index` warm-up note, and the guide link. Kept the
  local-development note and the V1-frozen lede.

## Cadence (docs-only)

- `bun run lint:md`: 0 issues in 135 files. Pass.
- Specialists not run: prose-only change, no product code in scope;
  per gate, lint:md is the entire docs cadence.

## Findings

- None. All added claims trace to `docs/harnesses/opencode-v2.md`
  (verify wording, update commands, recall section) or the registered
  tool/command names in `src/`.
