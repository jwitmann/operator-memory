# Review — docs-only: install-flow pointers + benefit framing (this session)

## Scope — every changed file

Two doc passes, one session; nothing else changed:

- `docs/getting-started.md` — `/operator:project-init` bullet
  gains the offer line (deterministic context management on
  OpenCode, DeepSeek). [pass 1: install-flow pointers]
- `docs/harnesses/deepseek.md` — Commands section gains the
  one-line pointer to Context Management. [pass 1]
- `docs/harnesses/opencode-v2.md` — Commands section gains the
  twin pointer [pass 1]; Context Management gains the
  problem-first paragraph (rewritten-rules harm,
  reference-don't-restate, write-first, verbatim omission
  handles, prompt-only boundary). [pass 2: benefit framing]
- `docs/architecture.md` — "Failure Is Visible" names the
  stamp mechanism (tree hash, `index lint` warning, preamble
  nudge, content edits never stale). [pass 1: staleness docs]
- `docs/troubleshooting.md` — repair section gains the
  stale-index line (warning not error, refresh flow,
  `index lint` modifies nothing). [pass 1]
- `README.md` — Features bullet gains the survival clause
  (summaries must reference Brain paths instead of
  paraphrasing them). [pass 2]
- `.dev-framework/review.md` — this artifact.

No product code. Claims verified against the tree before
writing: compaction prompt (`core/context/compaction.ts`)
never inlines Brain content, mandates write-to-Brain-first,
keeps verbatim omission handles; both adapters render it
(opencode-v2 directly, deepseek via `shaping.ts`); shaping is
prompt-only; preamble re-render needs the refresh switch
(not claimed otherwise). Pi/codex/claude-code/kiro have no
context code. Observations docs already matched v4 —
checked, untouched. Wording is our own.

## Findings and resolutions

- **odf-pattern-guardian-16: no drift.** Shared framing
  sentence correctly adapted per adapter (opencode-v2 keeps
  the omission handle + prompt-only boundary; deepseek
  correctly omits trim); README carries the compressed form.
- **odf-code-reviewer-18: no correctness issues.** Link
  anchors valid (`#context-management` both docs;
  `#preamble-refresh`/`#brain-updates` intact); deepseek
  claims no `read_omitted` where none exists;
  getting-started harness list matches the two docs that
  document the feature. Reviewer confirms the gap this
  rewrite closes: prior artifact omitted getting-started.md.
- **odf-style-enforcer-17: no style issues.**
- **Stale odf-13/14/15 (observation-engine scope): reused,
  not re-run** — different scope, already closed and
  committed; nothing here invalidates them.
- **Prior artifact gap (the block): the d11bb11 review
  covered only pass 2.** This rewrite covers both passes,
  naming all five tracked files plus the two pass-1
  commit-mates, so the artifact matches the session.

## Verification (final tree)

- `bun run lint:md` — 135 files, 0 issues.
- Working tree clean after commit; nothing pushed.
