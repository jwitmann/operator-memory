# Index Staleness Detection

Last Updated: November 22, 2026

Deterministic structural-drift detection for the Project Index. The index maps
codebase structure; structure moves under it. This contract closes that loop
without agent judgment: Helper stamps and compares, lint warns, the preamble
nudges only on missing stamps, and live drift is always an explicit workflow
step, never a background watch.

## Concepts

- **Stamp**: three frontmatter fields on each main index (`index/index.md`,
  per partition independently): `tree_hash` (structural hash at write time),
  `stamped_at` (ISO date), `stamped_commit` (git sha or `null`). Provenance
  for readers; only `tree_hash` participates in comparison.
- **Structural hash**: SHA-256 hex over the sorted newline-joined relative
  paths of the covered file set. File edits never change it; only
  add/remove/rename does. Content drift inside unchanged paths is an accepted
  limit — the index documents structure, and refresh-time rewriting
  ("rewrite stale; add missing; remove dead paths") already covers content.
- **Covered file set**: tracked files via `git ls-files` when the project is
  a git repository (respects `.gitignore` by construction; untracked scratch
  does not stale the index — committed structure is what the index documents),
  else a filesystem walk with a fixed ignore set. Both backends derive
  directories from file parents, so empty directories are invisible in both.
  The brain partitions (`.operator/`, `.operator-shared/`) and `.git` are
  always excluded — index writes must never stale their own stamp. Standard
  build/cache trees (`node_modules`, `dist`, `build`, `target`, `__pycache__`,
  `.venv`) are excluded from the walk backend.

## Helper behavior

- `index stamp` computes the hash for each existing main index and writes or
  updates the three stamp fields in place, preserving `description`,
  `read_if`, and body content. Missing main index is a hard error pointing at
  `index init`, not a silent skip. Stamping is idempotent.
- `index lint` recomputes the hash and compares: match is silent; missing
  stamp fields yield a warning ("never stamped — run `index stamp`"); mismatch
  yields a warning naming top-level structural changes (added/removed
  top-level paths and manifest changes, capped). Staleness findings are
  warning-level (`error: false`): `index lint` exits 0 on drift alone. Normal
  development constantly drifts the tree; a red gate on routine work trains
  ignore. Errors (missing frontmatter, malformed YAML, private refs in Shared)
  keep their existing error severity.
- The index-setup guide runs `index stamp` after writing and verifies with
  `index lint`; the stamp result is reported in the final confirmation. The
  Project Setup index offer points at the same loop.

## Preamble behavior

- The preamble warns when a main index exists but carries no stamp
  ("index exists but was never stamped — staleness is unknown"), reading the
  fields from the already-loaded index body with no extra I/O.
- The preamble never hashes the live tree. Per-prompt tree walks violate the
  cold-prompt-cache cost rule. Live drift is caught by running `index lint`
  (agent workflow step or CI job), not by injection-time arithmetic.

## Tests

- Stamp/lint round-trip: stamp then lint is silent.
- Drift fixture: structural change (added/removed top-level path) warns with
  the changed paths named; file-content edits alone stay silent.
- Unstamped index warns; malformed frontmatter keeps stamp out and errors as
  before; stamp preserves existing frontmatter and body byte-for-byte
  elsewhere.
- Preamble: unstamped main index warns; stamped index does not; no-index
  warning unchanged.

## Non-goals

- Content hashing, per-file tracking, subindex-level stamps (main-index
  structural hash covers subindex-worthy drift by construction).
- Background watching, auto-refresh, or threshold tuning — any change warns;
  triage is the agent's explicit step.
- Surfacing drift inside the preamble beyond the unstamped nudge.
