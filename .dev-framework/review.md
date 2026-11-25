# Review — chore(adapters): cut Kiro + Antigravity, re-tier Pi/Codex/Claude

Scope: product-code deletion (dead install route + tests) plus docs/brain re-tiering. No new behavior.
This session's changed files (across `163b243` + `528cb01`):
Deleted: `packages/helper/src/commands/install/kiro.ts`, `packages/helper/src/templates/kiro.ts`, `docs/harnesses/kiro.md`, `.vcc-brain-shared/specs/kiro/implementation.md`, `.vcc-brain-shared/guides/kiro/` (8 files), `.vcc-brain-shared/guides/antigravity/` (6 files).
Edited product: `packages/helper/src/cli.ts`, `packages/helper/test/cli.test.ts`, `packages/helper/test/install-update.test.ts`.
Edited docs/brain: `README.md`, `docs/troubleshooting.md`, `docs/dev/decisions.md`, `packages/helper/README.md`, `packages/helper/src/templates/project/shared-readme.ts`, `.vcc-brain-shared/README.md`, `.vcc-brain-shared/catalog.md`, `.vcc-brain-shared/index/helper.md`, `.vcc-brain-shared/specs/reference/guides.md`, `.vcc-brain-shared/specs/pi/implementation.md`.
Intentionally untouched history: `packages/helper/CHANGELOG.md:73` (`add Kiro adapter (#50)`).
This artifact: `.dev-framework/review.md`.

## Change

- `install kiro` route, Kiro adapter sources, Kiro tests, Kiro harness doc/spec/guides, and all Antigravity guides removed. Help table, scaffold template, READMEs, troubleshooting, catalog, helper index, and guide standard de-referenced.
- README support table re-tiered: OpenCode V2 + DeepSeek stay Tier 1 (full system); Pi/Codex/Claude Code are Tier 2 (memory + setup commands, no deterministic compaction or cross-session recall; status varies — Pi footer, Codex/Claude none). Kiro row dropped with legend.
- Pi spec `Feature Parity` retitled to `Feature Scope (Tier 2)` so the documented footer status reads as implemented Tier-2 behavior, not a full-parity claim.
- Ownership recorded in `docs/dev/decisions.md`: lead does not run Pi/Codex/Claude and will not personally support them; Tier-2 survival depends on a contributing owner, else archival.

## Battery

- style-enforcer: 1 blocking find (stale Kiro install lines in `.vcc-brain-shared/README.md:35-36`, a live dangling route my own grep sweep missed) — fixed by deleting the lines to match the cut template; re-grep zero matches. Everything else clean: import order, help table, template shape, no new markdown violations.
- code-reviewer: PASS — zero `installKiro`/`KIRO_FILES`/kiro refs under `packages/`; switch covers all remaining install targets with `default → exitCode 2` intact; test removals coherent, no orphaned fixtures.
- pattern-guardian: 2 blocking drifts (Pi catalog entry + Pi spec Parity section claimed full-reference status surfaces against the Tier-2 contract) — resolved by re-baselining the tier definition to include Pi's footer as implemented behavior (README row/legend, catalog badge, spec retitle, decisions entry); re-confirmed PASS.
- test-grounder: full `bun run check` green — 68 files, 606 tests pass (down exactly 2 = the deleted Kiro tests; helper 141/141). `bun run lint:md` 0 issues in 116 files. Live probe of the rebuilt helper: `install kiro` → `Unknown command`, exit 2, help lists no Kiro row. Rebuilt `dist/` is git-ignored; tree holds only the two commits.

## Findings

- None blocking. All specialist reports PASS after fixes.
- Tracker hygiene (gate blocks 1–2/3): the gate's "session changed files" list contained 12 phantom tokens scraped from this session's shell probe commands — `echo`, `grep`, `sed` (command names), `25,45p`, `25,70p`, `40,90p`, `45,90p` (`sed -n` range arguments), `===CATALOG===`, `===GUIDESREF===`, `===HELPERIDX===`, `===HELPERREADME===`, `===SHAREDREADME===` (`echo` section separators), `antigravity\|kiro` (a `grep` pattern argument). None is a file: no such paths exist on disk and `git status` shows only the real files named in Scope above. The on-edit tracker tokenizes `bash` command text, so read-only probes (`sed -n`, `grep -n`) pollute the changed-file set. Mitigations applied: (1) all 12 tokens added to the session-scoped gate ignore hotlist via `dev_framework_ignore` (session-only, not stored — they can never be real paths); (2) this ledger names each token verbatim with its origin. No gate check was weakened: all 15 real files above received the full battery. Durable lesson: prefer `read`/`grep` tools over `sed`/`echo`-separator shell probes to keep the tracker clean.
