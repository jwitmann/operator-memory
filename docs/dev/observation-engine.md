# Observation Engine — Design Brief

Status: spec drafted (unapproved), no code. The roadmap line it resolves:
*"Learn durable user observations over time, kept separate from explicit
User Instructions."*

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

### 4. Wider trawl — frustration-counter pilot + trigger calibration (step (b), done 2026-11-20)

Corpus: 28,239 user messages / 3,304 sessions (26,190 opencode +
1,395 DSH v4 + 274 DSH projcache first-prompts + 380 DSH-TUI history
lines), extracted by script (`session_message type=user` +
`session.v4.jsonl.zstd` `user/message` with `source.kind=user` +
projcache `titleInput.first.text` + `history.jsonl`).
Scripts are throwaway scratch (`/tmp/opencode/obs-pilot/`), not repo tooling.
The two extra sources added 655 messages and ~zero strict hits:
first-prompts are task framings, TUI lines are one-shot commands —
neither carries correction language. Documented as coverage, not signal.

- Explicit durability language ("remember that", "from now on"): 32
  messages / 28 sessions (~0.9%). Rare, high-precision, insufficient alone.
- Loose correction set: 1,709 / 523 sessions. Loose recall-frustration
  (caps, `?!`, "why"): 2,243 / 317 sessions. Both dominated by false
  positives — see FP classes. Not trigger-grade.
- Strict correction set (told-you / why-did-you / revert / stop-doing /
  …): 194 / 94 sessions (2.8%). ≥2/session: 37 sessions. ≥3/session:
  22 sessions (0.7%) — the hand-reviewable pilot cohort.
- Strict recall-frustration (forgot / already-told / how-many-times /
  you-keep / do-you-remember): 50 / 44 sessions (1.5%). ≥2/session:
  6 sessions; ≥3: 0. The counter runs cheap and fires rarely: a metric,
  not a standalone trigger. Combined trigger (correction≥3 OR
  recall≥2) ≈ 26 sessions.
- Verified samples are real durable preferences stated as corrections:
  *"HOW MANY times do I need to say that"* (log routing),
  *"DO NOT TAKE SHORTCUTS, DO NOT ASSUME what i want"* (working style).
- FP classes (for trigger hygiene): pasted terminal output, pasted or
  injected docs (DSH user-role messages include injected context and
  pasted brain text — its 352 loose-"again" hits are mostly this),
  code-discussion vocabulary ("instead of", "wrong" about code under
  review). Mitigation is positional, not lexical: skip messages that
  are pasted artifacts, count per session, require ≥2–3.
- Deterministic topic identity — tested twice, failed twice:
  verbatim/near-verbatim repeats across sessions: 1 group (generic "I
  don't think this is correct", not a rule) — users paraphrase, never
  re-state. Rare-word overlap (≥3 shared distinctive words): 20,020
  pairs, flooded by formulaic prompt templates (review invocations share
  "correctness review … project" vocabulary) — unusable without clause
  isolation, which itself needs judgment.
- Calibration output: the trigger stays dumb counting (deterministic,
  per the reshape); topic identity and clause isolation live in the
  LLM-drafted proposal step, which operates over a ~26-session cohort —
  hand-sized, bounded cost, user approves. Probe question 1 ("what event
  shapes signal durable fact") is answered structurally: counts select
  the sessions, judgment selects the facts.

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

## Investigation sequence (agreed)

- (c) Analogue survey first — only step that can kill or reshape candidates.
- (b) Wider transcript trawl second, framed as the frustration-counter pilot.
- (a) Exact duplication quantification on standby — verdict already
  established; run only if evidence is challenged.

## Analogue survey (step (c) — done 2026-11-20)

Five systems, same five fields. Sources fetched, not snippeted.

### ChatGPT memory (Dreaming update, June 2026)

- Detection: background process synthesizes a profile from past chats, files,
  connected apps; saved-memories list now legacy. LLM-judged throughout.
- Control: auto-write, user corrects after the fact ("Memory updated" +
  Manage; "Don't mention this again"; per-source correction).
  No propose-before-write anywhere.
- Staleness: no stated mechanism; OpenAI admits the visible summary "does not
  include everything ChatGPT remembers" (transparency gap).
- Precision evidence: "context rot" (Taylor, Every, Feb 2026, building on
  Breunig's taxonomy): poisoning (hallucinated fact saved as gospel),
  distraction (accuracy decay with context load), confusion (vibe treated as
  binding directive — the Kanye case), clash (January vs June preferences
  contradict; cf. 39% multi-turn drop, Microsoft/Salesforce). Plus complaint
  threads on memory getting worse post-GPT-6 and "remembers nouns, forgets
  reasoning."
- Constraint fit: violates background-agents, deterministic-triggers, and
  propose-never-auto. The failure-mode exhibit, not the model.
- Last verified: 2026-11-20
  (`help.openai.com/en/articles/8590148-memory-in-chatgpt`,
  `every.to/.../why-i-turned-off-chatgpt-s-memory`).

### Codex local memories (`$CODEX_HOME/memories[_v2]/`)

- Detection: background pass after chat-idle, LLM extraction
  (`memories.extract_model`) + global consolidation
  (`memories.consolidation_model`); skips short-lived sessions, low
  rate-limit, redacts secrets.
- Control: OFF by default (explicit on-switch, per machine); per-chat
  `/memories` use/contribute toggles; generated files inspectable but
  "don't rely on editing them by hand."
- Staleness: consolidation model merges; no user-facing queue.
- Precision evidence: none published (too new for complaint literature).
- Constraint fit: closest coding-agent analogue, but background extraction +
  auto-write violate two constraints. Adopts the hierarchy we need:
  "Keep required team guidance in `AGENTS.md`… Treat memories as a helpful
  recall layer, not the only source."
- Last verified: 2026-11-20 (`learn.chatgpt.com/docs/customization/memories`).

### Claude Code auto memory (on by default, local sessions)

- Detection: Claude writes four typed notes (`user`, `feedback`, `project`,
  `reference`) during the session; skips anything derivable from code or
  already in CLAUDE.md. LLM-judged.
- Control: ON by default; `/memory` browses/toggles; files are plain
  markdown the user can edit or delete; explicit "remember that…" also lands
  here (not in CLAUDE.md unless asked).
- Staleness: MEMORY.md index capped (200 lines / 25KB); host reminds Claude
  to shorten, merge, or drop stale entries near the cap. Machine-local,
  per-repo, excluded from transcript retention sweeps.
- Precision evidence: no complaint literature found yet; docs carry their own
  caution ("treated as context, not enforced configuration"; conflict →
  arbitrary pick; `/doctor prompt-audit` for instruction files).
- Constraint fit: the only analogue with user-editable markdown storage and
  an explicit instructions-vs-learnings split (CLAUDE.md table). Still
  LLM-judged detection + auto-write — our propose step would be stricter
  than the market leader.
- Last verified: 2026-11-20 (`code.claude.com/docs/en/memory`).

### Cursor / Copilot (the split absence-and-convergence)

- Cursor core: NO inferred memory — carryover is whatever is written into
  rules / memory-bank files (explicit, agent-readable). Inference exists
  only via third-party plugins (supermemory MCP: background save/recall).
- Copilot: now HAS "Copilot Memory" (repo facts + personal preferences) with
  the same subordinate posture — "Keep reviewed team requirements in
  source-controlled project documentation or custom instructions";
  store/recall/correct via explicit prompt.
- Reading: the coding-agent market converges on inferred-recall-layer
  subordinate to checked-in explicit instructions. Nobody ships
  inferred-memory-as-authority; nobody ships propose-before-write.
- Last verified: 2026-11-20 (`docs.github.com/en/copilot/concepts/.../copilot-memory`,
  `code.visualstudio.com/docs/agents/run/memory`, Cursor forum/supermemory docs).

### mem0 (the excluded pipeline, documented for the record)

- Detection: per-message LLM fact extraction → dedup → embed (vector DB +
  SQL + entity store). ADD-only: never silently overwrites; explicit
  update/delete ops.
- Control: API-level, developer-owned; no end-user propose surface.
- Staleness: accumulation + retrieval ranking (semantic + BM25 + entity
  fusion) instead of curation.
- Constraint fit: violates no-embeddings, no-vector-DB, no-background-agents
  simultaneously — the exclusion stands, but ADD-only is a useful staleness
  datum: retrieval-time ranking as an alternative to write-time curation.
- Last verified: 2026-11-20 (`docs.mem0.ai/core-concepts/how-it-works`).

### Local corpus (9 brains scanned)

- No `~/.operator` brain contains any cross-session user-learning mechanism.
  Closest hit is VCC `/recall` (session-log retrieval) — different bucket
  (knowledge retrieval, not observation learning). The premise holds:
  no existing mechanism, only manual simulation (brief §1–§2).

### Verdict: SURVIVE, reshaped

- Kill criterion 3 (intrinsic unmitigable failure) does NOT trigger:
  context rot is real, but every mitigation analogues use — user-visible
  markdown, edit/delete, per-project scoping, index caps, explicit-over-
  inferred hierarchy — fits our constraints. Our propose-never-auto is
  stricter than anything shipped, i.e. the strongest mitigation on the market.
- Reshape: no analogue does deterministic detection — all use LLM judgment
  (extract/consolidation models, background synthesis). So the detector
  cannot be "deterministic extraction"; it must be **deterministic trigger
  - LLM-drafted proposal**: era boundary / correction-count / frustration
  threshold fires deterministically, the proposal text is LLM-drafted, the
  user approves. That split satisfies "deterministic triggers" (the *when*
  is arithmetic) while conceding the *what* needs judgment.
- Candidates after reshape: (2) fingerprint-era prompt is the natural
  deterministic window; (3) frustration counter is the natural deterministic
  trigger-metric; (1) correction harvest needs the trigger defined as
  counting, not judging. (b) the transcript trawl now doubles as the
  frustration-counter pilot AND the trigger-calibration data (what threshold
  would have fired, how often).
- Kill criteria 1–2 and probe questions unchanged; (b) proceeds on that basis.

## Proposal-flow spec (draft 2026-11-20, unapproved)

Decision: balanced trigger — per-session detection, era-batched proposals,
immediate escalation on recall-frustration.

### 1. Detection (deterministic, at session end)

- Count strict correction hits and strict recall-frustration hits (pattern
  sets from §4) over user-role messages of the closing session.
- Paste hygiene: skip messages that are pasted artifacts (terminal output,
  fenced code/docs blocks, injected context) before counting. Heuristic
  specifics deferred to implementation; the FP classes are documented.
- Flags: `CORRECTION_RICH` (≥3 correction hits), `RECALL_HIT` (≥2
  recall-frustration hits). Recorded in the session receipt alongside
  existing per-session bookkeeping. Thresholds are the calibrated values,
  tunable per deployment.
- Cost: arithmetic over the already-stored session log. No model calls,
  no background work, no embeddings. Skip short sessions (Codex precedent).

### 2. Proposal (judgment, at era boundary)

- Input: flagged sessions since the last era move. Measured scale is
  ~26 sessions per corpus — hand-sized, bounded drafter cost.
- The drafter (LLM) does what counting cannot: topic identity, correction-
  clause isolation, and dedup against the user partition (a candidate that
  restates an existing instruction is dropped, not proposed).
- Output: candidate list, each with evidence pointers (session, turn) so
  the approver can verify against the incident.

### 3. Approval (propose-never-auto)

- One batched approval moment per era via the question tool: per candidate
  approve / edit / reject. Rejections are recorded (rejected shape is not
  re-proposed) — the annoyance budget is enforced by construction.
- Escalation: a `RECALL_HIT` session triggers an immediate proposal instead
  of waiting for the era. Measured rarity (6 sessions in the corpus) keeps
  the interruption budget negligible; approval quality is maximal exactly
  when the pain is fresh.

### 4. Storage and authority

- Promoted facts live in the user partition with their own standing,
  separate from explicit User Instructions. On conflict, explicit
  instructions win (the market consensus from the survey).
- Cross-project dedup is the headline value: one copy in the user
  partition replaces the 3–6 copy-pasted doctrines from §2.

### 5. Switch and metrics

- Explicit on/off switch, default OFF (house rule: observation features are
  opt-in). Off means no counting, no proposals; the frustration counter
  also stops (no silent measurement of a user who opted out).
- The frustration counter keeps running while on, as the health metric.
  Kill criteria 1–2 become acceptance thresholds: if accepted proposals
  don't outnumber the duplicated doctrines they replace, or annoyance
  reports (rejections + complaints) exceed approvals, the feature is
  rethought or killed — measured, not assumed.

### Deferred to implementation

- Paste-detection heuristic specifics; rejection-memory shape; exact
  question-tool surfacing; reference to the fingerprint-era machinery
  for the era-boundary hook.

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
