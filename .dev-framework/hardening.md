# vcc-brain hardening

Project contract, appended after the bundled constitution. Follow
`AGENTS.md` (gates, hooks, branch conventions) and `CONTRIBUTING.md`;
what's here is what those don't spell out per-task.

## 1. Build the project way

- Bun owns everything: `bun install --frozen-lockfile` (CI-verified).
  After ANY install, restore `git config core.hooksPath .git/hooks-local`
  (`bun install` resets it to `.githooks`, and the wrong hook runs the
  wrong gate).
- Per-package builds: `bun run build:<helper|opencode-v2|pi|codex|claude-code|deepseek>`.
  Never hand-edit `dist/` — it is build output (protected).
- Scoped gate while iterating: `bun run check packages/<pkg>`; full gate
  before finishing.

## 2. Full verification before done

- `bun run check` at root must be green (format:check with auto-fix,
  biome lint, `tsc --noEmit`, `vitest run` — 515 tests currently).
- Per-commit floor from `AGENTS.md`: `bun run check packages/core` and
  `bun run check packages/opencode-v2` green; root fully green before
  declaring done. A PASS before the last edit is stale — re-run on the
  final tree.
- Touched Markdown: `bun run lint:md` (repo-wide, zero-issues enforced).
- The `.githooks/pre-commit` enforces format/lint/typecheck/test, so a
  commit that passed hooks already cleared the suite once.

## 3. Fresh review every task

- After edits, before declaring done: `pattern-guardian` (drift),
  `style-enforcer` (conventions), `code-reviewer` (correctness),
  `test-grounder` (evidence) — investigation only, never edits.
- Consolidate blocking findings into `.dev-framework/review.md`,
  rewritten fresh for THIS session's changed files and resolutions
  (a file from a previous task never counts). Then resolve every
  blocking item or record why it doesn't apply.

## 4. Scope discipline

- Surgical changes on stacked branches (`<type>/<kebab>`,
  conventional commits `<type>(<area>):`); never refactor unrelated code.
- Commit locally when work is complete; never push, never open PRs —
  those are user actions. Park unrelated findings in one line each.
- New helpers/abstractions/dependencies get a `pattern-guardian`
  check first (reuse before create).

## 5. Executing plans

- This repo rarely uses written plans; when one exists, execute it as
  `/df-goal <objective>` (or `Implement the plan in <path>`) so native
  completion requires the gate's PASS. A `dev_framework_verify` FAIL
  is a verdict — fix the cause, never declare the plan met without a
  PASS in the transcript.
