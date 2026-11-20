# Follow-up Material

Performance and robustness work deliberately held out of the first
implementation to keep it minimal and behavior-focused. Each item below was
reviewed, judged correct-as-is, and deferred with its trade-off recorded.
Most have since shipped; the remaining open item is marked.

> Import note (2026-11-20): ported from the context-management design repo.
> Scope strings updated to `jwitmann`. Branch names below are the historical
> implementation branches in this repo's history.

### No helper integration for the new option blocks (deliberately skipped)

The `operator.contextManagement` and `operator.preambleRefresh` blocks
need no `@jwitmann/operator-helper` support: both validate their own
options (wrong-typed values fail loudly with an error toast, absent
blocks fall back to safe disabled defaults), and `memory check` already
covers the Brain health they depend on. Revisit only if a real
misconfiguration appears that the toasts do not catch.

### Batch the omission store — shipped

Each over-threshold request performs one full `planTrim` walk to
collect payloads, a `listOmissions` read, one `storeOmission` per
payload (each re-reading and re-parsing the whole `index.jsonl` plus a
linear scan), then a second full `planTrim` walk — O(K·N) file reads
for K payloads against N stored entries, all awaited sequentially.
Verified harmless at small scale (a 51KB omission stores instantly),
degrading steadily in very long sessions. Direction: a core batch
store call (one index read, map lookup, single append) and a
single-pass planner returning omission requests plus counts. Must
preserve exact ID reuse (re-trim byte-identity) and the
skip-malformed-line reader semantics; the `planTrim` signature change
churns its tests.

Shipped: `storeOmissions` batch call (one index read, map lookup, single
append; `storeOmission` reimplemented as single-item delegation) and
`planTrimBatched` (single collection walk, per-payload token counts ride
along; `build(ids)` maps IDs to replacements with no re-walk; `planTrim`
kept as a byte-identical wrapper). Adapter `trimRequest` is one walk plus
one batch store; receipt counts come from the walked tokens.

### Count each payload once — shipped

Payload text is stringified and BPE-encoded up to four times per
request (estimate, two planning passes, receipt accounting). Folds
into the single-pass planner above: report counts from the one walk
instead of re-encoding for the receipt.

Shipped: the batched walk encodes each payload once and the receipt sums
the walked token counts; no re-encoding for accounting.

### Surface receipt write failures — shipped

`appendReceipt` failures are silent, and the dedup state a receipt
carries is lost with it (fail-open refire next restart). Needs an
error channel threaded into the hook dependencies; surface, never
retry on the hot path.

Shipped: required `reportReceiptFailure` channel on the hook deps wired
to the error toast, `reportReceiptFailureOnce` helper with per-session
suppression and a staleness pre-check so a reload mid-write never burns
the live generation's notice; trim, compact, and refusal writes all
report.

### Bounded event-stream resubscribe — shipped

One stream throw kills completion triggering and estimator anchoring
for the process lifetime, silently. Resubscribe once, then log one
terminal line and stop.

Shipped: bounded single resubscribe with abort/staleness guards;
exhaustion surfaces through the toast-wired `reportReceiptFailure`
channel as `event-stream` (no `console` channel in runtime code —
review finding).

### Expire pending compaction causes — shipped

A requested-but-never-executed compaction leaves its cause in memory,
so a much later host-initiated compaction can be receipt-labeled with
a stale trigger instead of `manual`. Timestamp entries and expire
them after a generous window. Audit-label-only impact.

Shipped: causes stamped at request time, consumed with a ten-minute TTL,
older entries label `manual`; entry always consumed once.

### Bound the omission store — shipped

The per-session omission store under `~/.operator/state/omitted/` is
append-only with no pruning, so long-lived sessions grow without bound.
Direction: count/byte/age retention in core (`pruneOmissions` plus
`DEFAULT_RETENTION`: 200 payloads, 32 MiB, 30 days), the count cap
enforced automatically on every batch store, the full policy exposed
through an `operator-prune` tool for the current session. Notices keep
their content IDs after pruning; recovery of a pruned payload reports
absence gracefully.

Shipped: `pruneOmissions` (expired, over-count oldest-first, over-bytes
newest kept; dangling index entries healed on sized sweeps), adapter
auto-cap on the write path, `operator-prune` tool, `DEFAULT_RETENTION`
as the single source for both.

### Measure brain-reminder compliance — OPEN

Calibration proved the reminder fires at the right time (threshold 25
from the 200-session histogram and the staged 30-call runs) but never
measured whether a reminder produces a Brain edit — the log-only
instrumentation recorded no Brain writes by design. A sibling system
measured its equivalent rule ("read the skill before writing") at 39%
compliance, which suggests assuming our nudge lands is unsafe.
Direction: log-only reminder-issued receipts joined to the subsequent
brain-changed refresh per fingerprint era (moved vs unanswered, plus lag
in calls and time); no change to reminder text, threshold, or
once-per-era quiet. Decide mechanism changes (Helper `memory check`
surfacing, text, re-arm) only from the measured rate.
