# Review — docs-only: benefit-first compaction framing (this session)

## Scope — every changed file

- `README.md` — Features bullet gains the survival clause
  (summaries must reference Brain paths instead of
  paraphrasing them).
- `docs/harnesses/opencode-v2.md` — Context Management gains
  a problem-first paragraph (rewritten-rules harm,
  reference-don't-restate, write-first, verbatim omission
  handles, prompt-only boundary).
- `docs/harnesses/deepseek.md` — Context Management gains the
  same shape minus trim (recovery via recall/search, unchanged
  below).
- `.dev-framework/review.md` — this artifact.

No product code. Claims verified against the tree before
writing: core `context/compaction.ts` never inlines Brain
content (references paths, mandates write-to-Brain-first,
"compaction is lossy; the Brain is not"); both adapters render
that prompt (opencode-v2 directly, deepseek via
`shaping.ts`); shaping is prompt-only per the code comment;
post-compaction preamble re-render needs the refresh switch
(not claimed otherwise). Pi/codex/claude-code/kiro have no
context code — untouched. Wording is our own; the reference
repo supplied structure (problem → example → capabilities),
not sentences.

## Findings and resolutions

- **Gap as reported, confirmed.** Our framing led with
  mechanism (token arithmetic, receipts); the harm
  (summarizer rewrites your rules) and the benefit (rules
  survive as pointers to verbatim source) were never stated.
  Fixed with one clause plus two paragraphs in existing
  sections; no new sections.
- **No specialists dispatched — docs-only cadence.** Markdown
  lint is the entire battery for this scope.

## Verification (final tree)

- `bun run lint:md` — 135 files, 0 issues.
- Working tree clean after commit; nothing pushed.
