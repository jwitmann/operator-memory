# Review — framework activation (standard profile)

## Scope (this session's changes)

- `.dev-framework.yml` (new, untracked) — profile standard, typecheck/test
  gate, TS lint template, three protected paths, rules pointer.
- `.dev-framework/hardening.md` (new, untracked) — project contract: Bun
  install + hooksPath trap, per-package builds, full verification, fresh
  review, scope discipline, plan execution.
- `.gitignore` (+1 line) — ignore root `/opencode.jsonc` local config.
- `docs/dev/observation-engine.md` (+sequencing section, agreed (c)→(b)→(a)
  order plus two formatting fixes).

No product code changed; nothing under `packages/` touched.

## Findings and resolutions

- **pattern-guardian** — clean, no blocking drift. One formatting nit (blank
  line in sequencing edit) — fixed.
- **code-reviewer** — clean. All yml commands, protect paths, hardening
  claims, and agent names verified against real files.
- **style-enforcer** — one blocking (MD022/MD032: missing blank line after
  `## Open / probe questions`) — fixed by restoring the blank line. One
  note (118-char bullet vs file hand-wrap convention) — fixed by wrapping
  with 2-space continuation indent.
- **test-grounder** — GROUNDED. Full gate green (63 files, 515 tests);
  per-package core/opencode-v2 checks green; no fail-before/pass-after test
  required (no behavior change). Noted the repo-wide markdownlint config
  (`globs: **/*.md`) can never run fully green due to pre-existing hits in
  untouched files — out of scope; touched files verified scoped-clean.

## Verification (final tree)

- `bun run check` — green (format, lint, tsc, 515 vitest).
- `markdownlint` on touched files (scoped file args) — clean.
