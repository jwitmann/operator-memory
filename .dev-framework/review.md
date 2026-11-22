# Review — end-to-end staleness verification (this session)

## Scope — every tracked file

This session made **no repo changes** (`git status --short` empty). The
tracker's 7 paths are E2E probe fixtures under `/tmp/stale-probe/project`
(scratch dir, git repo created for the probe), recorded relative to the
probe cwd — not workspace files. True locations and roles:

- `src/a.ts` → `/tmp/stale-probe/project/src/a.ts` — one-line
  `export const a = 100;` (value edited mid-probe for the content-only
  case). Never existed under the workspace (glob proves it).
- `src/b.ts` → `/tmp/stale-probe/project/src/b.ts` — one-line
  `export const b = 2;` baseline fixture.
- `src/c.ts` → created, then `mv` + `git add -A` renamed it away —
  explains both names in the tracked list; no `c.ts` remains on disk.
- `src/renamed.ts` → `/tmp/stale-probe/project/src/renamed.ts` —
  successor holding `export const c = 3;`.
- `.operator-shared/index/index.md` → probe's stamped main index
  (valid frontmatter + `tree_hash`/`stamped_at`/`stamped_commit`).
  The repo homonym is byte-identical to HEAD (status clean).
- `.operator-shared/catalog.md` / `.operator-shared/operator.md` →
  probe one-liners (`# Shared catalog`, `# Shared instructions`).
  Repo homonyms unmodified (status clean).

No product code, no docs edits, no new dependencies in this session —
probe fixtures only.

## Findings and resolutions

- **odf-style-enforcer-11 Blocking (files not found) — resolved by
  relocation, re-reviewed clean.** The four `src/` paths do not exist
  under the workspace (glob-confirmed by two agents). Located at the
  true `/tmp/stale-probe/project/...` paths and re-reviewed
  (agent-16, investigation-only): no Code/Docs Style violations —
  `const`, semicolons, no tables/bold issues; stamped index keeps the
  `##`-template brain shape. Notes only: single-letter names are
  expected fixtures; sparse one-line catalog/operator are probe stubs,
  not brain docs. The three repo `.operator-shared` homonyms were
  already reviewed with no violations — reused, not re-run.
- **Stale odf-style-enforcer-8 should-fix ("together together") —
  already fixed, verified in-tree.** `grep` for the duplicate in
  `packages/helper/src/templates/project/index-setup.ts` finds only the
  single-word form at lines 91 and 132. The finding predates the fix
  (phase-1 review records it fixed pre-commit). No action.
- **Stale odf-pattern-guardian-7 should-fixes — both previously
  dispositioned, verified unchanged:**
  - Regex YAML reads → already fixed pre-commit: `tree-hash.ts`
    `readStampFields` parses via `parseDocument(source,
    { uniqueKeys: true })`; the surviving line-regex is the
    write-path splice, which is justified (YAML round-trip would
    destroy formatting/comments). No action.
  - `PARTITIONS` literals vs canonical roots → deliberately retained:
    building the index-area table from
    `commands/project/common.ts` inverts the established
    `commands/ → src-root` import direction for two string
    literals (recorded in the phase-1 review). No action.
- **Correctness/drift: clean.** odf-code-reviewer-9 (no issues),
  odf-code-reviewer-12 (no reviewable code at scope), odf-pattern-
  guardian-10 (no drift; its cannot-see-src limitation is superseded
  by the agent-16 true-path review above).

## Test-grounder evidence (all commands actually run)

Lead pass on `/tmp/stale-probe/project` (git backend): nudge 1 hit
before stamp → 0 after; `index stamp` exit 0 with `tree_hash` +
quoted `stamped_at` + `stamped_commit`; `index lint` clean exit 0;
untracked `src/c.ts` invisible; after `git add` stale warning with
`1b6ddeb1bb54 → 0fd2cfcc5718`, exit 0; content-only edit invisible;
rename re-stales. Unstamped non-git probe (`/tmp/stale-fresh`): never-
stamped warning, exit 0.

Independent re-run (agent-17, fresh `/tmp/stale-grounder/project`,
reused built `dist`, repo untouched): all 6 expectations met —
nudge 1→0, stamp exit 0, lint clean, untracked invisible, staged
addition warns (`1b6ddeb1bb54 → 0fd2cfcc5718`) at exit 0,
content-only edit clean. Identical hashes across fresh dirs confirm
deterministic hashing; re-stamp hash matched the warned hash.

Gaps (plainly stated): incomplete-stamp warning, git-failure error
paths, and per-partition duplicate warnings remain unit-test-only,
not covered E2E. Scratch dirs stay in `/tmp`, outside the repo.

## Verification (final tree)

- `git status --short` — empty, exit 0 (no repo changes to gate).
- `bun run lint:md` — 135 files, 0 issues (covers this artifact).
