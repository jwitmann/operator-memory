# Review — README OpenCode VCC wording (this session)

## Scope — every changed file

- `README.md` — "For the best long-session results" OpenCode bullet only.
  Rewrote the single bullet from "ships inside — enable during project-init,
  which flips enabled on" to the non-magical contract: bundled but inert
  until opt-in, Brain required, both enable paths (per-project
  `<project>/.operator/config.json` scaffolded disabled with a
  setup-interview prompt, org defaults via `operator.contextManagement` in
  `opencode.json`, project file wins), deterministic `vcc` only when the
  framed checkpoint is smaller with a keepID tail else host summary with
  Brain-referencing shaping (`shaped`), verified via
  `~/.operator/state/context-log/<sessionID>.log`
  (`engine=vcc|shaped`, `refusal reason=brain-unavailable`).
- `.dev-framework/review.md` — this artifact.

No product code. Docs-only change.

## Findings and resolutions

- **Finding 1 (user): "flips enabled on" read as automatic — misleading.**
  Source of truth is `packages/helper/src/templates/project/setup.ts`
  Phase 6: scaffold disabled, agent asks via question tool, writes flipped
  flags only on opt-in, only when `Created` this run (`Preserved` skips).
  Config precedence confirmed in `packages/opencode-v2/src/index.ts` and
  `src/project-config.ts` (defaults < `opencode.json` < `.operator/config.json`).
  Resolution: bullet now says "scaffolded disabled ... with a
  setup-interview prompt to enable it", plus the `opencode.json` alternative.
- **Finding 2 (user): bundled does not mean it magically works.**
  Confirmed in `packages/opencode-v2/src/compaction.ts` and
  `src/compaction-compiler.ts`: deterministic override persists verbatim
  with no model call only when the checkpoint is smaller and a keepID tail
  exists at/after the cut (proven live on v2.3.2); otherwise abstains and
  shapes the host summary. Feature is off by default and Brain-gated
  (refusal receipt, one per session). Spec:
  `.operator-shared/specs/opencode-v2/implementation.md` (Context Management).
  Resolution: bullet now states the off-by-default + Brain-inert + `vcc`
  vs `shaped` conditions and the receipts log as the verification surface.
- **Cadence: docs-only, no specialists.**
  Per the gate instructions, product-code battery (style-enforcer,
  test-grounder, code-reviewer / pattern-guardian) is out of scope;
  markdown lint is the entire battery. No specialist re-runs needed;
  nothing to invalidate.

## Verification (final tree)

- `bun run lint:md` — 135 files, 0 issues.
- `git diff --stat` — `README.md` only (1 insertion, 1 deletion in effect;
  single-bullet rewrite). Uncommitted; no push.
