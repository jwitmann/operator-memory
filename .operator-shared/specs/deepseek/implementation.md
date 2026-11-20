# DeepSeek Harness Adapter Implementation

Last Updated: November 20, 2026

How `@aerovato/operator-deepseek` binds the general adapter contract to DeepSeek Harness. Command meaning and setup workflows stay in [`commands.md`](../commands.md) and [`../reference/implementation.md`](../reference/implementation.md).

## Package

The published package is both a Cordis Host plugin and an installable DeepSeek bundle. Its `cordis.patch.yml` mounts the plugin under the stable `operator-memory` row plus the agent-scoped `tool-recall` row (`@aerovato/operator-deepseek/tool`). The build bundles `@aerovato/operator-core` and leaves DeepSeek runtime packages as compatible peers. All runtime peers carry `peerDependenciesMeta: optional: true`: profile installs run pnpm with `autoInstallPeers: false` and resolve the runtime from the dsh installation, not the profile's `node_modules`, so required peers would trip pnpm's "Issues with peer dependencies" warning on every install. dsh's own compatibility gate reads the `peerDependencies` ranges and ignores the meta, so version enforcement is unchanged.

## Preamble Injection

The adapter registers one asynchronous `system-prompt/assemble` waterfall listener. The first assembly for a live Agent renders the complete Core preamble from that Agent's Session `cwd`, falling back to the Host working directory when the Session has no explicit `cwd`. A `WeakMap` caches the render promise by live Agent, coalescing concurrent first assemblies and retaining byte-stable content for later steps, retries, and tool-driven turns.

Every assembly prepends the cached content as a literal `operator:memory` system-prompt section with interpolation disabled. DeepSeek persists assembled system prompts into Session history; this is the accepted persisted-context pathway. Fresh, resumed, compacted, forked, and in-process spawned Agents all pass through the same assembly listener and receive their own render. Out-of-process delegated harnesses do not inherit the Host plugin.

A rendered partition failure is successful canonical Core output and is injected unchanged. An unexpected resolution failure evicts the cached render, logs a diagnostic warning, and skips the section for that assembly without rejecting into the host; later assemblies for the same Agent re-render. Agentless diagnostic assemblies delegate without rendering.

## Configuration

The plugin takes an optional second `apply` argument validated with defaults. Every feature defaults OFF; absent config behaves exactly like the preamble-only adapter:

- `contextManagement`: `enabled`, `ratio`, `hardCapTokens`, `keepRecentTurns`, `compactOnComplete`, `compactFloorTokens`. Knobs match the opencode adapters' semantics; `keepRecentTurns` is parsed for compatibility but reserved (no trim path exists yet in this adapter).
- `brainUpdates`: `enabled`, `toolCallThreshold` (positive integer).
- `preambleRefresh`: `enabled`.

Wrong-typed or out-of-range values (`ratio` outside `(0, 1]`, negative token counts) fail loudly at startup with a warning; the plugin falls back to all-disabled defaults.

### Per-project override

A session project may override the profile config with an optional `<project>/.operator/config.json`, using the same block and key names. Present fields merge over the profile values, so a project can flip one knob and inherit the rest; absent file or absent blocks mean the profile config. Unparsable content or invalid blocks warn once per file content and fall back (whole file for bad JSON, per block for validation failures); unreadable files fall back silently. Resolution is mtime-cached per project directory (one stat on the prompt path, re-parse only on moves). The synchronous `llm/stream` shaping hook cannot do IO, so it reads the cache warmed by the async sites and falls back to the profile value for unknown sessions — exactly the pre-override behavior.

## Context Management

Trigger evaluation is host-measured: `ctx.tokenMeter.measure(session).totalTokens` feeds Core's `evaluateTrigger`, and `contextPressure().contextWindow` supplies the model window. No token estimator is ported. A completed `turn/end` evaluates both candidate sets sharing one dedup store — `request` (ratio, hard-cap) first, then `task-complete` (floor-gated) — with pressure causes winning ties; DSH exposes no per-request seam, and turn-end totals only grow within a turn, so nothing a per-request check would catch is missed. A firing trigger stashes intent; enforcement happens on the next `agent/pre-step` through the compaction service's `compactIfNeeded(agent, "pressure")`, the same hook the host backend uses for its pressure path, so a stash from a final turn lands at the next run's first step (or expires after ten minutes). When no compaction service is reachable from any plugin-visible scope, the fallback drives the user-facing `/compact` command through the host's own `commands.execute` dispatch — but only from an `agent/status idle` listener, because the backend refuses mid-loop agents; a pre-step caller never takes the fallback. The host policy stays authoritative. The meter resolves per session (agent-scope cache with live read, root capture fallback) and the compaction service per attempt (cache, live read, command-scope capture), so profiles without those services keep the preamble-only baseline instead of failing to activate. An early miss never pins: the stash survives for the next evaluation or step. The pending cause is recorded before the attempt — the receipt is written when `compaction/end` lands, which can precede the attempt's own resolution — with every non-success path deleting the entry and receipt reads expiring stale ones, so a never-executed intent cannot mislabel a later host-initiated compaction. Compact and refusal receipts reuse Core's receipt shapes; the failure backoff consults the host-reported `compaction/end.error` before every dispatch. There is no trim port: agent-loop `llm/stream` requests arrive deep-frozen by host contract ("listeners read it, never rewrite it"), and the session log is append-only for plugins, so request-view reduction has no legal seam — the host's tool-result pruner owns that layer, `keepRecentTurns` stays parsed-but-reserved, and no omission store or `read_omitted`/`prune` tools are registered. Recovery instead reads the durable log directly: the agent-scoped `tool-recall` row registers `operator:recall` (typed seq/result/checkpoint restore) and `operator:search` (keyword/regex with `(seq N)` pointers) through `defineTool` against the calling agent's Session, reusing Core's recall/search with default budgets. No snapshot file exists on this adapter — the log the compaction backend compacts is already append-only and host-readable, so checkpoint pointers address it natively. Invalid input returns a schema-valid text reply; the framework validates argument shapes. Compact receipts attribute the engine from the `compaction/summary` provenance stashed per session (`dsh-compaction-vcc` reports `vcc`, any other provider `shaped`, none observed `unknown`).

## Compaction Shaping

DSH exposes no prompt-shaping hook on the compaction seam, so an `llm/stream` waterfall keyed on `options.purpose === "compaction"` appends Core's `buildCompactionPrompt` output as its own trailing user message after the host instruction, leaving that block byte-identical. Merging into the instruction was rejected after live A/B runs showed empty summaries on shaped histories while unshaped runs succeeded. The wrapper never answers the call and never throws into the summarizer. Verbatim deterministic compaction on this harness is a host backend choice, not adapter code: `dsh-compaction-vcc` installs as a contract-exact drop-in for `dsh-compaction-basic` at the profile layer, and the adapter stays backend-agnostic — requesting through `compactIfNeeded`, shaping whatever summarizer runs, and attributing whichever backend compiled.

## Brain Updates And Preamble Refresh

Completed tool work counts from the durable `tool/call` + `tool/result` join (paired by callId, Operator tools excluded), feeding Core's `evaluateBrainUpdateActivity` for a once-per-fingerprint-era reminder appended in the assemble hook. Preamble refresh re-renders on Brain fingerprint moves under the host-measured cold-cache and estimate-floor gates, bypassed post-compaction; refresh receipts use Core's shapes. Both gate on per-session Brain availability tracked from preamble loads and fail closed.

## Commands

When the active composition supplies DeepSeek's optional `commands` service, the adapter registers:

- `/operator-user-init`
- `/operator-project-init`
- `/operator-index`

The hyphenated names are the DeepSeek-compatible equivalents of the preferred colon names. Each handler sends one identified follow-up message instructing the Agent to check Helper's version, upgrade when outdated, run the workflow operation, and handle failures directly. Cancellation prevents handoff.

Profiles without the command service still receive preamble injection.

## Web UI

Web and Desktop show `Operator Ready (vX.Y.Z)` as the first pill in the composer dock, to the left of the Harness's other readings, when the Client plugin is installed and active. The text-only, non-selectable pill has no border and uses the adjacent pills' hover background and text-color treatment. It indicates adapter availability, not successful memory loading for the current Session. Profiles without a Web Client have no indicator.

## Installation And Updates

`operator-helper install deepseek` invokes DeepSeek's native package command independently for `web` and `desktop`. A successful profile remains installed if the other fails, and Helper reports both results plus the manual named-profile command.

Desktop exclusively owns its profile and package state. Its installation requires Desktop's own installed `dsh` runtime after the application has initialized the profile and fully quit; the independent npm CLI cannot manage it. Desktop's Plugins page is an equivalent installation surface.

Named profiles use:

```text
dsh plugin --profile <profile-name> add @aerovato/operator-deepseek
```

DeepSeek's native profile package operation owns updates. Profile processes must restart after bundle installation or replacement.

## Differences From Reference

Pathway selections: bundled-Core resolution, persisted system-prompt contribution, DeepSeek-compatible hyphenated slash commands, availability-only Web indicator, and native profile package management. All are accepted reference pathways.

Port deviations, each with the host-imposed reason:

- Per-agent service resolution with unconditional root registration instead of a joint scoped inject: the joint `context.inject(["tokenMeter", "compaction"])` callback never fires in the TUI composition (proven live), so the loop never ran there; direct access throws without inject and `reflect.get` cannot see cross-layer services from the plugin fiber (both proven live). The meter resolves per session and the compaction service per attempt, each miss degrading to the next layer with the stash intact.
- Loop-timed enforcement on `agent/pre-step` instead of direct compact calls: `compactNow` outside an idle window throws `busy` (proven live); there is no anytime-admission API. The `/compact` command-dispatch fallback is additionally gated to `agent/status idle` for the same reason: the backend refuses mid-loop agents (proven live: a pre-step dispatch settled `busy`).
- `llm/stream` shaping wrapper instead of a shaping hook: no hook exists on the compaction seam; the summary instruction is a backend-hardcoded constant.
- Push-as-own-message delivery instead of in-place instruction extension: merging created competing output schemas and returned empty summaries in live A/B runs.
- Warn-and-skip on render failure instead of rejecting assembly: keeps the Agent working with a diagnostic while the cache entry is evicted for retry.
- Dual trigger evaluation at `turn/end` instead of opencode's per-request hook plus completion signal: DSH exposes no per-request seam to plugins; turn-end totals only grow within a turn so detection loses nothing, and enforcement is pre-step either way.
- No trim port: agent-loop requests arrive deep-frozen at the `llm/stream` waterfall by documented host contract (mutation throws; content must stay a pure function of the session log for replay), and the session log is append-only for plugins. Reduction belongs to the host's pruner services; `keepRecentTurns` is parsed-but-reserved and no omission store or recovery tools are registered.

## Verification

Focused tests cover Client indicator registration, concurrent render coalescing, stable per-Agent content, independent Agents, canonical diagnostics, skipped sections with recovery on render failure, agentless assemblies, instruction-based commands, cancellation, independent Web/Desktop installation outcomes, config defaults and fail-loud validation, tool-call pairing, trigger gating, pre-step enforcement with TTL expiry and failure backoff, service-miss and command-fallback enforcement (including pre-attempt cause recording and idle-only dispatch), shaping delivery and fail-closed gates, and priced compaction receipts.

Live verification on a scratch headless profile with forced pressure (`thresholdRatio: 0.001`) confirmed: preamble injection with Brain content, successful shaped summaries, priced compact receipts from live `tokenMeter` readings, brain-update reminder firing at threshold, failure backoff through `compaction/end.error`, and no activation warnings. A second live round in the `dsh-tui` profile (per-agent resolution build, floor-zero config) confirmed the full automatic loop on a real session: a completed turn stashed intent, the idle listener dispatched `/compact` through the host handler 28ms after `turn/end`, and the session log shows `compaction/start`, `compaction/end`, and a success result compacting 37 history items.

The built bundle installs into clean Web and `sdk-minimal` profiles. Web starts with the Host plugin active without opening a browser; `sdk-minimal` starts and exits cleanly without an interactive command service.
