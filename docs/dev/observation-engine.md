# Observation Engine — Design Brief

Status: exploration (Phase 1 evidence complete, no code). Ends in a
spec or a kill memo. The roadmap line it resolves: *"Learn durable user
observations over time, kept separate from explicit User Instructions."*

## Question

What do agents get re-taught across sessions that the Brain
structurally cannot retain today? Three buckets: *observations*
(inferred user preferences, correction patterns, working-style facts)
vs. *instructions* (explicit rules the user stated) vs. *knowledge*
(project truth). If nothing falls in the first bucket in practice,
kill the item.

## Evidence

### 1. The user performs the mechanism by hand (strong)

Project brains carry dated learning annotations — each one a durable
observation the user wrote into instructions after an incident:

- opencode-dev-framework: *"Learned 2026-11-13…"*, *"relearned
  2026-11-12"*, *"Stated by user 2026-11-12"*, *"twice burned, Phases
  25–26"*
- animeRSS: *"(User instruction 2026-11-09)"*

The mechanism doesn't exist, so the user simulates it. Every annotation
is a promotion that happened manually.

### 2. User doctrines duplicated across projects (strong)

Same rules in 3–6 project files each — not project facts (ports, paths)
but user-level engineering doctrine with nowhere to graduate to:

- "Commit locally, never push" — 6 files (user partition + 5 projects)
- Secrets handling (never echo, feed programmatically) — 3 projects
- No data migrations in production code — 3 projects
- Anchored `.gitignore` patterns — 3 projects
- Explicit sized types for persisted values — 3 projects
- Ask-first lists (behavior changes, deps, removals) — 3 projects

Meanwhile the user partition is 18 lines. Promotion is manual
copy-paste, so it doesn't happen; the doctrines stay duplicated.

### 3. Transcript mining (supporting, noisy)

Keyword trawl over user-role messages in session history (197k
messages): 59 correction-shaped messages ("i told you" / "why did
you" / "not what i"), 3 explicit "remember that". Keyword hits need
hand-verification (code discussion is a heavy false-positive source),
but verified samples are real:

- *"I told you to test new 'profiles' without affecting existing
  thaifa code."* — a durable project-scoped preference, stated as a
  correction, retained nowhere.
- *"HOW HARD IS IT TO REMEMBER THAT"* (funds-source mapping) — a
  second signal class: frustration-with-recall, i.e. the user
  perceiving the agent as forgetting. Worth tracking as its own
  metric even before any engine exists.

Method limit: keyword mining undercounts (most preferences are never
stated with these exact words) and overcounts (quoted/code text). It
corroborates; the brain annotations carry the argument.

## Constraints (eliminate designs early)

- No embeddings, no vector DB, no background agents (product
  philosophy) — no mem0-style extraction pipeline.
- Local-only; deterministic triggers where possible (house precedent).
- Explicit on/off switch (roadmap contract).
- Propose, never auto-write (brain-nudge philosophy + question-tool
  pattern) — promotion proposals go through the user like the setup
  interview does.
- Separation from explicit instructions is definitional — the natural
  home is the user partition with its own authority, plus cross-project
  dedup as the headline value (evidence §2).

## Candidate shapes (not specs)

- **Post-session correction harvest**: detect correction-shaped events
  (user re-states, overrides, repeats a cross-project rule), propose
  promotion to the user partition. Hard part is the detector
  (precision); storage/surfacing already exist.
- **Fingerprint-era promotion prompt**: reuse the brain-updates era
  machinery — at each era move, diff what the user corrected since the
  last era and propose the durable subset. Observation window for free.
- **Frustration counter**: track recall-failure signals per topic as a
  pure metric first (no proposals). Cheapest, validates whether the
  problem is big enough to deserve 1 or 2.

## Open / probe questions

- What event shapes reliably signal "durable user fact" vs. one-off
  instruction (explicit "remember that…" vs. inferred from correction)?
- False-positive cost of a bad promotion proposal (annoyance rate)?
- Does the fingerprint era give the observation window, or do
  observations need their own cadence?

## Kill criteria

- The corpus shows agents mostly re-learn *project* facts (covered) and
  rarely re-learn *user* facts beyond what's already promoted.
- Proposals annoy more than the duplication costs (measured, not assumed).
- The sibling-system literature shows the failure mode is intrinsic
  (stale/hallucinated preferences presented as fact) and unmitigable
  within the constraints above.
