# Review — dual brain roots: `.vcc-brain` primary, `.operator` legacy fallback (this session)

Product-code change. Full battery: pattern-guardian + style-enforcer +
code-reviewer in parallel, fixes applied, gates re-run.

## Scope — every changed file

New:

- `packages/core/src/memory/roots.ts` — canonical root constants
  (`.vcc-brain`, `.vcc-brain-shared`, `~/.vcc-brain/user` + legacy
  counterparts), pure `pickPrimary` precedence policy, async
  `resolveBrainRoots` (ENOENT falls back, other errors count as present
  so the loader surfaces them), sync `resolveStateDirectory`, shared
  `projectConfigPaths`, shared `DEFAULT_BRAIN_PATHS`.
- `packages/core/src/memory/roots.test.ts` — grounding tests
  (precedence table, empty/legacy-only/both resolution, config order,
  state-dir fallback).
- `packages/helper/src/commands/project/brain-roots.ts` — shared
  Effect-based `resolveEffectivePartition` (primary-first, legacy reuse,
  obstruction + both-exist reporting, IO-failure-tolerant probing).

Core:

- `packages/core/package.json` — export `./memory/roots`.
- `packages/core/src/memory/project.ts` — root constants now re-exported
  from `roots.ts` (single source of truth).
- `packages/core/src/memory/load.ts` — loads `resolveBrainRoots` output.
- `packages/core/src/preamble.ts` — `displayRoots` is required (no
  default), imports roots from `roots.ts`, canonical
  `(legacy X also checked)` wording, new both-exist shadowing warning
  via `legacyIgnored` flags.
- `packages/core/src/preamble-refresh.ts` — fingerprints resolved roots.
- `packages/core/src/preamble.test.ts` — explicit display roots, legacy
  shadowing warning test.
- `packages/core/src/prompts/preamble-v1.ts`,
  `packages/core/src/prompts/preamble-v2.ts` — brain tree uses
  `.vcc-brain*` names plus a legacy-checked sentence.
- `packages/core/src/context/compaction.ts`,
  `packages/core/src/context/receipts.ts`,
  `packages/core/src/context/store.ts` — comment examples use new paths.

Adapters (all five preamble sites pass explicit roots + `legacyIgnored`;
snapshot promise starts before root resolution to preserve sync-call test
timing):

- `packages/opencode-v2/src/preamble.ts`, `packages/opencode/src/preamble.ts`,
  `packages/pi/src/index.ts`, `packages/deepseek/src/index.ts`,
  `packages/helper/src/commands/preamble.ts`.
- `packages/opencode-v2/src/project-config.ts`,
  `packages/deepseek/src/project-config.ts` — shared core
  `projectConfigPaths`, let-free first-existing-candidate loops; dead
  singular `projectConfigPath` and `PROJECT_CONFIG_*` aliases removed;
  DeepSeek mtime stamp now includes the winning path.
- `packages/opencode-v2/src/compaction.ts`,
  `packages/deepseek/src/shaping.ts` — `DEFAULT_BRAIN_PATHS` re-exported
  from core.
- `packages/opencode-v2/src/index.ts` — `join` import dropped (unused
  after state-dir switch), config comments updated.
- `packages/opencode-v2/src/runtime.ts`, `packages/opencode-v2/src/tool.ts`,
  `packages/deepseek/src/config.ts` — comment wording.

Helper:

- `packages/helper/src/commands/project/common.ts`,
  `packages/helper/src/commands/user/common.ts` — constants re-exported
  from core roots.
- `packages/helper/src/commands/project/init.ts`,
  `packages/helper/src/commands/project/status.ts`,
  `packages/helper/src/commands/user/init.ts`,
  `packages/helper/src/commands/user/status.ts` — all four use the shared
  resolver: legacy reuse instead of shadowing, obstruction fallback
  (non-directory primary falls through to a usable legacy), both-exist
  and obstruction warnings. `user/init` no longer uses dynamic
  `node:fs` import + `existsSync`.
- `packages/helper/src/commands/index/init.ts` — Expected text names
  both legacy roots.
- `packages/helper/src/git.ts` — ignore block carries both roots;
  `checkGlobalIgnore` accepts either, `ensureGlobalIgnore` normalizes to
  primary; tracked-private check covers both.
- `packages/helper/src/lint.ts` — lints all four existing partitions;
  shared-private reference message covers both names; unread `legacy`
  flag removed.
- `packages/helper/src/tree-hash.ts` — all four roots pruned; dot-access
  lint fix.
- Templates (primary `.vcc-brain*` paths with legacy notes):
  `packages/helper/src/templates/project/config.ts`,
  `packages/helper/src/templates/project/index-setup.ts`,
  `packages/helper/src/templates/project/setup.ts`,
  `packages/helper/src/templates/user/operator.ts`,
  `packages/helper/src/templates/user/setup.ts`.

Tests updated to the new primary (bulk renames, no behavior change):

- `packages/helper/test/cli.test.ts` (+2 new legacy tests:
  legacy-partition reuse, both-exist status warning),
  `packages/helper/test/git.test.ts`,
  `packages/helper/test/lint.test.ts`,
  `packages/helper/test/stamp.test.ts`.
- `packages/opencode-v2/test/brain-updates-index.test.ts`,
  `packages/opencode-v2/test/brain-updates.test.ts`,
  `packages/opencode-v2/test/compaction-snapshot.test.ts`,
  `packages/opencode-v2/test/compaction.test.ts`,
  `packages/opencode-v2/test/context.test.ts`,
  `packages/opencode-v2/test/events.test.ts`,
  `packages/opencode-v2/test/index.test.ts`,
  `packages/opencode-v2/test/preamble.test.ts`,
  `packages/opencode-v2/test/project-config-setup.test.ts`,
  `packages/opencode-v2/test/project-config.test.ts`,
  `packages/opencode-v2/test/refresh.test.ts`,
  `packages/opencode-v2/test/tool.test.ts`
  (path renames, toast/message expectations).

## Findings and resolutions

Blocking (pattern-guardian):

1. Quadruple source of truth for root strings (`project.ts`,
   `roots.ts`, `preamble.ts`, helper `common.ts`).
   Resolution: `roots.ts` is canonical; `project.ts` re-exports,
   `preamble.ts` and both helper commons import from core.
2. `user/init` re-invented existence checks via dynamic `node:fs`
   import, losing file/dir distinction and unmockable.
   Resolution: deleted; all four commands share
   `resolveEffectivePartition` (Effect `inspectPath`-based).
3. Copy-pasted project-config path lists in opencode-v2 + deepseek.
   Resolution: shared core `projectConfigPaths`; per-adapter read
   semantics kept (opencode-v2 read-then-parse, deepseek stat-cache).

Blocking (code-reviewer):

1. Silent legacy shadowing when both roots exist.
   Resolution: `resolveBrainRoots` reports `*LegacyAlsoExists` flags;
   preamble renders a merge-then-remove warning per partition; both
   status commands warn; init notes legacy reuse.
2. Primary file-obstruction blocked legacy fallback in status paths.
   Resolution: shared resolver falls back unless primary is a
   directory; obstruction reported via `primaryObstructed` warnings.

Blocking (style-enforcer):

1. `renderPreamble` default argument.
   Resolution: parameter required; all five production callers pass
   explicit roots; tests updated; `DEFAULT_DISPLAY_ROOTS` removed.
2. Triple declaration of root literals.
   Resolution: same as pattern-guardian (1) above.
3. Dead exports (`PROJECT_CONFIG_RELATIVE_PATH` aliases, singular
   `projectConfigPath`, `DEFAULT_DISPLAY_ROOTS`).
   Resolution: removed (zero callers verified).

Should-fix, all resolved except two justified N/A:

- Shared `pickPrimary` policy for sync/async twins (done in roots.ts).
- `let`-free config loops (done via early-return loops + helper).
- DeepSeek cache stamp now includes winning path (done).
- `exists()` distinguishes ENOENT from other errors (done; others
  count as present so loaders surface them).
- Canonical `(legacy X also checked)` wording applied everywhere except
  the prompt tree diagram (parentheticals don't fit ASCII art; a
  precedence sentence follows the tree instead) — justified variance.
- `USER_LEGACY_PREFIX` → imported `USER_LEGACY_DISPLAY`; `path` →
  `candidate` in config loops; roots.ts uses `join` with adjacent
  `node:fs*` imports; one comment phrasing for the precedence rule.
- N/A (1): five-site render block (`loadMemorySnapshot` +
  `resolveBrainRoots` + `renderPreamble`) NOT extracted — pi/deepseek
  coalescing tests explicitly pin the snapshot-first call wiring
  through separate mocks; a shared helper would hide that seam for
  six saved lines per site.
- N/A (2): `ensureGlobalIgnore` appends the primary line when only
  legacy is present while `checkGlobalIgnore` accepts either — the
  append happens once (next run reports present), i.e. one-time
  normalize-on-write, not drift.

Note disposition: `PARTITIONS` length change is safe (missing roots
lint to zero findings); `tree-hash` dot-access rode along as a biome
fix; `resolveStateDirectory` stays sync by adapter-setup necessity
(documented in its comment); preamble default-root risk closed by (6).

## Grounding (fail-before evidence)

- New `roots.test.ts` (7 tests) and the preamble shadowing test
  exercise APIs that do not exist on the base tree (`resolveBrainRoots`
  fallback/flags, `legacyIgnored` warnings) — they fail there by
  construction and pass here.
- New cli tests (legacy reuse, both-exist status warning) fail on the
  base tree, which hardcoded primary paths and had no fallback.
- Session fail→pass trail: core `preamble.test` 10 failures before
  expectation updates; helper 14 failures before test migration;
  deepseek/pi coalescing failures before snapshot-first ordering —
  each resolved in-tree, none worked around.

## Verification (final tree)

- `bun run check` (root): 66 files, 553 tests, exit 0.
- Per-package gates: core 160, helper 103, opencode-v2 166,
  deepseek 72, pi 9, opencode 23 — all exit 0.
- `bun run lint:md`: 135 files, 0 issues.
