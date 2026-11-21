# Review — per-tag release push guidance + recovery note (this session)

## Scope — every changed file

Process fix, two files; no product TypeScript touched:

- `scripts/release.sh` — (committed `8c4ade7`; unchanged this round) final message prints `git push origin HEAD` plus one `git push origin <tag>` per tag instead of `git push origin HEAD --tags`; "CI will publish" overclaim removed.
- `docs/dev/releasing.md` — Routine-release push step updated to match (branch first, one command per tag, original one-tag-per-push invariant cited); **new this round:** `If no publish workflow fired` recovery subsection (delete the remote tag first — re-pushing an unchanged tag fires no event — then push it again, one tag at a time, verifying each in Actions).
- `.dev-framework/review.md` — this artifact, rewritten fresh.

## Findings and resolutions

- **style-enforcer (this session): clean.** `release.sh` lines match the file's existing echo-block style; the new loop mirrors line 208. `releasing.md` keeps H2/H3 structure, backticked commands, no tables or diagrams. `bash -n scripts/release.sh` — exit 0. Repo gate (`scripts/check.sh`) has no shell-lint stage, so syntax + style conformance is the full style cadence for the script.
- **pattern-guardian (this session): no drift.** The new `for tag in $tags` loop mirrors the existing tagging loop at line 208 exactly. Docs change cites the original aerovato per-package push invariant rather than inventing a new mechanism.
- **code-reviewer (this session): no blocking issues.** Unquoted `$tags` is intentional (word-splitting iteration, as in line 208); tags are `pkg@vX.Y.Z`, never contain spaces. Trailing space in the accumulator yields no empty iteration (verified: 6 tags in, 6 lines out). Loop variable `tag` reassigned after the earlier loop — no leakage. "CI will publish" overclaim removed from both files.
- **test-grounder (this session): grounded by simulation, not full run.** A full `./scripts/release.sh` run would commit and tag — out of scope as a side effect, so not executed. Instead: (1) `bash -n` passes; (2) the new output block executed against a production-format `$tags` string emitted exactly the branch line plus 6 correct per-tag lines (no empty line from the trailing space). Fail-before contrast: the old single-command text is the instruction that produced today's lost tag events; the new per-tag text recreates one push event per tag, matching the original project's proven one-tag-per-push flow.
- **Docs cadence:** `bun run lint:md` — exit 0: 134 files, 0 issues. Covers `releasing.md` including the new recovery subsection.
- **Prior reports reused unchanged:** product-code findings from earlier rounds stand; no TypeScript edited this session, so nothing re-run and nothing invalidated. No blocking findings.

## Verification (final tree)

- `bash -n scripts/release.sh` — exit 0 (SYNTAX-OK).
- `bun run lint:md` — exit 0: 134 files, 0 issues.
- `dev_framework_verify` — PASS (prior round; re-run after commit).
- Change committed locally as `fix(release): per-tag push guidance` (`8c4ade7`); this round's recovery note to be committed as a follow-up; nothing pushed. The six `*@v*` tags from release `9063094` still await user-side delete + individual re-push to unstick publishing.
