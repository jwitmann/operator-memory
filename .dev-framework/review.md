# Review — session: migrate this repo to `.vcc-brain` roots (+ rename fallout)

Session delta is `4943ee9...HEAD` (migration commit `07f9e90`, amended with
fallout fixes) plus the new migration script. The prior `4943ee9` product
change (60 files, dual-root engine) keeps its previous specialist battery —
that scope has not changed since its reports, so it was not re-run.

## Scope — every session-changed file

Config (no product code):

- `.gitignore` — added `/.vcc-brain-shared/references/` (legacy line kept)
  and a private-partition block (`/.vcc-brain/`, `/.operator/`), matching the
  helper's own ignore-block convention (`packages/helper/src/git.ts:7`).
- `biome.json` — added `!.vcc-brain`, `!.vcc-brain-shared` to
  `files.includes`, legacy entries kept so legacy dirs stay excluded too.
- `.vcc-brain/` — private partition moved from `.operator/` (plain `mv`,
  untracked, content-identical). Gate-tracked as a changed path.
- 78 tracked files `.operator-shared/**` → `.vcc-brain-shared/**` via
  `git mv` — byte-identical renames, history preserved, zero content changes.

Code/test fallout from the rename:

- `packages/opencode-v2/test/index.test.ts` — the cold-refresh e2e test read
  receipts from hardcoded `~/.operator/state/context-log`; after the home
  rename that path no longer exists. Now reads
  `join(resolveStateDirectory(homedir()), "context-log")` via the canonical
  helper, the same function production uses to write.
- `scripts/measure-reminder-compliance.ts` — dev-only measurement script with
  the same hardcoded-root flaw, plus a crash when the state dir is missing.
  Now resolves via `resolveStateDirectory(process.env.HOME ?? homedir())`
  (relative import, root scripts declare no workspace deps) and treats
  missing-dir `ENOENT` as an empty report.

New helper:

- `scripts/migrate-brain-to-vcc-brain.sh` — per-project migration script
  (`--dry-run` supported): legacy-only moves (`git mv` when tracked, plain
  `mv` otherwise), primary-only/absent skips, both-exist refuses with exit 1
  (never merges, never deletes), patches `.gitignore` idempotently, reminds
  about the global ignore entry. Executable, `bash -n` clean.

Environment (not a repo file, recorded so future sessions know):

- `~/.operator` → `~/.vcc-brain` (15M, user + state, content-identical).
  Resolver proof in this repo now reads
  `private: .vcc-brain | shared: .vcc-brain-shared | user: ~/.vcc-brain/user`
  with all `legacyAlso` flags false, state `~/.vcc-brain/state`.

Ephemeral verification fixtures (created under the gate's `$R` fixture root,
asserted, then deleted — not repo changes, no longer on disk):

- `$R/projA/.gitignore`, `$R/projA/.operator/operator.md`,
  `$R/projA/.operator-shared/operator.md` — standard git-repo fixture:
  legacy-only private+shared, shared committed, legacy references line.
- `$R/projB/.operator/operator.md`, `$R/projB/.vcc-brain/operator.md` —
  both-exist divergent fixture (refusal path).
- `$R/projC/.vcc-brain/operator.md` — already-migrated fixture.
- `$R/projD/.operator/operator.md` — dry-run fixture.
- `$R/projE/.operator/operator.md` — non-git fixture.
- Plus a second root with one dry-run re-check fixture and a `HEAD`-extracted
  copy of the compliance script used for the fail-before run. All 57 fixture
  files were removed after assertion (`find -type f -exec rm`, empty dirs
  pruned); the 7 script runs in the grounder evidence below are their record.

## Battery

- `pattern-guardian`, `style-enforcer`, `code-reviewer` in parallel over the
  delta above (read-only specialists, no file writes).
- Targeted re-confirmation from pattern-guardian and code-reviewer after the
  `measure-reminder-compliance.ts` fixes (single-question messages, no full
  re-run — no other scope changed).
- Test-grounder evidence below; `bun run check` (typecheck, lint, tests) and
  `bun run lint:md` as the confirming commands.

## Findings and resolutions

Blocking: none — all three specialists report clean.

Should-fix 1 (pattern-guardian): the compliance script hardcoded the primary
root with no legacy fallback. Fixed by importing `resolveStateDirectory`
(verified zero transitive weight: `roots.ts` pulls only `node:` builtins plus
dependency-free `utils.ts`). Re-confirmed resolved; the relative-import
spelling is accepted as minimal (no root workspace dep for one script).

Should-fix 2 (code-reviewer): `readdirSync` crashed `ENOENT` on a missing
state dir, and `HOME ?? "~"` never expanded. Fixed with an `ENOENT`-only
guard (other errors rethrow) and `homedir()` fallback. Re-confirmed
resolved.

Notes (no action): the test fix is exemplary helper reuse (dynamic import
matches surrounding lines; production and test call the same function with
the same argument in all three home states); dual-name retention in
`.gitignore`/`biome.json` matches the repo-wide primary+legacy convention;
`biome.json` exclusions are correct (brain dirs hold docs, `ignoreUnknown`
has nothing to do there); `.gitignore` cannot affect tracked files so the
kept legacy lines hide nothing.

## Test-grounder evidence

- `index.test.ts` cold-refresh: failed before
  (`expected [] to match object [{ kind: "refresh", … }]`, full run 552/553),
  passes after (file run 9/9).
- Compliance script: pre-fix file from git HEAD with `HOME=<empty dir>`
  crashes `ENOENT` exit 1; fixed file prints the zero report exit 0; with the
  real home prints the real report (14 sessions) exit 0.
- Migration script: 7 fixture runs — standard git repo (history-preserving
  renames, content intact), rerun idempotent, both-exist refuses exit 1
  untouched, already-migrated skips, `--dry-run` changes nothing (wording
  fixed when the dry run printed "Moved"), non-git plain `mv`.
- Confirming commands: `bun run check` 66 files / 553 tests, exit 0;
  `bun run lint:md` 135 files, 0 issues (this artifact included).
