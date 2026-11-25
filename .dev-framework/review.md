# Review — docs(pi-tuck): point Pi users at third-party compaction

Scope: docs-only, three files. Surfaces pi-tuck (`npm:pi-tuck`, source `github.com/galyavin/pi-tuck`) as the deterministic-compaction pairing for Pi users: same no-model-call idea (transcript-preserving cuts plus exact post-cut recall), maintained outside this project; VCC Brain stays memory-only on Pi and leaves `/compact` plus automatic cuts to it. Tier 2 scope unchanged.
This session's changed files:
Edited: `README.md` (Pi bullet under "For the best long-session results"), `docs/harnesses/pi.md` (new `Compaction` section), `.vcc-brain-shared/specs/pi/implementation.md` (`Potential Compaction Source` H3, `Last Updated` → November 25, 2026). Public wording states plainly that no adapter wires pi-tuck and VCC Brain together yet and one needs writing; no maintainer commitment.
This artifact: `.dev-framework/review.md`.

## Change

- Public docs now answer "what do I compact with on Pi?" instead of leaving Tier 2 Pi users with the LLM summarizer; the brain spec records the same candidate plus the adapter integration shape (no competing compactor, receipts attributed to the external engine, currently unprobed).

## Battery (docs cadence)

- `bun run lint:md` (repo config, 116 files): 0 issues, exit 0. No product code touched; no specialists required, none re-run.

## Findings

- None blocking.
