# Review — docs-only: README VCC block fix (this session)

## Scope — every changed file

- `README.md` — "For the best long-session results" block
  restructured from prose to per-harness bullets: DeepSeek
  keeps the install command + fallback line; OpenCode now
  names the concrete enablement (`/operator:project-init`
  flips `contextManagement.enabled` in
  `<project>/.operator/config.json`) instead of the vague
  "enable during setup".
- `.dev-framework/review.md` — this artifact.

No product code. Enablement verified against the tree
before writing: core `compiler.ts` header (faithful port of
`dsh-compaction-vcc@0.7.4`, in-tree, bundled in dists);
`PROJECT_CONFIG_TEMPLATE` (`contextManagement.enabled`,
default false, flipped at project setup); opencode-v2
reads the flag (`index.ts`). Fixes the prior revision's
asymmetry (copy-paste command vs hand-waving).

## Findings and resolutions

- **Gap as reported by the user: OpenCode half was not
  actionable.** Fixed with the exact switch and the flow
  that flips it. No new claims — same verified facts,
  concrete form.
- **No specialists — docs-only cadence.** Markdown lint is
  the entire battery for this scope.

## Verification (final tree)

- `bun run lint:md` — 135 files, 0 issues.
- Working tree clean after commit; nothing pushed.
