# Review — Claude manifest sync + 0.3.1 patch release (this session)

## Scope — every changed file

Real bug fix plus the patch release it enabled; no other product code touched:

- `scripts/release.sh` — restored the plugin-manifest sync the `release.sh` port dropped from the old `publish-claude-code.sh`: after bumping `claude-code`, its `.claude-plugin/plugin.json` version is synced from `package.json` (same node one-liner idiom as the original), and the release commit's `git add` now includes the manifest. Without this, every future Claude release would fail the workflow's manifest-version validation, exactly like `v0.3.0` did.
- `packages/claude-code/.claude-plugin/plugin.json` — `0.2.0` → `0.3.0` in the fix commit (the state `9063094` should have had), then → `0.3.1` by the release run itself, proving the new sync step works in the real flow.
- Release `9b62b55` `Release claude-code: 0.3.1` + tag `claude-code@v0.3.1` (3 files: `package.json`, `plugin.json`, `CHANGELOG.md` — both version files read `0.3.1` in the tagged tree). Only `claude-code` qualified (dry-run confirmed the rest unchanged). Commit + tag local; push is the operator's via `./scripts/push-release.sh`.
- `.dev-framework/review.md` — this artifact, rewritten fresh.

## Findings and resolutions

- **style-enforcer (this session): clean.** Sync block reuses the retired `publish-claude-code.sh` node one-liner idiom verbatim; `bash -n` passes. Manifest edit is a version string only.
- **pattern-guardian (this session): no drift.** Restores the original per-package-script behavior instead of inventing a new mechanism; the `git add` extension follows the existing line. Prior push-script/docs findings stand (nothing re-run, nothing invalidated).
- **code-reviewer (this session): no blocking issues.** Sync runs only for `pkg = claude-code`, after the `npm version` bump, reading the just-written `package.json` — ordering correct. No other package has a secondary version file (repo-wide grep confirmed), so no other package needs this.
- **test-grounder (this session): grounded in the real flow.** (1) Fail-before: `package.json 0.3.0` vs `plugin.json 0.2.0` reproduced the CI validation failure line-for-line; (2) dry-run after the tree fix qualified only `claude-code`; (3) the full `./scripts/release.sh patch` run (its own validation gate green) produced tagged tree `9b62b55` with both files at `0.3.1` (verified via `git show`) — exactly what the workflow's validation asserts. Push path not executed (operator-only, sandbox-blocked).
- **Docs cadence:** `bun run lint:md` — exit 0: 134 files, 0 issues. Covers `releasing.md`.
- **Prior reports reused unchanged:** product-code findings from earlier rounds stand; no TypeScript edited this session, so nothing re-run and nothing invalidated. No blocking findings.

## Publish diagnosis (recorded after the fact — operator findings, no repo change)

- All six tag-push events eventually fired and all six publish workflows
  ran green through build/pack, then failed identically at `npm publish`
  with `ENEEDAUTH` — systematic, and re-runs failed the same way.
- Root cause: **none of the six `@jwitmann/*` packages has npm trusted
  publishing configured**, so the OIDC path never authenticates. The Nov 20
  "CI published" reading was wrong: those versions went up manually and CI
  only skipped its publish step (version already present) plus created the
  GitHub releases — which is why the workflows looked green.
- Fix is account-side, not repo-side: on npmjs.com, add a trusted
  publisher to each package (repo `jwitmann/operator-memory` + its
  `publish-<pkg>.yml` workflow), then re-run the six failed jobs. No
  workflow or script change required; `scripts/push-release.sh` and
  `docs/dev/releasing.md` already describe the correct mechanics.

## Verification (final tree)

- `bash -n scripts/push-release.sh && bash -n scripts/release.sh` — exit 0.
- `bun run lint:md` — exit 0: 134 files, 0 issues.
- Process fix + `claude-code: 0.3.1` release committed locally; pushes were the operator's.
- **Final outcome (operator-confirmed): all six packages published, all workflows green** — including `claude-code@v0.3.1` after the manifest-sync fix. Full loop proven end to end: `release.sh` → operator `push-release.sh` (branch + one push per tag) → per-tag publish workflows → npm via trusted publishing. The red `claude-code@v0.3.0` run remains as history; `0.3.1` supersedes it.
