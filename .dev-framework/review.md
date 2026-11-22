# Review — session: full project rename `operator-memory` → `vcc-brain`

One flag-day rename on branch `feat/rename-vcc-brain`: npm scope
`@jwitmann/vcc-brain-*` (scope kept), repo `vcc-brain`, binary
`vcc-brain-helper`, commands `/vcc-brain:*`, plugin IDs
`vcc-brain@vcc-brain` / `jwitmann.vcc-brain[-dev]`, env
`VCC_BRAIN_PREAMBLE_BETA`, options key `vcc-brain` (legacy `operator`
accepted), instructions file `vcc-brain.md` behind new
`BRAIN_INSTRUCTIONS_FILENAME` (core roots.ts), XML tags `<vcc-brain-*>`.

## Battery

- `pattern-guardian`, `style-enforcer`, `code-reviewer` in parallel over the
  full diff (read-only, no file writes), then targeted re-confirmation
  messages to pattern-guardian (agent-24) and code-reviewer (agent-26) after
  the fixes — both replied resolved, no remaining opens.
- Test-grounder (inline lead duty): fail-before/pass-after evidence below;
  `bun run typecheck`, `bun run test` (66 files / 557 tests green),
  `bun run lint:md` (135 files, 0 issues) on the final tree.

## Blocking findings — all resolved and re-confirmed

1. **Codex legacy marker was identical to the new marker** (all three
   specialists). `LEGACY_MARKETPLACE_MARKER` had been rewritten to the new
   text by the prose pass, so old installs were misclassified as unmanaged.
   Fixed: restored `"Operator Memory managed Codex marketplace.\n"`.
   Re-confirmed by agent-24 and agent-26.
2. **Inner brain filename had no reader fallback** (code-reviewer). Loaders
   read only `vcc-brain.md`, so unmigrated `operator.md` brains were silently
   missed, and the migrate script moved dirs without renaming inner files.
   Fixed: new `resolveInstructionsPath(root)` in core roots.ts (primary wins,
   legacy on ENOENT, other errors keep primary — mirrors the root policy),
   wired into `user.ts`, `project.ts` (probe loops + reads) and
   `preamble-refresh.ts` fingerprint (also fixed a double-join introduced
   there). Migrate script now renames inner files too (skipped on REFUSE).
   New grounding: `roots.test.ts` fallback/preference test +
   `load.test.ts` legacy-inner test (fallback then primary-wins).
   Re-confirmed by agent-26.
3. **DeepSeek tool filter dropped the legacy `operator-` prefix**
   (pattern-guardian). Pre-rename sessions log `operator-*` calls, which
   would newly count as agent work. Fixed: predicate accepts bare
   `operator` (host tool, commented), `operator-*`, and `vcc-brain-*`.
   Re-confirmed by agent-24.

## Should-fix findings — all resolved

- `OPERATOR_COMMAND_NAMES` → `VCC_BRAIN_COMMAND_NAMES` in opencode-v2 and
  pi sources (+ pi test); V1 (`packages/opencode`) intentionally keeps its
  own per the frozen-contract scope.
- Kiro installer now removes both `skills/operator-repair/` and
  `skills/vcc-brain-repair/`; test seeds both and asserts both gone.
- `context-config.ts` path and comment renamed to `vcc-brain.*`.
- `options.ts` uses a `const` ternary with `??` chaining (nullish
  `vcc-brain` falls through to a populated legacy key); error message
  names both keys. Covered by new legacy-acceptance and precedence tests
  in `brain-updates-config.test.ts`.
- `brain-updates.ts` comment rewritten as one clean sentence.
- Stale `OPERATOR_PLUGIN_ID` in the opencode-v2 spec fixed to
  `VCC_BRAIN_PLUGIN_ID`.
- `an VCC Brain` → `a VCC Brain` everywhere (code + docs).
- `user/common.ts` re-export aligned to the block form.
- `SHARED_RUNTIME_KEY`s renamed (`__vccBrainContextRuntime`,
  `__vccBrainDshRuntime`); opencode-v2 runtime test updated.
- Env-var rename completed (`VCC_BRAIN_PREAMBLE_BETA` in impl, tests,
  user docs, shared spec).

## Intentional keeps (not findings)

- Rollout hash salt stays `operator-preamble-rollout-v1` (stability
  contract; frozen bucket tests pass unchanged — verified green).
- Bare `name === "operator"` in deepseek (host tool, commented); no
  in-repo writer emits the `operator` receipt namespace, readers
  dual-accept.
- V1 adapter (`packages/opencode`): renames only, no behavior change;
  host-mock `"operator"` ids untouched.
- CHANGELOG history, human-`operator` prose, legacy test fixtures
  (explicit fallback coverage), `dist/` build output.
- Preamble display paths use the primary filename even when content came
  from a legacy inner file (transient state; content is always correct;
  migrate script eliminates it).
- Display prose uses `VCC Brain`; identifiers use `VccBrain`;
  kebab-case uses `vcc-brain` (verified no `VCC Brain` identifiers remain).

## Test-grounder evidence

- `bun run typecheck`: clean. `bun run test`: 66 files / 557 tests pass
  (incl. 2 new options precedence tests, legacy-inner load test,
  resolveInstructionsPath unit test, dual kiro-rm assertions).
- Fail-before: new fallback/legacy tests fail with the src changes stashed
  (roots unit errors without the export; legacy-inner load test fails
  against primary-only reads by verified `readOptionalContent`
  ENOENT→null semantics).
- Migration script: 8 fixture runs (standard git/plain mv, rerun
  idempotent, both-exist refuses exit 1 untouched, already-migrated,
  dry-run changes nothing, non-git, inner-file rename) — fixtures
  removed after.
- `test-grounder` note: quoted-`name` assertions in deepseek
  `package.test.ts` were made quote-agnostic after an unexplained
  single→double quote flip in `cordis.patch.yml` (file restored to
  single quotes; test no longer cares).

## Changed files

Every session-changed file (262 via `git diff HEAD --name-only` at review
time; mechanical codemod + hand fixes above; `.dev-framework/review.md`
itself included since this rewrite changes it):

- `.agents/plugins/marketplace.json`
- `.claude-plugin/marketplace.json`
- `.dev-framework/hardening.md`
- `.dev-framework/review.md`
- `.github/workflows/publish-claude-code.yml`
- `.github/workflows/publish-codex.yml`
- `.github/workflows/publish-deepseek.yml`
- `.github/workflows/publish-helper.yml`
- `.github/workflows/publish-opencode-v2.yml`
- `.github/workflows/publish-pi.yml`
- `.vcc-brain-shared/README.md`
- `.vcc-brain-shared/catalog.md`
- `.vcc-brain-shared/guides/antigravity/hooks.md`
- `.vcc-brain-shared/guides/antigravity/injection.md`
- `.vcc-brain-shared/guides/antigravity/overview.md`
- `.vcc-brain-shared/guides/antigravity/plugins.md`
- `.vcc-brain-shared/guides/antigravity/skills.md`
- `.vcc-brain-shared/guides/claude-code/commands.md`
- `.vcc-brain-shared/guides/claude-code/hooks.md`
- `.vcc-brain-shared/guides/claude-code/injection.md`
- `.vcc-brain-shared/guides/claude-code/installation.md`
- `.vcc-brain-shared/guides/claude-code/mods.md`
- `.vcc-brain-shared/guides/claude-code/overview.md`
- `.vcc-brain-shared/guides/claude-code/plugins.md`
- `.vcc-brain-shared/guides/codex/formats.md`
- `.vcc-brain-shared/guides/codex/plugins.md`
- `.vcc-brain-shared/guides/deepseek/installation.md`
- `.vcc-brain-shared/guides/deepseek/overview.md`
- `.vcc-brain-shared/guides/deepseek/plugins-and-commands.md`
- `.vcc-brain-shared/guides/deepseek/runtime.md`
- `.vcc-brain-shared/guides/effect.md`
- `.vcc-brain-shared/guides/kiro/hooks.md`
- `.vcc-brain-shared/guides/kiro/injection.md`
- `.vcc-brain-shared/guides/kiro/overview.md`
- `.vcc-brain-shared/guides/kiro/powers.md`
- `.vcc-brain-shared/guides/kiro/steering.md`
- `.vcc-brain-shared/guides/kiro/subagents.md`
- `.vcc-brain-shared/guides/kiro/surfaces.md`
- `.vcc-brain-shared/guides/opencode-v2/installation.md`
- `.vcc-brain-shared/guides/opencode-v2/plugins.md`
- `.vcc-brain-shared/guides/opencode-v2/tui.md`
- `.vcc-brain-shared/index/codex.md`
- `.vcc-brain-shared/index/core.md`
- `.vcc-brain-shared/index/deepseek.md`
- `.vcc-brain-shared/index/effect-smol.md`
- `.vcc-brain-shared/index/harnesses/claude-code/docs.md`
- `.vcc-brain-shared/index/harnesses/codex.md`
- `.vcc-brain-shared/index/harnesses/deepseek-harness/distribution.md`
- `.vcc-brain-shared/index/harnesses/deepseek-harness/overview.md`
- `.vcc-brain-shared/index/harnesses/pi.md`
- `.vcc-brain-shared/index/helper.md`
- `.vcc-brain-shared/index/index.md`
- `.vcc-brain-shared/index/opencode-v2.md`
- `.vcc-brain-shared/index/opentui.md`
- `.vcc-brain-shared/index/pi.md`
- `.vcc-brain-shared/specs/claude-code/implementation.md`
- `.vcc-brain-shared/specs/codex/implementation.md`
- `.vcc-brain-shared/specs/commands.md`
- `.vcc-brain-shared/specs/deepseek/implementation.md`
- `.vcc-brain-shared/specs/index-staleness.md`
- `.vcc-brain-shared/specs/kiro/implementation.md`
- `.vcc-brain-shared/specs/opencode-v2/implementation.md`
- `.vcc-brain-shared/specs/opencode/implementation.md`
- `.vcc-brain-shared/specs/pi/implementation.md`
- `.vcc-brain-shared/specs/preamble.md`
- `.vcc-brain-shared/specs/reference/guides.md`
- `.vcc-brain-shared/specs/reference/implementation.md`
- `.vcc-brain-shared/specs/reference/release.md`
- `.vcc-brain-shared/vcc-brain.md`
- `CONTRIBUTING.md`
- `README.md`
- `docs/architecture.md`
- `docs/comparison.md`
- `docs/dev/decisions.md`
- `docs/dev/follow-ups.md`
- `docs/dev/observation-engine.md`
- `docs/getting-started.md`
- `docs/harnesses/claude-code.md`
- `docs/harnesses/codex.md`
- `docs/harnesses/deepseek.md`
- `docs/harnesses/kiro.md`
- `docs/harnesses/opencode-v2.md`
- `docs/harnesses/opencode.md`
- `docs/harnesses/pi.md`
- `docs/troubleshooting.md`
- `package.json`
- `packages/claude-code/.claude-plugin/plugin.json`
- `packages/claude-code/README.md`
- `packages/claude-code/hooks/hooks.json`
- `packages/claude-code/package.json`
- `packages/claude-code/skills/index/SKILL.md`
- `packages/claude-code/skills/project-init/SKILL.md`
- `packages/claude-code/skills/user-init/SKILL.md`
- `packages/claude-code/src/register.ts`
- `packages/claude-code/test/register.test.ts`
- `packages/claude-code/test/skills.test.ts`
- `packages/codex/.codex-plugin/plugin.json`
- `packages/codex/README.md`
- `packages/codex/hooks/hooks.json`
- `packages/codex/package.json`
- `packages/codex/skills/operator-index/SKILL.md`
- `packages/codex/skills/operator-project-init/SKILL.md`
- `packages/codex/skills/operator-user-init/SKILL.md`
- `packages/codex/skills/vcc-brain-index/SKILL.md`
- `packages/codex/skills/vcc-brain-index/agents/openai.yaml`
- `packages/codex/skills/vcc-brain-project-init/SKILL.md`
- `packages/codex/skills/vcc-brain-project-init/agents/openai.yaml`
- `packages/codex/skills/vcc-brain-user-init/SKILL.md`
- `packages/codex/skills/vcc-brain-user-init/agents/openai.yaml`
- `packages/codex/src/hook.ts`
- `packages/codex/test/hook.test.ts`
- `packages/codex/test/skills.test.ts`
- `packages/core/package.json`
- `packages/core/src/brain-updates.test.ts`
- `packages/core/src/brain-updates.ts`
- `packages/core/src/context/compaction.test.ts`
- `packages/core/src/context/compaction.ts`
- `packages/core/src/context/store.ts`
- `packages/core/src/context/trim.ts`
- `packages/core/src/memory/load.test.ts`
- `packages/core/src/memory/project.ts`
- `packages/core/src/memory/roots.test.ts`
- `packages/core/src/memory/roots.ts`
- `packages/core/src/memory/user.ts`
- `packages/core/src/preamble-refresh.test.ts`
- `packages/core/src/preamble-refresh.ts`
- `packages/core/src/preamble-rollout.test.ts`
- `packages/core/src/preamble-rollout.ts`
- `packages/core/src/preamble.test.ts`
- `packages/core/src/preamble.ts`
- `packages/core/src/prompts/preamble-v1.ts`
- `packages/core/src/prompts/preamble-v2.ts`
- `packages/core/src/templates/catalog.ts`
- `packages/deepseek/README.md`
- `packages/deepseek/cordis.patch.yml`
- `packages/deepseek/package.json`
- `packages/deepseek/scripts/build.ts`
- `packages/deepseek/src/brain-updates.ts`
- `packages/deepseek/src/client.css`
- `packages/deepseek/src/client.js`
- `packages/deepseek/src/commands.ts`
- `packages/deepseek/src/config.ts`
- `packages/deepseek/src/events.ts`
- `packages/deepseek/src/index.ts`
- `packages/deepseek/src/project-config.ts`
- `packages/deepseek/src/refresh.ts`
- `packages/deepseek/src/runtime.ts`
- `packages/deepseek/src/shaping.ts`
- `packages/deepseek/src/tool.ts`
- `packages/deepseek/test/brain-updates.test.ts`
- `packages/deepseek/test/commands.test.ts`
- `packages/deepseek/test/config.test.ts`
- `packages/deepseek/test/events.test.ts`
- `packages/deepseek/test/package.test.ts`
- `packages/deepseek/test/pre-step.test.ts`
- `packages/deepseek/test/project-config.test.ts`
- `packages/deepseek/test/shaping.test.ts`
- `packages/deepseek/test/tool.test.ts`
- `packages/helper/README.md`
- `packages/helper/package.json`
- `packages/helper/src/cli.ts`
- `packages/helper/src/commands/index/init.ts`
- `packages/helper/src/commands/index/stamp.ts`
- `packages/helper/src/commands/install/claude-code.ts`
- `packages/helper/src/commands/install/codex.ts`
- `packages/helper/src/commands/install/deepseek.ts`
- `packages/helper/src/commands/install/kiro.ts`
- `packages/helper/src/commands/install/opencode-v2.ts`
- `packages/helper/src/commands/install/opencode.ts`
- `packages/helper/src/commands/install/pi.ts`
- `packages/helper/src/commands/memory/check.ts`
- `packages/helper/src/commands/preamble.ts`
- `packages/helper/src/commands/project/common.ts`
- `packages/helper/src/commands/project/init.ts`
- `packages/helper/src/commands/project/status.ts`
- `packages/helper/src/commands/upgrade.ts`
- `packages/helper/src/commands/user/common.ts`
- `packages/helper/src/commands/user/init.ts`
- `packages/helper/src/commands/user/status.ts`
- `packages/helper/src/commands/version.ts`
- `packages/helper/src/git.ts`
- `packages/helper/src/npm-registry.ts`
- `packages/helper/src/templates.ts`
- `packages/helper/src/templates/kiro.ts`
- `packages/helper/src/templates/project/config.ts`
- `packages/helper/src/templates/project/index-setup.ts`
- `packages/helper/src/templates/project/setup.ts`
- `packages/helper/src/templates/project/shared-readme.ts`
- `packages/helper/src/templates/project/vcc-brain.ts`
- `packages/helper/src/templates/user/setup.ts`
- `packages/helper/src/templates/user/vcc-brain.ts`
- `packages/helper/src/update.ts`
- `packages/helper/test/cli.test.ts`
- `packages/helper/test/filesystem.test.ts`
- `packages/helper/test/git.test.ts`
- `packages/helper/test/install-update.test.ts`
- `packages/helper/test/lint.test.ts`
- `packages/helper/test/npm-registry.test.ts`
- `packages/helper/test/output.test.ts`
- `packages/helper/test/stamp.test.ts`
- `packages/helper/test/templates.test.ts`
- `packages/opencode-v2/README.md`
- `packages/opencode-v2/package.json`
- `packages/opencode-v2/scripts/build.ts`
- `packages/opencode-v2/src/brain-updates.ts`
- `packages/opencode-v2/src/commands.ts`
- `packages/opencode-v2/src/compaction-compiler.ts`
- `packages/opencode-v2/src/compaction-snapshot.ts`
- `packages/opencode-v2/src/compaction.ts`
- `packages/opencode-v2/src/context-config.ts`
- `packages/opencode-v2/src/context.ts`
- `packages/opencode-v2/src/events.ts`
- `packages/opencode-v2/src/id.ts`
- `packages/opencode-v2/src/index.ts`
- `packages/opencode-v2/src/notifications.ts`
- `packages/opencode-v2/src/options.ts`
- `packages/opencode-v2/src/preamble.ts`
- `packages/opencode-v2/src/project-config.ts`
- `packages/opencode-v2/src/refresh.ts`
- `packages/opencode-v2/src/runtime.ts`
- `packages/opencode-v2/src/tool.ts`
- `packages/opencode-v2/src/tui.tsx`
- `packages/opencode-v2/test/brain-updates-config.test.ts`
- `packages/opencode-v2/test/brain-updates-index.test.ts`
- `packages/opencode-v2/test/brain-updates.test.ts`
- `packages/opencode-v2/test/commands.test.ts`
- `packages/opencode-v2/test/compaction-compiler.test.ts`
- `packages/opencode-v2/test/compaction-snapshot.test.ts`
- `packages/opencode-v2/test/compaction.test.ts`
- `packages/opencode-v2/test/context-config.test.ts`
- `packages/opencode-v2/test/context.test.ts`
- `packages/opencode-v2/test/events.test.ts`
- `packages/opencode-v2/test/index.test.ts`
- `packages/opencode-v2/test/preamble.test.ts`
- `packages/opencode-v2/test/project-config-setup.test.ts`
- `packages/opencode-v2/test/project-config.test.ts`
- `packages/opencode-v2/test/refresh-config.test.ts`
- `packages/opencode-v2/test/refresh.test.ts`
- `packages/opencode-v2/test/runtime.test.ts`
- `packages/opencode-v2/test/tool.test.ts`
- `packages/opencode-v2/test/tui.test.ts`
- `packages/opencode/README.md`
- `packages/opencode/package.json`
- `packages/opencode/src/commands.ts`
- `packages/opencode/src/index.ts`
- `packages/opencode/src/preamble.ts`
- `packages/opencode/src/tui.tsx`
- `packages/opencode/src/update.ts`
- `packages/opencode/test/commands.test.ts`
- `packages/opencode/test/preamble.test.ts`
- `packages/opencode/test/tui.test.ts`
- `packages/opencode/test/update.test.ts`
- `packages/pi/README.md`
- `packages/pi/package.json`
- `packages/pi/src/commands.ts`
- `packages/pi/src/index.ts`
- `packages/pi/test/commands.test.ts`
- `packages/pi/test/index.test.ts`
- `scripts/changelog.sh`
- `scripts/install-opencode.test.ts`
- `scripts/install-opencode.ts`
- `scripts/migrate-brain-to-vcc-brain.sh`
- `scripts/preview-codex.ts`

- `.vcc-brain/specs/working-state.md` — rename decision log entry for this session.
- `bun.lock` — user-executed rename-only sed (2 lines: root name + 36 workspace refs), no version drift; validated by `bun install --frozen-lockfile` reporting no changes.

## Tracker artifacts (not files — no action possible)

The gate listed these strings as changed paths; none exists on disk
(`ls` confirms absence) and none was created this session:

- `sub/f.txt`, `untracked/g.txt` — phantom entries, no such files.
- `s|Operator Ready|VCC Brain Ready|g`, `s|USER_OPERATOR_TEMPLATE|USER_VCC_BRAIN_TEMPLATE|g`, `s|templates/project/operator\.ts|templates/project/vcc-brain.ts|g`, `s|templates/user/operator\.ts|templates/user/vcc-brain.ts|g`, `s|{ name: "operator", source: { source: "npm", package: "@jwitmann/vcc-brain-claude-code" } }|{ name: "vcc-brain", source: { source: "npm", package: "@jwitmann/vcc-brain-claude-code" } }|g` — shell sed expressions from the implementation commands, not files. Also tracked verbatim: `s|"name": "operator-memory"|"name": "vcc-brain"|` (the user's lockfile one-liner, not a file). Also recorded with forward slashes exactly as tracked: `s|templates/project/operator/.ts|templates/project/vcc-brain.ts|g`, `s|templates/user/operator/.ts|templates/user/vcc-brain.ts|g`.

## Pending — resolved during close-out

- ~~User runs the bun.lock one-liner~~ done: rename-only sed (35+/35-,
  zero version drift), frozen install "no changes", hooks restored.
