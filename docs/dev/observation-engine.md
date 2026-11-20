# Observation Engine — Design Brief

Status: spec drafted (v4 conversational proposing = next build, unapproved;
v3 full automation parked), no code. The roadmap line it resolves:
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

Corpus note (reconciliation): the 197k figure is the phase-1 all-roles
total at that time (the opencode store has since grown to 385,064 rows,
28,586 of them user-role). The §4 corpus below is user-role messages
only, 28,239 / 3,304 sessions at 2026-11-20. Percentages use the §4
corpus; the §3 absolute counts are not directly comparable, but the
qualitative finding stands.

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

## Proposal-flow spec (draft v4 2026-11-20, unapproved; NEXT BUILD)

v4 replaces automation with conversation. The agent, in-session and in
possession of full live context, offers; the user agrees on the spot.
Canonical shape: *"I could add this as a permanent rule — should I do
that?"* No detector, no counting, no era machinery, no pending store, no
rejection memory, no metrics pipeline. v3 (below) is parked as the
recorded full-automation direction; it earns a second look only if manual
proposing produces volume that justifies automating the trigger.

### 1. Trigger: agent discretion, in the flow

The agent offers when it recognizes a promotable moment — no flags, hooks,
or session-end arithmetic. The rubric lives in `~/.operator/user/operator.md`
(the user partition's operator file, cross-project by construction), written
by the user-init flow for new installations and by the existing memory-aware
loop for existing ones — a few lines, not a subsystem. It is NOT a per-project
or shared-repo file: project partitions get nothing new to load.

- The user corrected the same thing twice (in this session or visibly before).
- The user said "remember that" / "from now on" (explicit durability language).
- A preference clearly applies beyond this project (cross-project smell).

Anything else — hunches, single corrections, project-local facts — stays
unproposed. The agent's live context is the topic-identity and
sanitization mechanism that v3 built machinery to replicate offline.

### 2. Proposal: question tool, in the moment

Candidate + why (the incident) + scope (`user` or `project`), via the
question tool per house pattern — `question` on OpenCode (registered in
the host's internal tools), `ask_user_question` on DeepSeek — or a plain
conversational offer for trivial cases and hosts without an answerer.
User approves / edits / declines. A decline is just a
decline: no rejection store, no caps, no cooldowns. The context window is
the dedup mechanism at this scale, best-effort: the agent won't offer
twice for the same thing in one conversation because it can see it just
asked — if compaction makes an earlier offer uncertain, do not re-offer
(a rare duplicate at this signal rate is acceptable; no machinery).

### 3. Storage: the §5 half that survives, with explicit loading

- Canonical surface: `~/.operator/user/observations.md` — user-approved,
  subordinate. **It does not load itself:** the Core user loader reads
  only `operator.md` and `catalog.md` today (`packages/core/src/memory/user.ts`),
  so the build must extend the loader/preamble to load `observations.md`
  (fail-closed: absent file → no observations, same as Brainless), include
  it in the fingerprint set, and render it subordinate — a separate
  labeled block AFTER all instruction layers (user > shared > private),
  so instruction precedence is untouched. Alternative (lower cost, no Core
  change): a `user-notes` entry in the User Catalog read-if "observations
  and working-style notes" — agents load it on demand rather than every
  session. Default to the explicit load: observations are cross-project
  and short; the catalog route risks never being read.
- Every candidate declares `kind` (`observation` vs `explicit_instruction`)
  and `scope` (`user` vs `project`). Project-scoped candidates write to
  `.operator/operator.md` (project private instructions, the already-loaded
  surface — no new file type), never the user partition. Sensitive
  candidates are barred from both (secrets exclusion below).
- Explicit instructions route to the explicit flow, never auto-convert.
- Promotion ≠ replacement: duplicated copies are retired only by a
  separately approved migration step.
- Secret/sensitive exclusion: no credentials, tokens, paths-to-secrets,
  or personal data beyond working preferences; the offer itself flags
  suspected sensitivity.
- Conflict mechanism: best-effort screening against every active layer
  at approval time, suspected conflicts shown beside the candidate.
  Observations revalidate (stale-flag) when relevant instruction
  fingerprints change. Recorded limit: LLM screening cannot guarantee
  conflict detection; approval + subordinate rendering are mitigations.
- Never merged into `operator.md` — separation is definitional.

### 4. Switch semantics (v4-local)

- Config key `observation` (boolean, default OFF), same opt-in contract as
  the other observation-class features; without an initialized Brain the
  surface is inert (refusal receipt per session, as with the existing
  opt-ins).
- OFF suppresses proposing. Loading is independent: previously approved
  observations keep loading (they are user-approved content, not live
  measurement) — a user wanting them gone deletes the file.
- No collection machinery exists in v4, so there is nothing else to gate;
  the v3 §7 retention table is parked and does not apply.

### 5. Explicit non-goals

Detector v0.1, receipts, era windows, pending store, run-ids, rejection
memory, frustration counter, metrics pipeline, escalation design — all
parked with v3. If proposing volume ever makes the manual flow a burden,
THAT is the quantified trigger for automating detection, and the v3
design below is where that work resumes.

### 6. Nag guard (norm, not machinery)

Offer rarely: at most one observation proposal per session as a standing
norm, waived only for an explicit "remember that". No counter, no
enforcement — at ~3–5 durable finds per 3,300 sessions, over-proposing is
a taste failure, not a systems problem.

## Proposal-flow spec (draft v3 2026-11-20, unapproved; PARKED)

v2 failed second-pass verification as an implementable contract (6 of 12
findings partial + 3 new contradictions: unfrozen regexes, allowlist
ambiguity, missing era lifecycle, snooze/consumption clash,
metric-accounting gaps, frozen-vs-tunable tension). v3 closes them with
exact artifacts and state machines. Remaining product defaults are marked
DEFAULT (overturnable); no open DECIDEs.

### 0. Detector v0.1 (frozen; replayed, not asserted)

Exact patterns (JavaScript regex, case-insensitive `i` flag; `\b` are
ASCII word boundaries; `'?` is an optional straight apostrophe, so
`don't` and `dont` both match; `.*` in one pattern is a greedy wildcard):

```text
CORRECTION (14):
/\bi told you\b/i  /\bwhy did you\b/i  /\bnot what i\b/i
/\byou should have\b/i  /\bas i said\b/i  /\bdo it again\b/i
/\brevert\b/i  /\bundo that\b/i  /\bstop doing\b/i  /\bdon'?t do that\b/i
/\bignore that\b/i  /\bnot like that\b/i  /\bi asked for .* not\b/i
/\bthat'?s not what\b/i
RECALL (13):
/\byou forget\b/i  /\byou forgot\b/i  /\bforgetting\b/i
/\balready told\b/i  /\bhow many times\b/i  /\btimes have i\b/i
/\btold you before\b/i  /\byou never remember\b/i
/\byou always forget\b/i  /\bdo you remember\b/i
/\bdon'?t you remember\b/i  /\bhave to remind\b/i
/\bkeeps? forgetting\b/i
```

Any pattern change — including the wildcard's scope, boundary behavior,
or apostrophe coverage — is a detector version bump (v0.2) with a
mandatory re-replay before its counts supersede v0.1's.

- Matching semantics: one boolean hit per class per message (a message can
  hit both classes; repeated matches in one message count once). Message =
  one user-role text unit.
- Text normalization (shared by detector hygiene and rejection identity):
  strip fenced code blocks (multiline and inline) → replace every
  non-alphanumeric character with a space → lowercase → collapse whitespace
  → trim. Detector regexes run against normalization step 1 output
  (fences stripped, case preserved — equivalent under the `i` flag).
- Paste hygiene v0.1 (deterministic): after fence-stripping, drop the
  message if <20 chars remain, if it matches
  `Traceback (most recent call last)`, or if it matches shell-prompt line
  `^\S+@\S+:` (multiline). Mixed case keeps the prose outside the fence.
  This exact definition is what the replay ran — no sibling variants.
- Session eligibility: ≥3 user messages (short/probe sessions skipped,
  Codex precedent). Replay on the §4 corpus (3,304 sessions): 584
  eligible; correction 80 sessions / 171 msgs; recall 43 / 48; corr≥3:
  21 sessions; recall≥2: 5; combined trigger: **23 sessions**. These
  numbers supersede the v1 pre-hygiene counts.
- Hand-label verdict (all 23 reviewed): ~3–5 contain genuinely durable
  candidates (cross-project working style, project-scoped rules); the rest
  is session-local repair churn — the `revert` pattern dominates because
  strategy research reverts constantly. Session-level precision ≈15–20%:
  the trigger selects *candidate sessions*, the drafter rejects churn.
- Adversarial cases the implementation must pass: quoted corrections (user
  quoting someone else), injected instructions in user-role, fenced output
  combined with a real correction in one message, repeated matches in one message
  (counts once), agent meta-reasoning quoting the user.

### 1. Detection (deterministic, at session end)

- Count detector-v0.1 hits over user-role messages of the closing session.
- Flags: `CORRECTION_RICH` (≥3), `RECALL_HIT` (≥2). Tunable per
  deployment; thresholds are configuration, patterns/hygiene are the
  frozen version — v0.1 means both together, and tuning thresholds does
  not change the version (comparability rule is in §6).
- Every receipt carries, flagged or not: detector version, active
  thresholds, eligible-message count, eligible-session boolean, per-class
  hit counts (no message content). Unflagged sessions are interpretable
  (zero hits vs ineligible), and tuning stays auditable.
- Honest inventory: no session-end hook or session receipt exists today
  (red-team cites: `brain-updates.ts` resets per-session state,
  OpenCode evaluates per-request). Detection needs: a session-close hook
  (or next-session reconciliation for crashed sessions), a receipt field,
  and a durable pending-proposal store with atomic claim/consumption.
  Reused: fingerprint read, `tool/call`+`tool/result` join.
- Cost: arithmetic over the already-stored session log. No model calls,
  no background work, no embeddings.

### 2. Drafting-input sanitization (fail-closed allowlist)

- The drafter receives ONLY spans that satisfy all three: (a) from a
  user-role message, (b) surviving paste hygiene v0.1, (c) carrying at
  least one detector hit (corrected or recall-frustrated prose). Anything
  else — injected context, pasted documents, agent-quoted user text,
  tool output — is REMOVED, never labeled-and-kept. If structured host
  metadata (source.kind, injection markers) is unavailable, the text
  heuristics above are the fallback; if neither can establish
  user-authorship, the span is dropped (fail closed).
- Every drafting span is framed to the drafter as untrusted user data,
  never as instruction. User approval mitigates but does not remove the
  injection path — the allowlist is the control, approval the audit.
- Adversarial acceptance (implementation tests, expected outcomes):
  quoted correction ("my teammate said 'revert that'") → dropped (no
  first-person detector hit after quote-stripping: strip `>`-quoted and
  double-quoted attributed spans before matching); injected instruction
  in user-role → dropped (metadata or fence/quote heuristics); fenced
  output with a real correction alongside → correction span kept,
  output span dropped; repeated matches in one message → counted once,
  drafted once; agent meta-reasoning quoting the user → dropped (role
  is assistant).

### 3. Proposal (judgment, at era boundary)

- Era ownership: the pending set is keyed per project (project fingerprint
  move opens the drafting window for that project's flagged sessions).
  User-partition fingerprint moves do not open it (observations must not
  trigger on their own writes — feedback loop). Every window carries an
  era-id (`project + fingerprint-hash + sequence`); every receipt,
  proposal, and decision records the era-id of its drafting window (and,
  for decisions, the era-id of the decision moment) — §6 metrics join on
  these, so per-era attribution survives escalation and snoozing.
- No-era-move fallback: if 50 eligible sessions accumulate without a
  fingerprint move (DEFAULT, tunable), a time-boxed fallback window opens
  over the oldest 50. Proposals never wait indefinitely; the fallback is
  logged as such in the window record.
- Foreground drafting trigger: drafting runs at the first foreground
  interaction after a window opens (next session start in that project,
  inline before normal preamble load), bounded by the caps below. No
  background agents: the run happens inside a live user-attended request
  or not at all; a window with no foreground interaction stays pending.
- Claim lifecycle: atomic claim with lease (DEFAULT: lease expires at
  session end or 4h, whichever first); crash-after-claim recovers by
  lease expiry, and re-runs reuse the persisted result instead of
  re-drafting. Stable run-id = hash(project, era-id, detector
  version+thresholds, ordered cohort session list, sanitizer/drafter
  versions); results persist under the run-id, so re-runs are result
  reuse, not repeated LLM drafting (this replaces the v2 equality claim,
  which was wrong for nondeterministic drafting).
- Crash/concurrent-session semantics: crashed sessions reconciled at next
  session start; concurrent sessions in one project serialize on the
  pending store's atomic claim.
- Cost bounds (per-era replay is impossible — no historical era log — so
  cost is bounded by construction, not measurement): hard caps per
  proposal run (DEFAULT: max 10 sessions, max 5 candidates, max 30,000
  transcript tokens) with deterministic oldest-first deferral. Escalated
  sessions are marked consumed and skipped at the era run — EXCEPT
  snoozed candidates, which persist as standalone pending items carrying
  their own evidence pointers into the next era (consumption marks the
  session's evidence as drafted, never discards an undecided candidate).
- Output: candidate list, each with evidence pointers (session, turn) so
  the approver can verify against the incident. Candidates that restate
  an existing instruction are dropped, not proposed — but restatement
  screening is drafter best-effort (see §5), not guaranteed.

### 4. Approval (propose-never-auto) with bounded escalation

- One batched approval moment per era via the question tool: per candidate
  approve / edit / reject / snooze-to-next-era. Rejection reasons tracked
  separately from annoyance reports.
- Candidate identity: `(normalize(evidence text), scope)` with the §0
  normalization. Permanent reject keyed deterministically on the full
  pair — rejecting `user`-scoped text never suppresses the same text at
  `project` scope. Near-duplicate suppression is drafter-assisted and
  user-confirmed, never silent.
  Retention bounded: permanent rejects persist with a size cap (DEFAULT:
  200 entries, oldest-evicted, eviction noted); snoozes persist as
  standalone pending items into the next era per §3 (never silently
  dropped). The annoyance
  control is cooldown + caps + snooze — not an absolute never-re-propose.
- Escalation (DEFAULT: keep, bounded): a `RECALL_HIT` session proposes at the
  next foreground interaction, not mid-session (detection is session-end;
  there is no live interaction to interrupt). Exactly-once durable
  outbox; one escalation per session; cross-session cooldown (DEFAULT: at
  most 1 escalation per 10 eligible sessions per project); pending cap
  (DEFAULT: 5); explicit snooze/disable-escalation action. The 6-session
  historical count is frequency data, not a safety bound.
  Fresh-frustration approval quality is assumed — first escalations are
  watched (their acceptance rate is reported separately).

### 5. Storage, scope, and conflict (mechanisms, not policy)

- Every candidate declares `kind` (`observation` vs `explicit_instruction`)
  and `scope` (`user` vs `project`). Project-scoped or sensitive
  candidates are barred from the user partition — routed to the project
  brain proposal flow or dropped. Explicit instructions route to the
  explicit flow, never auto-convert.
- Promotion ≠ replacement: duplicated copies are retired only by a
  separately approved migration step. The spec claims dedup value, not
  automatic dedup.
- Secret/sensitive exclusion: no credentials, tokens, paths-to-secrets,
  or personal data beyond working preferences. Patterns deny-listed;
  drafter instructed; approval screen flags suspected sensitivity.
- Conflict mechanism: observations load from a dedicated user-partition
  surface (e.g. `observations.md`), rendered subordinate to all
  instruction layers — never merged into `operator.md` (separation is
  definitional). Best-effort conflict screening against every active
  layer at approval time, suspected conflicts shown beside the candidate.
  Observations revalidate (stale-flag) when relevant instruction
  fingerprints change. Recorded limit: LLM screening cannot guarantee
  conflict detection; approval + subordinate rendering are mitigations.

### 6. Metrics with denominators (acceptance thresholds)

- Per era-window, segmented by detector version AND threshold set
  (version alone is insufficient — the same v0.1 at different thresholds
  is a different trigger): acceptance rate (decided candidates only:
  approve and edit count as accepted, reject as not accepted; snooze is
  undecided — excluded from the rate, tracked separately), retired
  duplicate copies (the dedup metric — counts copies removed, not
  proposals accepted), repeated-correction trend (corr≥3 sessions per
  era, falling is the goal), proposals per eligible session
  (interruption rate; eligible = ≥3 user messages), explicit annoyance
  via a dedicated affordance (a "this annoyed me" action on the approval
  screen plus escalation-disable as an implicit signal — never inferred
  from rejections).
- Era attribution: proposals carry the drafting-window era-id, decisions
  the decision-era-id; escalation-attributed proposals carry both the
  triggering session and the drafting window. Metrics join on
  drafting-window era-id unless stated otherwise.
- Minimum-sample rule: no kill/keep decision below 20 proposals
  (DEFAULT; overturnable with recorded rationale). Rejections are quality
  control until proven otherwise — tracked by reason, never summed into
  annoyance.
- Precision pilot-gate (DEFAULT): if acceptance falls below 25% over the
  first 20 decided proposals, the trigger (not the feature) goes back to
  calibration — tighter patterns or higher thresholds, then re-replay.
  The §4 hand-label (≈15–20% session precision, ~3–5 durable finds per
  corpus-scale cohort) justifies drafting only under this gate.

### 7. Switch semantics

- Default OFF (house opt-in rule). OFF stops future collection and
  drafting. Retention on OFF: receipts kept (history), pending queue
  dropped (noted), rejections kept (user judgments), promoted
  observations kept (user-approved data, user-removable).
- All metrics are opt-in-population only and selection-biased — reported
  as such, never generalized to corpus-wide need.

### Deferred to implementation (enumerated, not hand-waved)

- Question-tool surfacing; per-project fingerprint hook plumbing;
  subagent memory interaction. (Cooldown/cap/numeric defaults, N, and
  quote-stripping are now spec'd as DEFAULTs above.)

## Open / probe questions

- RESOLVED by §3: the observation window is the per-project fingerprint
  era, with the §3 no-move fallback — observations do not get their own
  cadence, they ride the project's.

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
