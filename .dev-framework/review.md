# Review — operator-only push script (this session)

## Scope — every changed file

Process fix, three files; no product TypeScript touched:

- `scripts/push-release.sh` — **new.** Operator-only release push: branch first, then one push per tag so every tag-push event reaches Actions. Defaults to local `<pkg>@v*` tags pointing at HEAD (the release just made); explicit tags override; `--repush` deletes each tag from origin first (re-pushing unchanged fires no event). Hardened against agent execution: confirmation requires an interactive terminal (`[ ! -t 0 ]` refuses piped stdin), and there is intentionally no `--yes` bypass. Header, `--help`, and docs all state agents must never run it.
- `scripts/release.sh` — final message now points at `./scripts/push-release.sh` as the single publish path instead of printing per-tag commands (transparent but bypassable). The flawed `git push origin HEAD --tags` instruction is gone from all repo files (repo-wide grep for `HEAD --tags` / `CI will publish`: no matches).
- `docs/dev/releasing.md` — Routine-release section uses the script (normal + `--repush` modes) with the one-tag-per-push rationale and the original `git push --atomic origin main "$tag"` invariant cited; recovery subsection uses `--repush` and states terminal-only use.
- `.dev-framework/review.md` — this artifact, rewritten fresh.

## Findings and resolutions

- **style-enforcer (this session): clean.** New script follows `release.sh` conventions (`set -euo pipefail`, `cd` to repo root, `case` flag parsing, `--help` via `sed`). `releasing.md` keeps structure, backticked commands, no tables/diagrams. `bash -n` passes on both scripts.
- **pattern-guardian (this session): no drift.** Flag parsing mirrors `release.sh`; per-tag `for tag in $tags` loop mirrors its tagging loop. Docs cite the original aerovato one-tag-per-push invariant rather than inventing a mechanism.
- **code-reviewer (this session): no blocking issues.** Default discovery (`git tag --points-at HEAD --list '*@v*'`) scopes to the just-made release — never the whole history, so `--repush` cannot mass-delete published tags. Explicit args bypass discovery for recovery. `--repush` deletes a remote tag only if `ls-remote` confirms it exists; the local tag is untouched, so the re-push recreates the event. Detached HEAD and empty-discovery both abort with actionable messages. No secret handling; push auth stays with the operator's own credentials.
- **test-grounder (this session): safe paths executed, push path not.** Pushing is a deliberate user action and the sandbox blocks it — correctly, since this script is operator-only. Evidence: (1) `bash -n` both scripts, exit 0; (2) `--help` prints the full usage block; (3) piped-stdin run printed the plan then refused (`Refusing: run this script yourself in a terminal...`, exit 1) — the agent-execution barrier verified live; (4) no-discovery path errors correctly when no tags point at HEAD. Fail-before contrast: the removed `HEAD --tags` instruction is what lost today's six tag events.
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
- Process fix committed locally (`7a29f42`); this diagnosis note amends
  the review only. Nothing pushed.
