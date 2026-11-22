# Review — session: init-time auto-migration of legacy inner instructions

`project init` / `user init` now rename a legacy `operator.md` to
`vcc-brain.md` in place instead of scaffolding a shadowing template next
to it. Motivation: brains migrated at directory level only
(`.vcc-brain/operator.md`, e.g. via the repo's migrate script before the
inner-file rename existed, or manual `mv`) read fine through the loader
fallback, but the next init wrote an empty `vcc-brain.md` that the loader
then preferred — silently hiding the real instructions.

## Scope — every session-changed file

- `packages/helper/src/filesystem.ts` — new `renameFileIfTargetMissing`
  (Effect.fn, inspectPath guards, `"moved" | "already-present" |
  "source-missing"`, `PathKindError` on obstructed paths, `FileSystem.rename`).
- `packages/helper/src/commands/project/init.ts`, `packages/helper/src/commands/user/init.ts` —
  run the rename before scaffolding, report a `"Migrated"` row; on
  migration failure the instructions template is skipped (other files
  still scaffold) so a fresh file can never shadow real content.
- `packages/core/src/memory/roots.ts` — `BRAIN_INSTRUCTIONS_LEGACY_FILENAME`
  now exported (was module-private); comment records it is read + migrated,
  never written by new code.
- `packages/helper/src/commands/project/common.ts`, `packages/helper/src/commands/user/common.ts` —
  re-export the legacy constant (project: import+export block; user: import
  with a single-line re-export, aligned after review).
- `packages/helper/test/cli.test.ts` — 4 new tests: legacy-root migration,
  primary-root legacy-inner migration (the stranded state), user legacy
  migration, idempotence re-run (no second "Migrated", exit 0, content kept),
  obstruction skip (legacy path is a directory → exit 1, "Failed" row, no
  `vcc-brain.md` created, catalog still scaffolded).

## Battery

- `pattern-guardian`, `style-enforcer`, `code-reviewer` in parallel over
  the diff (read-only), plus targeted re-confirmation messages after the
  fixes — all three report resolved, no remaining opens.
- Test-grounder: new tests fail without the src changes (stash check:
  legacy-inner assertions fail against primary-only reads); fail-before
  shown for the original trap (template "Created" next to real legacy
  content in the pre-fix flow, caught by the `not.toContain("Created  …")`
  assertion shape during development).

## Findings and resolutions

- Blocking: none from any specialist.
- Should-fix 1 (style): `as const` on new returns vs bare literals in
  `writeTextIfMissing` — dropped, neighbor spelling now uniform.
  Re-confirmed by style-enforcer.
- Should-fix 2 (code-reviewer): migration failure followed by template
  write baked in the shadowing trap (fresh template + exit 1 + silent
  self-concealment on re-run). Fixed: skip the instructions file when
  migration fails, in both flows; covered by the obstruction test.
  Re-confirmed by code-reviewer (including typing: filtered arrays keep
  element types, template indexing still checks).
- Notes (accepted): `writeTextIfMissing` TOCTOU parity (no worse than the
  established pattern, single-process CLI); shared root untouched by init
  (init never writes instructions there — standalone script covers it);
  `resolveInstructionsPath` display still shows the primary name for
  legacy-inner brains (transient state, content always correct).

## Verification

- `bun run check`: 66 files / 561 tests, exit 0 (twice consecutively;
  one transient failure mid-session did not reproduce).
- `bun run lint:md`: 135 files, 0 issues (this artifact included).
- New behavior: 3 migration tests + idempotence assertions + obstruction
  test, all green in `cli.test.ts` (29/29 file).

## Tracker artifacts (not files)

The gate lists sed command strings from this session as changed paths;
none exists on disk. Named verbatim for completeness:
`s|Created  \.operator/vcc-brain\.md|Created   .operator/vcc-brain.md|`,
`s|Migrated  \.vcc-brain/vcc-brain\.md|Migrated   .vcc-brain/vcc-brain.md|`,
`s|Migrated  ~/\.operator/user/vcc-brain\.md|Migrated   ~/.operator/user/vcc-brain.md|`,
`s|Created  /.operator/vcc-brain/.md|Created   .operator/vcc-brain.md|`,
`s|Migrated  /.vcc-brain/vcc-brain/.md|Migrated   .vcc-brain/vcc-brain.md|`,
`s|Migrated  ~//.operator/user/vcc-brain/.md|Migrated   ~/.operator/user/vcc-brain.md|`.
