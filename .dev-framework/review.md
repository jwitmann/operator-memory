# Review — release helper 1.14.0, deepseek 0.7.0, opencode-v2 2.7.0

Scope: release-only. No product code changed.
Files: `packages/helper/package.json`, `packages/deepseek/package.json`,
`packages/opencode-v2/package.json` (minor version bumps);
`packages/helper/CHANGELOG.md`, `packages/deepseek/CHANGELOG.md`,
`packages/opencode-v2/CHANGELOG.md` (generated sections);
`.dev-framework/review.md` (this artifact).

## Change
- helper 1.13.0 → 1.14.0, deepseek 0.6.0 → 0.7.0, opencode-v2 2.6.0 → 2.7.0
  (plain `X.Y.Z`, no `v` prefix, repo convention).
- Changelogs generated with `scripts/changelog.sh` off conventional commits:
  helper 5 entries, deepseek 3, opencode-v2 2 — all `feat`, all under
  `### Features`, commit-linked bullets in the established shape.
- Exclusion correct: pi, codex, claude-code have zero commits since their
  tags; their changelogs top out at 2026-11-22.
- Commit `0f6c2d4` stat is exactly those 6 files; message shape
  (`Release helper: X, deepseek: Y, opencode-v2: Z`) mirrors `0c5d923`.
- Annotated tags `helper@v1.14.0`, `deepseek@v0.7.0`, `opencode-v2@v2.7.0`
  all peel to `0f6c2d4`. No push (deliberate user action).

## Battery
- style-enforcer (odf-style-enforcer-2): PASS — version format, changelog
  heading/bucket/link shape, markdownlint-clean (MD024 guard retained).
- code-reviewer (odf-code-reviewer-3): content checks pass (versions match
  tags, counts 5/3/2, subset relationship holds, no behavioral files);
  shell-verification gaps closed by lead: tags exist, stat is 6 files,
  in-range commits are exactly the changelog SHAs, all `feat` →
  converts to PASS.
- pattern-guardian (odf-pattern-guardian-1): PASS — file-set shape mirrors
  `0c5d923`, no cross-package leakage, exclusion correct; commit/tag text
  verified by lead (message shape mirrors prior, tags peel to `0f6c2d4`).
- test-grounder (lead, test evidence): version strings + generated prose
  carry no behavioral surface — nothing to fail-before. Suites on this
  tree: helper 145/145, deepseek 77/77, core 177/177, opencode-v2 174/174.
  Full-workspace parallel flake (2 sqlite timeouts) proven pre-existing:
  same tree passes per-package; release commit cannot affect outcomes.

## Findings
- None blocking. All specialist reports PASS (one via lead-completed
  shell verification); test evidence recorded.
