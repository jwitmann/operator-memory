# Review — fix(release): push explicit tag refspec, avoid @ DWIM miss

Scope: release-infra one-liner, no product behavior. During the 1.14.1/2.7.1/1.5.1 push, `git push origin opencode-v2@2.7.1` failed with `src refspec does not match any` while the tag existed and `rev-parse --verify` resolved it — git's DWIM source-side rev-parse chokes on `@` in push refspecs.
This session's changed files:
Edited: `scripts/push-release.sh`.
This artifact: `.dev-framework/review.md`.

## Change

- Tag push uses the explicit full refspec `refs/tags/$tag:refs/tags/$tag` instead of the bare name. Same semantics (one push per tag, per-tag workflow events preserved), no DWIM involved. The `--delete` path needs no change (`--delete` takes a destination name, not a source refspec; its `ls-remote` guard already uses the full ref).
- Recovery for the interrupted push: re-run `./scripts/push-release.sh opencode-v2@2.7.1 pi@v1.5.1` (branch + helper tag are already up; the fix commit rides the branch push first).

## Battery

- peer-review (agent-44): PASS — refspec form correct, quoting/`set -u` safe, delete path reviewed and cleared, per-tag event behavior preserved.
- test-grounder: `bash -n` clean. No executable test path for the interactive push script (operator-only by design); evidence is the review plus the read-only verification that the failed tag object is healthy (annotated, created by release.sh, `rev-parse` + `check-ref-format` clean).
- Other specialists: scope unchanged since last reports — reused per cadence.

## Findings

- None blocking.
