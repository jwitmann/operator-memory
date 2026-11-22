# Design Decisions

Append-only log of context-management design decisions, imported from the
design repository at conversion time. Newest entries go last; never rewrite
an entry — supersede it with a dated note.

> Import note (2026-11-20): ported from the context-management design repo.
> Scope strings updated to `jwitmann`. Two deltas since the originals were
> written: (1) the operator tools were unified to hyphen form —
> `vcc-brain-read_omitted`, `vcc-brain-recall`, `vcc-brain-search` — so the
> `vcc-brain:read_omitted` colon form below is historical record, not current
> behavior; (2) the supplement-plugin fallback (last section) never
> triggered — the feature shipped in-tree.

### Deterministic triggers instead of model decisions

DCP exposes a compress tool and lets the model decide when to compress. That
burns tokens on decision-making, behaves unpredictably across models, and can
fire mid-task. The user's actual requirement is three plain rules: on task
completion, above a window ratio, above a hard cap. Rules need no model.

### Trim before compact, always

Trimming is lossless (content moves to disk with an ID) and keeps turn
structure intact. Compaction is lossy. The cheap, reversible operation runs
first; the expensive, irreversible one runs only when still over budget.

### Pairs, never parts

A tool call without its result (or vice versa) corrupts provider payloads.
DCP's session corruption bugs on V1 traces back to per-session ID bookkeeping
drifting from the transcript. Here, a call-result pair is the atomic unit:
omitted whole or left whole. No separate ID ledger exists.

### No deduplication strategy

DCP's dedup (same tool, same arguments, keep the last output) invalidates the
provider's prompt cache at the dedup point and requires exact-argument matching
across turns. On providers with prefix caching this can cost more than it
saves. Deferred until measurements justify it.

### The Brain replaces compression quality

Magic Compact and DCP fight to keep summaries faithful because the summary is
all that survives. In VCC Brain, durable knowledge already lives in Brain
documents. The compaction prompt therefore references partition paths rather
than embedding content, and the agent writes decisions down before compaction
runs. Summaries can afford to be terse.

### Omission receipts instead of statistics

DCP ships a TUI panel and token-savings stats. This design appends one line to
a log file per operation. The user asked for behavior, not observability
tooling. If stats become necessary, the log is the data source.

### V2-native hooks only

V1 hooks (`command.execute.before`, `experimental.chat.messages.transform`) are
the reason DCP and Magic Compact fail on V2: `sessionID` is not reliably
visible there. Everything here uses `ctx.session.hook("context")` and
`ctx.session.hook("compaction")`, where `event.sessionID` is part of the
documented V2 surface, plus `ctx.tool.transform` for the retrieval tool.

### The Brain is a hard prerequisite, not an integration

This design accepts terse, lossy summaries because durable knowledge already
lives in Brain documents: decisions are written down before compaction, and
the compaction prompt references partition paths instead of inlining content.
Making the Brain optional would reintroduce the summary-fidelity problem that
DCP and Magic Compact fought — the summary as the only surviving record. The
feature therefore refuses to enable without VCC Brain rather than
degrading to unprotected compaction.

### Operational state lives outside the Brain

The Brain's three partitions (`~/.vcc-brain/user/`, `.vcc-brain/`,
`.vcc-brain-shared/`) are curated knowledge, mapped by catalogs and read
deliberately. Omission stores and receipt logs are session-scoped machinery:
ever-appending, keyed by session ID, meaningless as durable knowledge. Placing
them inside a partition would pollute catalogs and invite agents to treat
them as knowledge. They therefore live under `~/.vcc-brain/state/`, a sibling
of the user partition, and never appear in any catalog.

### One file per omission, not one cache per session

Magic Compact stored all omissions for a session in a single JSON cache with
sequential content IDs (`omitted-001`, `omitted-002`, ...). That layout is
rejected here: a per-session JSON file is a read-modify-write bottleneck and a
single point of corruption, and its content IDs reset per session, making
receipt lines ambiguous across sessions. The store uses one file per omitted
payload (`<sessionID>/<contentID>`), so writes are append-only, recovery
reads one file, and a corrupt entry costs exactly one payload.

### The design answers the author's published constraints, verified from source

Upstream provides no implementation guide for the roadmap item — the entry is
one line ("Custom strategies for compaction, pruning, and context
management"). But the repository publishes constraints the design must
satisfy, and each is now verified against vcc-brain commit `e394f1c`:

- The README roadmap promises "an explicit on/off switch" for every feature.
  The `enabled` flag, off by default, is an upstream requirement, not a local
  invention.
- `docs/comparison.md` rejects compression as a memory substitute: "a
  historian model rewrites old conversation while under context pressure
  while persisting zero inspectable project truth," and "No summarizers, no
  black-box retrieval." The Brain-first contract is the answer: knowledge is
  documented before compaction, omission payloads and receipts sit on disk in
  plain text, and compaction prompts reference Brain paths. Compaction here
  removes bulk; it never becomes the record.
- The core philosophy prefers agent-driven flows, with harnesses injecting
  only context and thin UI. The pre-compaction Brain update is therefore an
  agent prompt, not harness logic.
- The OpenCode V2 index describes the preamble as immutable per session,
  injected through the model-boundary context hook. Trim must never touch
  injected system or preamble parts; it operates on history parts only.
- The core package is currently read-only ("Read-only memory module").
  Runtime omission and receipt writes in `packages/core/src/context/` are a
  new precedent to flag in the upstream proposal; the helper package owns
  setup-time filesystem work, not runtime state.

### Trim rewrites the request transiently; idempotency lives in the omission store

The V2 hook event is the outbound model request itself: `system`, `messages`,
and `options` are mutable, hook callbacks return void, and mutation is the
intended mechanism (verified in `@opencode/plugin` 2.0.14 type definitions,
against OpenCode v2.0.22). Trimming therefore rewrites each request as it
leaves; durable history on disk is never touched. That makes trim safe to
re-apply every request and keeps the store as the only record that must be
consistent.

A consequence: Magic Compact's `trimmed: true` part metadata relied on
durable server-side mutation and cannot serve as the idempotency marker
here. The omission store already records every trimmed part ID per session,
so that record is the marker; the structured notice text remains the
in-context signal for the model. The plugin KV storage domain
(`ctx.storage`) was considered for this state and rejected: receipts and
omitted payloads must be plain-text files a human can open, not opaque KV
entries.

### Hook mutations are transient — confirmed at runtime

The earlier decision to trim by transient request rewriting rested on the
`@opencode/plugin` 2.0.14 type definitions. Runtime probing on OpenCode
v2.0.22 closed the loop: markers written into message and part metadata
inside the `context` hook never reappeared across nine invocations of one
session. Durable history on disk is never rewritten by hook mutations, so
idempotency through the omission store and re-trimming from source on every
request are not just safe but required — there is no channel through which a
trim could persist accidentally.

### Token estimation is local over the outbound request, anchored on provider counts

The type-level plan read provider token counts from message infos. Runtime
probing on v2.0.22 invalidated it: `ctx.session.get` reports session-level
cumulative aggregates (input, output, reasoning, cache read/write, cost)
useful for calibration but useless as current context size, and
`ctx.session.context` returns inbox-style items with no token fields. The
estimator therefore runs `gpt-tokenizer` over `event.messages` inside the
`context` hook, where the full outbound request is already in hand. Accuracy
is anchored on the event stream: `session.step.ended` carries the step's
provider token counts (verified on v2.0.22: a request's true size was input
plus cache read plus cache write), so the estimator can adopt the last
step's provider total and locally count only what arrived since, instead of
re-tokenizing the whole history every request. Residual inaccuracy is
acceptable because trim is lossless and thresholds are policy, not hard
limits.

### Task-complete compaction is conditional on a todo signal

Superseded by "Task-complete compaction keys on the host's terminal-run
signal" below; kept for the record.

The target behavior includes compacting when the task is done, but vanilla
OpenCode v2.0.22 exposes no todo tool to the model: the probe registry lacks
it, the binary's migration notice tells V1-era sessions that `todowrite` "is
no longer available and must not be called", and upstream issue 42421 records
the maintainer's "This is intentional in V2. The TODO tools are not currently
planned." The todo machinery still exists in V2 core (`SessionTodo` service,
`TodoWriteTool` on dev) but is not in the direct tool catalog and has no
plugin-facing state API; `todowrite` seen in some setups is injected by outer
harnesses, not OpenCode. The trigger therefore observes whichever todo tool
the harness registers, through `tool.hook("execute.after")`, and is inert
when none exists. The alternative — dropping the trigger — is rejected: it
is part of the owner's target behavior and works today in harnesses that
provide a todo tool. The upstream proposal can cite issue 42421 and suggest
VCC Brain either registers its own todo tool (the ecosystem already does this,
e.g. third-party V2 todo plugins) or advocates re-exposing the built-in.
Upstream recommends no replacement: issue 42421 was closed as not planned
without an alternative, and the reporter's own workaround is a plain file the
agent maintains itself — which is also the VCC Brain-consistent answer, since
a plan document in the Brain doubles as a task list the agent already owns.

### Task-complete compaction keys on the host's terminal-run signal

The todo-based signal is rejected. Vanilla V2 removed the todo tool
deliberately (issue 42421), so a trigger built on todo state is dead in the
default configuration — speculative compatibility behavior, which upstream's
own style rules forbid. The host publishes the honest version of the same
signal, verified at runtime on v2.0.22: `ctx.event.subscribe` streams
`session.execution.succeeded`, `session.execution.failed`, and
`session.execution.interrupted` as distinct durable events at a run's
terminal transition. (`session.idle` exists in the schema but never fired in
headless runs; the execution events are the reliable surface.) Compacting on
`succeeded` alone leaves failed and interrupted runs untouched, so full
context survives for diagnosis. Compaction requested from the event handler
executes immediately as its own run after the terminal transition — the next
task starts with compacted history. This is deterministic, first-party, and
host-observed rather than model-self-reported. The size floor
(`compactFloorTokens`) and dedup are load-bearing: the probe watched a naive
handler schedule a fresh compaction after every successful run, including
the run that had just compacted.

### The retrieval tool uses the native namespace, not a name prefix

Magic Compact's `read_omitted_content` became `operator_read_omitted` in
early drafts of this spec — a prefix embedded in the tool name. That form is
rejected. V2 provides a first-party namespace mechanism
(`ToolEditor.namespace` registers a `Tool.Namespace` of name plus
description; tool options and tool-call parts carry `namespace` separately
from `name`), and VCC Brain's own convention is colon-namespaced:
`vcc-brain:user-init`, `vcc-brain:project-init`, `vcc-brain:index`,
`vcc-brain:repair`, plugin ID `jwitmann.vcc-brain`. The tool is
therefore `read_omitted` under the `operator` namespace, presented as
`vcc-brain:read_omitted` — consistent with the command surface and with no
prefix logic to maintain.

Import note: the colon form above is the decision as originally recorded.
The tools were later unified to hyphen form (`vcc-brain-read_omitted`,
`vcc-brain-recall`, `vcc-brain-search`) because the colon form never reached
the model surface on OpenCode; see the repo history. Current behavior uses
the hyphen names.

### Double compaction is coordinated, not prevented — and Magic Compact never had the problem

Magic Compact contains no auto-compaction handling anywhere in its source,
because its compaction is durable: it forks the session, summarizes, and
rewrites history server-side, so the host's context accounting sees the
shrunken history and native auto-compaction cannot fire until the window
refills. OpenCode V2's hook mutations are transient (probe-verified), so this
design's trim shrinks only the outgoing request while durable history stays
full-size — the coordination problem is an artifact of V2's hook semantics,
not a design oversight.

Coordination therefore relies on three independent exits: the host
`compaction` config block (`auto`, `keep.tokens`, `buffer`) can disable or
retune native compaction; thresholds are aligned so the plugin acts first;
and the `compaction` hook short-circuits a host-initiated compaction by
setting `result` when context sits below the plugin's own thresholds —
issue 27366's skip flag without upstream changes. The first two exits are
verified (config schema, threshold arithmetic); the third rests on the
official plugin documentation ("the hook receives the transcript being
summarized"), with runtime confirmation deferred as non-blocking: even if
the hook does not fire for host-initiated compactions, the worst case is a
wasted summarization pass and a receipt-visible summary-of-a-summary, never
data loss. [Superseded: the short-circuit exit is rejected in the final
section below — live verification showed setting `result` replaces history
with the note instead of skipping compaction.]

### Compaction scheduling should respect prompt-cache economics (inference)

The roadmap item "Cache-Aware Preamble Rendering — automatically refresh
preamble when cache expires" reveals the author's cost model: the preamble is
immutable per session because any change to the request prefix invalidates
the provider's prompt cache for the whole session; refreshing is only cheap
once the cache has gone cold. The same economics apply to context management,
by inference (not yet upstream-verified behavior):

- Trim is cache-friendly only because it is idempotent: omission-store
  markers keep the trimmed request shape stable across requests, so the cache
  re-warms once and stays warm.
- Compaction is a full cache flush; it is cheapest when scheduled while the
  cache is already cold. The `session.step.ended` event's cache read/write
  counts (probe-verified) provide the signal: near-zero cache reads mean the
  prefix is cold.
- If core grows a cache-expiry tracker for preamble rendering, compaction
  scheduling should reuse it rather than maintaining a second tracker.

### Result short-circuit and tail exclusion rejected after live verification

The third exit above — short-circuiting host-initiated compactions by
setting `result`, and the related `keepTailTokens` tail exclusion — is
rejected. Live verification on OpenCode v2.0.22 (implementation runs
ses-impl-12 through ses-impl-41, dev plugin `jwitmann.vcc-brain-dev`)
showed the host replaces request-view history with exactly the summary
produced: the next request after a compaction carries a single user-role
message. Setting `result` therefore substitutes a content-free note for the
history (observed: the model could no longer recall pre-compaction facts,
while the note claimed the full history was kept), and excluding a tail
from the compaction request hides it from the summarizer and drops it from
view (observed: the sliced tail message never reappeared; the host keeps no
tail alongside the summary). The `recent` field on the stored compaction
row is post-compaction drift, not preservation. The `compaction` hook now
shapes the system prompt only and leaves messages intact; `keepTailTokens`
is removed from the configuration and `kept` from the compact receipt.
Compact receipts name their cause instead: the firing trigger, or `manual`
for host-initiated compactions. Two adjacent findings from the same runs:
dedup state hydrates from the session receipt log because sessions outlive
processes (a continued session in a new process otherwise refires
satisfied triggers), and post-run compactions race standalone server
teardown under `opencode run` (mid-run compactions complete reliably).

### Supplement plugin keeps the Brain dependency

If the feature branch does not land, the fallback is a companion plugin
installed alongside VCC Brain, not a standalone compactor. The
companion imports the same `packages/core/src/context/` logic through the
existing explicit subpaths, performs its own per-session Brain check and
fails closed, and owns the `context` hook, the `compaction` hook, the
terminal-run subscription, the `read_omitted` tool, and the receipt log. The
in-tree feature stays disabled wherever the companion runs, so exactly one
writer exists. A Brain-less variant is rejected for the reason above: lossy
summaries with nowhere to save durable knowledge first reintroduce the
fidelity problem the Brain prerequisite exists to prevent. Recorded as a
distribution fallback; behavior stays in the spec.

Import note: the fallback never triggered — the feature shipped in-tree.
Kept for the record.
