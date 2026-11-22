# Index Staleness Detection

Last Updated: November 22, 2026

Deterministic structural-drift detection for the Project Index. The index maps codebase structure; structure moves under it. This contract closes that loop without agent judgment: Helper stamps and compares, lint warns, the preamble nudges only on missing stamps, and live drift is always an explicit workflow step, never a background watch.

## Concepts

- **Stamp**: three frontmatter fields on each main index (`index/index.md`, per partition independently): `tree_hash` (structural hash at write time), `stamped_at` (full ISO-8601 UTC, `toISOString()` shape), `stamped_commit` (full 40-char git sha, or `null` when not a repository, on unborn HEAD, or when commit resolution fails — commit resolution never fails the stamp). Provenance for readers; only `tree_hash` participates in comparison.
- **Completeness**: a stamp is complete iff all three fields are present. `index stamp` always writes all three. Lint treats a missing `tree_hash` as unstamped and a present `tree_hash` with missing siblings as an incomplete-stamp warning (re-stamp to fix). The preamble nudge checks only `tree_hash` presence — a deliberate cost tradeoff, stated so the two checks never surprise each other.
- **Structural hash**: SHA-256 hex (64 chars) over the covered file set, constructed as UTF-8 bytes of `/`-joined paths relative to the project root (the Helper invocation cwd), sorted in code-unit order, joined with `\n` and no trailing newline. Symlinks and submodule gitlinks are hashed as listed, never followed. The empty set hashes the empty string. File edits never change the hash; only add/remove/rename does. Content drift inside unchanged paths is an accepted limit — the index documents structure, and refresh-time rewriting ("rewrite stale; add missing; remove dead paths") already covers content.
- **Covered file set**: one project-wide set, stamped identically into each existing main index (per-partition warnings may therefore duplicate; that is correct, not a bug). Source: `git ls-files --cached -z` when inside a work tree (tracked files only — respects `.gitignore` by construction; untracked scratch does not stale the index because committed structure is what the index documents), else a filesystem walk with the closed ignore set below. Both backends derive directories from file parents, so empty directories are invisible in both. The brain partitions (`.operator/`, `.operator-shared/`) and `.git` are always excluded — index writes must never stale their own stamp. The walk backend prunes any path with a segment in this closed set, at any depth: `node_modules`, `dist`, `build`, `target`, `coverage`, `.next`, `vendor`, `__pycache__`, `.venv`, plus files named `.DS_Store`. Backend divergence (walk cannot honor `.gitignore`) is accepted and stated: non-git projects hash a wider set.

## Helper behavior

- Git probing: `git rev-parse --is-inside-work-tree` decides the backend; a negative answer or a missing git binary falls back to the walk backend silently (no finding — backend selection is environment, not drift). A genuine `ls-files` failure inside a work tree surfaces as an error finding.
- `index stamp` computes the hash via the shared helper used by lint, then writes or updates the three stamp fields in place by textual splice: insert-or-replace the three keys inside the existing frontmatter block by key-anchored line match, preserving all other bytes. Nothing in Helper writes YAML today, so no serialization path exists to reuse; the splice is the approach. Missing or malformed frontmatter is a hard error and the file is left untouched. Missing main index is a hard error pointing at `index init`, not a silent skip. Stamping is idempotent.
- `index lint` recomputes the hash and compares per main index: match is silent; missing stamp fields yield a warning ("never stamped — run `index stamp`"); mismatch yields a warning with the message template `Index is stale (tree changed since <stamped_at>): added: <a, b>; removed: <c> (+N more). Run 'index stamp' after refreshing the index.` where added/removed name changed top-level segments (first path segments, root files by name), at most 10 names total with `+N more` for the remainder. Staleness findings are warning-level (`error: false`): `index lint` exits 0 on drift alone. Normal development constantly drifts the tree; a red gate on routine work trains ignore. Errors (missing frontmatter, malformed YAML, private refs in Shared, genuine git failures) keep their existing error severity.
- The index-setup guide runs `index stamp` after writing and verifies with `index lint`; the stamp result is reported in the final confirmation. Project Setup Phase 8 hands off to `index init` plus the guide, which owns the stamp step.

## Preamble behavior

- The preamble warns when a main index exists but carries no `tree_hash` ("index exists but was never stamped — staleness is unknown"). Core extends its index frontmatter type with the three optional stamp fields at parse time (rather than a second ad-hoc parse); the nudge reads them from the already-loaded index bodies with no extra I/O. Stamp fields are never surfaced in index listings, which keep showing `description`/`read_if` only.
- The preamble never hashes the live tree. Per-prompt tree walks violate the cold-prompt-cache cost rule. Live drift is caught by running `index lint` (agent workflow step or CI job), not by injection-time arithmetic.
- The normative behavior lives here; `preamble.md` gains the nudge as a warnings-list entry and defers to this spec.

## Implementation surface

Helper `lint.ts` (comparison), new `commands/index/stamp.ts` plus a `cli.ts` help-table row and dispatch case, `templates/project/index-setup.ts` (verify step + report line), core `memory/frontmatter.ts` (optional stamp fields), core `preamble.ts` (nudge), `specs/preamble.md` (warnings entry), `specs/commands.md` (one sentence pointing at the stamp/lint loop), Helper `test/lint.test.ts` plus a stamp test module, core `preamble.test.ts`.

## Tests

- Helper FS tests with the existing `run` helper (FileSystem + Path only; `node:crypto` needs no layer): stamp/lint round-trip is silent; drift fixture (added/removed top-level path) warns with the changed names; content-edits-only fixture stays silent; unstamped index warns; malformed frontmatter errors with the file untouched; stamp preserves all other bytes.
- Git-backend tests (needs `GitRunner` layers or an injected file-listing seam): `ls-files` source, not-a-repo and missing-git fall back to walk, genuine `ls-files` failure errors.
- Core preamble tests: missing `tree_hash` warns; present full stamp does not; no-index warning unchanged.

## Non-goals

- Content hashing, per-file tracking, subindex-level stamps (the main-index structural hash covers subindex-worthy drift by construction).
- Background watching, auto-refresh, or threshold tuning — any change warns; triage is the agent's explicit step.
- Surfacing drift inside the preamble beyond the unstamped nudge.
