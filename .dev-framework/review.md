# Review — this session (fresh 2026-11-24 ~19:45 +07)

Session work: Phase 3 verification tail — blind-benchmark-driven
candidate-cap fix in the recall query path. The approved one-line cap
raise (50 → 500) deterministically crashed (SQLITE_CANTOPEN temp spill
on wide-row sorts under the sandbox); fixed via narrow-then-fetch.
`bun run check packages/helper` EXIT 0 (137/137); `lint:md` 0 issues.
Commit lands Phase 3 (docs from the prior artifact + this fix) as one unit.

## Scope — every changed file

Product code (full battery below):

- `packages/helper/src/commands/recall-cross/query.ts` — MODIFIED:
  `CANDIDATE_LIMIT = 500` (measured: benchmark flat 7–25ms at every
  LIMIT 50→5000 on the real 22k-turn corpus; 500 ≈ 3x worst observed
  burial depth 149) + `fetchOrdered` narrow-then-fetch (narrow rowid
  sort in memory, point-fetch winners, JS re-sort to candidate order;
  core keeps the single final ranking) + both candidate functions
  rewired through it. Follow-up fix inside the fix: key-type-safe
  `position` lookup (`Number()` coercion, `MAX_SAFE_INTEGER` fallback)
  + caller-cap guard comment.
- `packages/helper/src/templates/project/index-setup.ts` — MODIFIED
  (prior artifact, unchanged since): Phase 5 recall bullet (tail-trimmed
  per style) + Phase 6 summary bullet. Guide text only, no control flow.

Docs-only (lint:md cadence, repo-wide 0 issues — no specialists):

- `.vcc-brain-shared/specs/deepseek/implementation.md`,
  `.vcc-brain-shared/specs/opencode-v2/implementation.md` — Cross-Session
  Recall sections, helper-subprocess pathway wording, Last Updated
  bumps, two pre-existing blank-line lint fixes.
- `docs/dev/cross-session-recall-build-plan.md` — A4 re-run rounds 1+2,
  benchmark, crash diagnosis, narrow-fetch fix, sampler-bug note.
  (Untracked working doc; the other three `docs/dev/*.md` files and
  `.dev-framework.yml` are untouched since the prior artifact — the yml
  line remains pre-existing and uncommitted.)

## Battery (product scope: query.ts + template)

- pattern-guardian (fresh): Blocking none. `fetchOrdered` duplicates
  nothing (`collectRecords`/`rowToRecord` reused; opencode's chunked-IN
  is a different concern); 500-vs-500 coincidence must stay separate
  consts. Should-fix (minor): uncapped-future-caller guard → APPLIED as
  a comment (no code change needed).
- style-enforcer (fresh): Blocking none, Should-fix none. Naming,
  const-only, typing, comment necessity all conform. Two notes left as
  lead's call (terse `at` param; loose sqlite-boundary casts mirroring
  file idiom) — no change.
- code-reviewer (fresh): one Should-fix — lookup key-type mismatch
  (`order` keys coerced, comparator raw) + `?? 0` collapsing misses to
  the front → APPLIED (`position` with `Number()` + `MAX_SAFE_INTEGER`
  fallback). Verified OK: order preserved for unique integer keys,
  `rowToRecord` ignores the extra rowid column, empty-set behavior
  identical, 500-placeholder IN-list safe (bound args, constant-only
  interpolation), fallback/union untouched. Other notes (silent
  non-integer drop, duplicate-rowid last-wins) accepted as dead-code
  realities, documented.
- test-grounder (genuine fail-before/pass-after on this change):
  BEFORE — the approved naive cap raise deterministically crashed the
  real CLI path (`recall-cross query ... implementation documentation
  fragmentation` → `Error: unable to open database file` at
  `instrCandidates`, reproduced manually 2x and via the blind run;
  SQL-level proof: wide-row `LIMIT 50` ok / `LIMIT 500` throws, narrow
  `LIMIT 5000` ok). AFTER — `bun run check packages/helper` EXIT 0
  (14 files, 137/137), former crash query returns ranked hits, full
  20-trial blind run completes with zero crashes and all 20 miss/hit
  origins verified in-pool. No new unit test added: the crash is a
  sandbox-temp environmental (passes unsandboxed either way); the blind
  end-to-end run is the covering evidence.

## Gates (final tree)

- `bun run check packages/helper` EXIT 0 (137/137, post-fix).
- `bun run lint:md` 0 issues in 0 files (repo-wide).
- odf post-execute lint on both edited files: passed.
- dist rebuilt from final source; former crash query verified against it.
