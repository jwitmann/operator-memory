# DeepSeek Harness Adapter Implementation

Last Updated: November 16, 2026

How `@aerovato/operator-deepseek` binds the general adapter contract to DeepSeek Harness. Command meaning and setup workflows stay in [`commands.md`](../commands.md) and [`../reference/implementation.md`](../reference/implementation.md).

## Package

The published package is both a Cordis Host plugin and an installable DeepSeek bundle. Its `cordis.patch.yml` mounts the plugin under the stable `operator-memory` row. The build bundles `@aerovato/operator-core` and leaves DeepSeek runtime packages as compatible peers. All runtime peers carry `peerDependenciesMeta: optional: true`: profile installs run pnpm with `autoInstallPeers: false` and resolve the runtime from the dsh installation, not the profile's `node_modules`, so required peers would trip pnpm's "Issues with peer dependencies" warning on every install. dsh's own compatibility gate reads the `peerDependencies` ranges and ignores the meta, so version enforcement is unchanged.


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

## Context Management

Trigger evaluation is host-measured: `ctx.tokenMeter.measure(session).totalTokens` feeds Core's `evaluateTrigger`, and `contextPressure().contextWindow` supplies the model window. No token estimator is ported. A completed `turn/end` with a firing trigger stashes intent; enforcement happens on the next `agent/pre-step` through `ctx.compaction.compactIfNeeded(agent, "pressure")`, the same hook the host backend uses for its pressure path. The host policy stays authoritative. Both entry points resolve through a scoped `context.inject(["tokenMeter", "compaction"])` registration, so profiles without those services keep the preamble-only baseline instead of failing to activate. Compact and refusal receipts reuse Core's receipt shapes; the failure backoff consults the host-reported `compaction/end.error` before every dispatch.

## Compaction Shaping

DSH exposes no prompt-shaping hook on the compaction seam, so an `llm/stream` waterfall keyed on `options.purpose === "compaction"` appends Core's `buildCompactionPrompt` output as its own trailing user message after the host instruction, leaving that block byte-identical. Merging into the instruction was rejected after live A/B runs showed empty summaries on shaped histories while unshaped runs succeeded. The wrapper never answers the call and never throws into the summarizer.

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

- Scoped `context.inject` for `tokenMeter`/`compaction` instead of direct reads: direct access throws without inject and `reflect.get` cannot see cross-layer services from the plugin fiber (both proven live).
- Loop-timed enforcement on `agent/pre-step` instead of direct compact calls: `compactNow` outside an idle window throws `busy` (proven live); there is no anytime-admission API.
- `llm/stream` shaping wrapper instead of a shaping hook: no hook exists on the compaction seam; the summary instruction is a backend-hardcoded constant.
- Push-as-own-message delivery instead of in-place instruction extension: merging created competing output schemas and returned empty summaries in live A/B runs.
- Warn-and-skip on render failure instead of rejecting assembly: keeps the Agent working with a diagnostic while the cache entry is evicted for retry.

## Verification

Focused tests cover Client indicator registration, concurrent render coalescing, stable per-Agent content, independent Agents, canonical diagnostics, skipped sections with recovery on render failure, agentless assemblies, instruction-based commands, cancellation, independent Web/Desktop installation outcomes, config defaults and fail-loud validation, tool-call pairing, trigger gating, pre-step enforcement with TTL expiry and failure backoff, shaping delivery and fail-closed gates, and priced compaction receipts.

Live verification on a scratch headless profile with forced pressure (`thresholdRatio: 0.001`) confirmed: preamble injection with Brain content, successful shaped summaries, priced compact receipts from live `tokenMeter` readings, brain-update reminder firing at threshold, failure backoff through `compaction/end.error`, and no activation warnings.

The built bundle installs into clean Web and `sdk-minimal` profiles. Web starts with the Host plugin active without opening a browser; `sdk-minimal` starts and exits cleanly without an interactive command service.
