# Review — markdownlint required (this session)

## Scope — every changed file

Make markdownlint enforced and repo-wide green. No product code changed
(nothing under `packages/` source; `bun.lock` delta is one pinned devDependency).

**Enforcement wiring:**

- `package.json` — new `lint:md` script
  (`markdownlint-cli2 --config .markdownlint-cli2.jsonc .`); `markdownlint-cli2`
  pinned in devDependencies (`^0.24.2`, was ad-hoc `npx -y` download).
- `bun.lock` — lockfile entry for the pinned devDependency.
- `scripts/check.sh` — `bun run lint:md || status=1` in the root path,
  same shape as the four existing checks.
- `.githooks/pre-commit` — `bun run lint:md` fail-exit step after biome lint.
- `.markdownlint-cli2.jsonc` — ignores fixed to `**/node_modules/**` and
  `**/dist/**` (bare `node_modules/**` never matched nested installs, ~1100
  third-party hits); MD033 disabled with reason (README product-banner HTML),
  matching the config's existing disabled-with-reason pattern.
- `.dev-framework/hardening.md` — lint invocation updated to `bun run lint:md`.
- `.dev-framework/review.md` — this artifact, rewritten fresh for this session.
- `.dev-framework.yml` — deliberately UNCHANGED: the gate's `{dir}`
  placeholder semantics for `.md` files are unknown; enforcement lives in
  check/hook/CI instead of invented gate config.
- `AGENTS.md` (fork-local, uncommitted) — lint invocation updated to
  `bun run lint:md`.

**Doc fixes (42 violations → 0):**

- `.operator-shared/guides/opencode-v2/hooks.md` — bare URL wrapped in `<>`.
- `.operator-shared/guides/opencode-v2/installation.md` — 2 bare URLs in `<>`.
- `.operator-shared/guides/opencode-v2/plugins.md` — bare URL wrapped in `<>`.
- `.operator-shared/guides/opencode-v2/sessions.md` — bare URL wrapped in `<>`.
- `.operator-shared/guides/opencode-v2/tui.md` — bare URL wrapped in `<>`.
- `.operator-shared/README.md` — bare URL in `<>`, bare fence → `sh`.
- `.operator-shared/index/helper.md` — blank line before `#####` heading.
- `.operator-shared/index/harnesses/opencode-v2/plugin.md` — duplicate
  `### src/` qualified to `` `plugin/src/` `` / `` `sdk/src/` ``.
- `.operator-shared/specs/reference/implementation.md` — `#### Commands` →
  `#### Command intents` (sentence-case per sibling H4s);
  `## Reference Implementation` → `## Reference Adapter Shape`
  (`### Commands` kept: live anchor `implementation.md#commands` linked from
  `.operator-shared/guides/antigravity/skills.md:37` — now unambiguous, previously
  two headings slugged to `#commands`); intro prose updated to name the new
  section (code-reviewer note).
- `.operator-shared/specs/pi/implementation.md` — double blank → single.
- `.operator/specs/working-state.md` (private, user chose to lint) — blank
  line after each of the 7 `##` log headings.
- `docs/getting-started.md` — `#### Example:` × 2 → `Example: existing
  project` / `Example: unfamiliar library` (fixes MD024 + MD026; no
  intra-repo `#example` links existed).
- `docs/harnesses/codex.md` — bare fence → `text`.
- `docs/harnesses/pi.md` — bare fence → `text`.
- `README.md` — trailing `.` in `###` heading (banner HTML covered by
  the MD033 disable).

## Findings and resolutions

- **markdownlint (docs cadence):** `bun run lint:md` → 129 files,
  **0 issues**. Was 42 issues in 15 tracked files (plus ~1100 ignored
  `node_modules` hits from the broken ignore pattern).
- **Full gate:** `bun run check` green on the final tree — format clean,
  biome lint clean, lint:md 0 issues, `tsc --noEmit` clean,
  63 files / 515 vitest tests pass.
- **Hook syntax:** `sh -n scripts/check.sh` and `sh -n .githooks/pre-commit`
  parse clean; both exercised by the gate run.
- **No product-code behavior change:** no `packages/` source diffs; `bun.lock`
  delta is the single pinned devDependency.
- **Specialists (launched for diligence on the wiring):**
  - pattern-guardian — CLEAN, no drift: `lint:md` naming/placement mirrors
    existing checks, pin converges (last `npx -y` gone), MD033 disable matches
    config's reason-comment pattern, scoped-`check.sh` omission is correct
    layering (no per-package md concept).
  - test-grounder — GROUNDED: `bun run lint:md` exit 0 / 0 issues,
    `bun run check` exit 0 (63 files / 515 tests), `sh -n` clean on both
    scripts, local binary resolution confirmed, no `packages/` source diffs.
  - style-enforcer — no blocking issues; one note (H4 Title Case vs
    sibling sentence-case) fixed (`Command Intents` → `Command intents`);
    reviewer also caught an MD038 in this artifact (fixed, lint re-greened).
    All other edits conform (URL form, fence languages, heading renames,
    blank lines, punctuation, config comment style, script/hook mirroring).
  - code-reviewer — one blocking (MD038 in this artifact from the prior
    session's wording — already fixed before the report arrived, lint
    re-greened), one note (stale "Reference Implementation section" prose —
    fixed). Verified sound: check.sh/hook shell + `set -eu` interaction,
    scoped-check omission, CI frozen-install, ignore fix, `#commands` anchor
    (rename removed a slug ambiguity in favor of the template section),
    all doc-fix transformations, MD033 disable as minimal call.

## Verification (final tree)

- `bun run lint:md` — exit 0, "Summary: 0 issues in 0 files".
- `bun run check` — exit 0, 63 test files / 515 tests pass.
- Changed files are exactly the 23 above (22 + this artifact); tree otherwise clean.
