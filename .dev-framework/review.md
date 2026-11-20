# Review — observation-engine steps (c) + (b) + coverage extension (this session)

## Scope — every changed file

- `docs/dev/observation-engine.md` — three commits this session:
  (1) `6cf27ce` `## Analogue survey (step (c))`: five fetched-source analogues
  (ChatGPT Dreaming, Codex local memories, Claude Code auto memory,
  Cursor-absence/Copilot-convergence, mem0 exclusion, 9-brain local scan)
  with detection / control / staleness / precision / constraint-fit fields
  and Last-verified dates; verdict SURVIVE-reshaped
  (deterministic-trigger + LLM-drafted-proposal split); status line updated.
  (2) `bc29b22` `### 4. Wider trawl (step (b))`: 27,584 user messages /
  3,029 sessions (opencode SQLite + DSH v4), loose vs strict pattern
  sets, base rates, FP classes, trigger calibration (correction≥3 OR
  recall≥2 ≈ 26 sessions), two failed deterministic topic-identity probes,
  Phase-1 `### 3` caveat preserved. One self-caught MD004 fixed pre-commit.
  (3) `793885e` coverage extension: corpus 28,239 / 3,304 (+274 DSH
  projcache first-prompts via `titleInput.first.text` after verifying
  inbox rows are drained end-of-state, +380 DSH-TUI history lines;
  effect-ledger and inject/servers.json deliberately skipped as
  non-user-language). New sources contribute ~zero strict hits
  (correction 193→194, recall unchanged) — documented as coverage, and
  as the finding that correction language lives mid-session, so
  opener/TUI-only triggers would be blind. Calibration unchanged.
- `.dev-framework/review.md` — this artifact, rewritten fresh for this session.

No product code, no tooling, no config. Analysis scripts are throwaway
scratch (`/tmp/opencode/obs-pilot/`, not repo files). No headings renamed;
no anchor impact (additive sections only).

## Findings and resolutions

- **markdownlint (docs cadence, the entire battery per scope rule):**
  `bun run lint:md` → 129 files, **0 issues**, run after the final edit
  and before each commit. The one mid-session MD004 in the new survey
  section was fixed and re-greened pre-commit.
- **Commit gates:** pre-commit per-package checks passed on both commits
  (`6cf27ce` survey, `bc29b22` trawl). Full root `bun run check` green
  on the parent tree; docs-only deltas, no code touched.
- **No specialists required:** docs-only change per the scope rule.
  No prior specialist scope invalidated (no code/config touched since
  the lint session's four clean reports).
- **Content diligence (author-performed):** every analogue field backed by
  a fetched page (help.openai.com, learn.chatgpt.com, code.claude.com,
  docs.mem0.ai, every.to, docs.github.com); the initial Claude Code
  "absence" hypothesis was checked against current docs and corrected
  (auto memory exists — surveyed); local-corpus claim verified by
  scanning all 9 `~/.operator` brains; trawl numbers are script-observed
  (extraction + pattern counts re-ran, not asserted); FP classes grounded
  in hand-read samples; negative results reported as results
  (verbatim/overlap probes), not buried.

## Verification (final tree)

- `bun run lint:md` — exit 0, "Summary: 0 issues in 0 files".
- Changed files are exactly the two above; tree otherwise clean.
- Committed locally as `6cf27ce` (survey) + `bc29b22` (trawl) +
  `793885e` (coverage extension); pre-commit gates passed on all three.
