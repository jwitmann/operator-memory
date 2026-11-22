# Review — docs staleness pass + release prep (this session)

## Scope — every changed file

- `docs/getting-started.md` — `/operator:index` line gains the
  stamp sentence (refresh records a structural stamp; agent warns
  on later staleness).
- `docs/architecture.md` — "Failure Is Visible" gains one
  mechanism sentence (tree hash on add/remove/rename, `index lint`
  warns, preamble nudges unstamped, content edits never stale).
- `docs/troubleshooting.md` — repair section gains the stale-index
  line (warning not error, refresh via `/operator:index` flow,
  `index lint` modifies nothing).
- Observations docs checked, no gap: getting-started lines 22/30
  and architecture lines 24/30-32 already describe v4 proposing
  and subordinate loading. Untouched.
- `.dev-framework/review.md` — this artifact.

No product code. Harness guides untouched (bare command listings;
stamp is a flow sub-step, not a harness command). No tables added;
H3-or-below, backticks, declarative voice throughout.

## Findings and resolutions

- **Docs review verdict: three minimal gaps, all filled.**
  `/operator:index` was documented as build-or-refresh with no
  staleness story; architecture's staleness paragraph named no
  mechanism; troubleshooting had no stale-index diagnosis. Each
  got one to two sentences in its existing section; no new
  sections, no restructured pages. Approved before writing.
- **Observations: no edit.** User-facing coverage already matches
  the shipped v4 (propose-in-conversation, approved-only storage,
  subordinate loading). Stating the check so it is not redone.
- **Release prep: helper + core-cascade set, proven by dry run.**
  `./scripts/release.sh minor --dry-run` on the clean tree
  reports: helper (changed since v1.11.0: `9331e05`, `360ca2b`)
  plus opencode-v2, pi, deepseek via the core cascade (phase-3
  core change `cc66bad`; built dists bundle core). Codex and
  claude-code are not core consumers per the script — no release.
  Legacy `packages/opencode` excluded (frozen). Docs changes
  release nothing. Minor bump is backward-compatible new surface
  (stamp command, lint warnings, rerun prompts). No
  bump/tag/push/publish performed — those stay explicit operator
  actions; dry run stops before step 4 (validation skipped in
  dry-run mode; the real run executes the full suite first).

## Verification (final tree)

- `bun run lint:md` — 135 files, 0 issues (covers all three
  doc edits and this artifact).
- Release-set evidence: `./scripts/release.sh minor --dry-run`
  on the clean tree (see handover note in chat).
- Working tree clean after commit; nothing pushed.
