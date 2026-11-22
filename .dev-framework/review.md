# Review — docs-only: VCC install recommendation (this session)

## Scope — every changed file

- `README.md` — Installation flow gains "For the best
  long-session results" (harm sentence, `dsh plugin --profile
  web add dsh-compaction-vcc`, without-it fallback, OpenCode
  built-in note).
- `docs/harnesses/deepseek.md` — existing drop-in sentence
  gains the exact install command.
- `.dev-framework/review.md` — this artifact.

No product code. Install command verified verbatim against
the upstream `dsh-compaction-vcc` README; fallback claim
matches `deepseek.md` ("backend choice, not adapter code");
OpenCode built-in claim matches `opencode-v2.md`
("ported in-tree"). Wording is our own; the reference repo
supplied structure (problem → command → without-it cost).

## Findings and resolutions

- **Gap as reported, confirmed.** The README recommended
  no install for better results — only the mechanism. The
  install phase now names the VCC engine explicitly, per
  harness (install on DeepSeek, enable on OpenCode).
- **No specialists — docs-only cadence.** Markdown lint is
  the entire battery for this scope.

## Verification (final tree)

- `bun run lint:md` — 135 files, 0 issues.
- Working tree clean after commit; nothing pushed.
