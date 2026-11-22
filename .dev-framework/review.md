# Review — helper-first push order + Codex manifest sync and 0.4.1 (this session)

## Scope — every changed file

Two upstream-derived fixes plus the patch release they enabled; no other product code touched:

- `scripts/push-release.sh` — tag plan/push order is now Helper-first (stable two-pass partition over the requested or discovered tags), mirroring upstream `#72`. Rationale preserved in comment: if a multi-tag sequence breaks midway, the foundation CLI is already published. Verified live: explicit order `pi, helper, codex` plans as `helper, pi, codex`.
- `scripts/release.sh` — Codex manifest sync on version bumps (same node one-liner idiom as the Claude fix, restored from the retired per-package flow), and the release commit's `git add` now includes `packages/codex/.codex-plugin/plugin.json`. Same dropped-step bug class as Claude: the port deleted the sync, upstream `#73` proves the sync is still required.
- `packages/codex/.codex-plugin/plugin.json` — `0.1.0` → `0.4.0` in the fix commit (the state the `0.4.0` release should have had), then → `0.4.1` by the release run itself. The manifest ships in the published tarball (`files` includes `.codex-plugin`), so this was user-visible drift, not metadata trivia.
- `.github/workflows/publish-codex.yml` — Validate step now asserts manifest version equals package version (adapted from upstream's check; marketplace leg omitted — our `.agents/plugins/marketplace.json` is the local-dev shape with no version field, unlike upstream's public catalog).
- Release `2da8997` `Release codex: 0.4.1` + tag `codex@v0.4.1` (package.json, plugin.json both `0.4.1` in the tagged tree, CHANGELOG section added). Dry-run qualified only `codex`. Commit + tag local; push is the operator's via `./scripts/push-release.sh` (tag on HEAD auto-discovered, helper-first is a no-op for a single tag).
- `.dev-framework/review.md` — this artifact, rewritten fresh.

## Findings and resolutions

- **style-enforcer (this session): clean.** Ordering loops follow the file's existing `for tag in $tags` idiom; sync block mirrors the adjacent Claude block exactly; workflow edit is one `test` line in the established validate-step shape. `bash -n` passes on both scripts.
- **pattern-guardian (this session): no drift.** Helper-first cites the upstream order instead of inventing a scheme; Codex sync reuses the Claude-block pattern added one session ago (one loop-adjacent `if` per package with a secondary manifest — no new abstraction). No new dependencies, helpers, or config keys.
- **code-reviewer (this session): no blocking issues.** Ordering is a stable partition (helpers first in original relative order, then the rest in original order) — no tag dropped or duplicated (verified: 3 in, 3 out, helper first). Sync runs after the `npm version` bump reading the just-written `package.json`, same as Claude. Tree fix brings the manifest to the currently published version before the release run bumps both together, so no version goes backward.
- **test-grounder (this session): grounded in the real flow.** (1) Fail-before: manifest `0.1.0` vs package `0.4.0` in tree (and upstream `#73` bumping both files together as the reference correct behavior); (2) explicit-order live run shows helper-first plan, piped stdin still refuses before any push; (3) dry-run qualified only `codex`; (4) full `./scripts/release.sh patch` run (its own validation gate green) produced tagged tree `2da8997` with both files at `0.4.1` (verified via `node -p` on the worktree files). Push path not executed (operator-only, sandbox-blocked).
- **Docs cadence:** `bun run lint:md` — exit 0 (re-run at commit time). No prose docs changed this session.
- **Prior reports reused unchanged:** earlier product-code findings stand; nothing else edited, nothing re-run, no blocking findings.

## Upstream #71 assessment (analysis only, no files changed)

Upstream retired the standalone `index` workflow: `index init` off the CLI table (kept as a hidden route that reports presence and nudges old plugins to update), all `operator-index` skills deleted, indexing folded into Project Init itself (greenfield/existing classification, automatic straightforward plans, approval-gated large plans, one subagent per index file, `index lint` as the check), preamble warning rewritten, `specs/commands.md` down to two workflows plus legacy-compat notes. Backward compatible by design — old plugins calling `index init` still get a working response.
Port surface in our fork: helper CLI + `index/init.ts` + `templates.ts` + deleted `index-setup.ts` template + rewritten project `setup.ts` (Phase 8 offer → inline indexing) + kiro template/install migration + per-adapter skill deletions and skill tests + core preamble warning/test + deepseek commands + guides, READMEs, indexes, and shared specs (`commands.md`, `preamble.md`, per-adapter `implementation.md`). Our divergences in exactly these areas (observation preamble block, v4 command contract docs, context-management core work) make this a real merge, not a cherry-pick. Recommendation: park until fork features land, then port as its own stacked change; no urgency since old clients keep working.

## Verification (final tree)

- `bash -n scripts/push-release.sh && bash -n scripts/release.sh` — exit 0.
- `bun run lint:md` — exit 0.
- Fix committed locally (`c27f31d`); release `2da8997` + tag `codex@v0.4.1` local; nothing pushed.
