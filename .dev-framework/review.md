# Review — docs-only: compaction install-phase pointers (this session)

## Scope — every changed file

- `docs/harnesses/opencode-v2.md` — Commands section gains one
  pointer line to `#context-management` (deterministic trim and
  compaction, off by default, enable during project setup).
- `docs/harnesses/deepseek.md` — Commands section gains the twin
  pointer (host-driven compaction, per-session receipts).
- `docs/getting-started.md` — `/operator:project-init` bullet
  gains the cross-harness offer line (deterministic context
  management on OpenCode, DeepSeek).
- `.dev-framework/review.md` — this artifact.

No product code. No new sections; each addition is one to two
sentences inside its existing section. Adapter claims checked
against tree truth: trim+compaction on opencode-v2 only
(`packages/opencode-v2/src`, core context engine), compaction-only
on DeepSeek (`packages/deepseek/src`, host owns reduction), no
context code in pi/codex/claude-code/kiro — hence the
"on supported harnesses (OpenCode, DeepSeek)" qualifier. Already
advertised elsewhere and untouched: README Features bullet,
both harness Context Management sections, project-init guide
(template `setup.ts`), troubleshooting receipts.

## Findings and resolutions

- **Gap as reported, narrower than suspected.** Install-phase
  flows (Install → Verify → Commands) never pointed at the
  existing Context Management sections; fixed with in-flow
  pointers rather than duplicated content.
- **No specialists dispatched — docs-only cadence.** Per the
  gate, docs-only changes get markdown lint instead of
  specialists; that is the entire cadence. No product code
  changed, so pattern/correctness/style batteries do not apply
  to this scope.

## Verification (final tree)

- `bun run lint:md` — 135 files, 0 issues.
- Working tree clean after commit; nothing pushed.
