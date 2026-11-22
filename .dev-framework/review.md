# Review — drop hardcoded `web` profile (this session)

## Scope — every changed file

- `README.md` — "For the best long-session results" DeepSeek bullet:
  `dsh plugin --profile web add dsh-compaction-vcc` →
  `dsh plugin --profile <profile-name> add dsh-compaction-vcc`.
- `docs/harnesses/deepseek.md` — context-management paragraph, same
  hardcoded profile → same `<profile-name>` placeholder.
- `.dev-framework/review.md` — this artifact.

No product code. Docs-only change.

## Findings and resolutions

- **Finding (user): hardcoded `web` assumes everyone's profile.**
  Correct — shipped profiles include `web`, `headless`, `sdk`, `acp`
  (plus `sdk-minimal` standalone and reserved `desktop`), per
  `.operator-shared/guides/deepseek/installation.md`. The canonical
  form elsewhere is already `dsh plugin --profile <profile-name> add
  @jwitmann/operator-deepseek` (`docs/harnesses/deepseek.md:16`) and
  `dsh plugin --profile <name> add <package-or-spec>` (guide). The two
  hardcoded `web` spots were the outliers.
  Resolution: both now use `<profile-name>`, matching the rest of the
  docs. No behavior change.
- **Cadence: docs-only, no specialists.**
  Markdown lint is the entire battery.

## Verification (final tree)

- `bun run lint:md` — 135 files, 0 issues.
- `git diff --stat` — `README.md`, `docs/harnesses/deepseek.md` (plus
  this artifact). Uncommitted; no push.
