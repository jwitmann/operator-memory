# Review — release helper 1.14.0, deepseek 0.7.0, opencode-v2 2.7.0

Scope: release-only. No product code changed.
Files: `packages/{helper,deepseek,opencode-v2}/package.json` (version bumps),
`packages/{helper,deepseek,opencode-v2}/CHANGELOG.md` (generated sections).
Prior docs change (`README.md`, `docs/getting-started.md`) reviewed in the
previous session entry; record kept below.

## Change
- helper 1.13.0 → 1.14.0, deepseek 0.6.0 → 0.7.0, opencode-v2 2.6.0 → 2.7.0.
- Changelogs generated with `scripts/changelog.sh` off conventional commits
  (all `feat`, all bucketed under Features); commit-message shape mirrors the
  previous release commit `0c5d923`.
- Annotated tags `helper@v1.14.0`, `deepseek@v0.7.0`, `opencode-v2@v2.7.0`
  on the release commit. No push (user action).

## Cadence (release-only: versions + generated changelogs)
- `bun run lint:md`: 0 issues in 135 files. Pass.
- `./scripts/check.sh packages/helper`: 15 files, 145 tests pass.
- `./scripts/check.sh packages/core` (177 tests) and `packages/opencode-v2`
  (174 tests): pass via pre-commit hook on the release commit.
- Specialists not run: no product code in scope; version strings and
  generated changelog prose carry no correctness or pattern surface.

## Gate test failure (parallel-load flake, pre-existing, unrelated)
- The full-workspace `bun run check` failed 2 tests in
  `packages/helper/test/recall-cross-opencode.test.ts` (timeouts under
  parallel load). Same tree, same file alone: 13/13 pass; full helper
  suite alone: 145/145 pass.
- The release commit cannot affect test outcomes (version strings +
  markdown only). No code change to fix; re-running the suite is the
  resolution. This flake was already recorded earlier this session.

## Findings
- None blocking. Changelog entries verified against `git log <tag>..HEAD`
  per package; commit lists match (helper 5, deepseek 3, opencode-v2 2).

---

# Review — docs(recall): peer declaration in README and getting-started

Scope: docs-only. No product code changed.
Files: `README.md`, `docs/getting-started.md`.

## Change
- README recall bullet now names the mechanism (declare in `.vcc-brain/config.json`, mutual-or-nothing).
- getting-started "Past sessions are searchable" gains the JSON snippet plus the mutuality rule, mirroring the harness pages.

## Cadence (docs-only)
- `bun run lint:md`: 0 issues in 135 files. Pass.
- Specialists not run: no product code in scope; per gate, lint:md is the entire docs cadence.

## Findings
- None. Prose mirrors the already-reviewed harness sections verbatim in contract (mutual-or-nothing, config path, snippet shape).
