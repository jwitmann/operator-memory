# OpenCode V2 Adapter Implementation

Last Updated: November 24, 2026

How `@jwitmann/vcc-brain-opencode-v2` binds the general adapter contract as the default OpenCode integration. V2 is an incompatible plugin platform and therefore remains a separate package; the unversioned npm package and source directory still belong to legacy V1. Behavioral deviations are recorded against [`../reference/implementation.md`](../reference/implementation.md), not other bindings.

## Package

Install with:

```text
vcc-brain-helper install opencode
```

The package exports server, RPC contract, and TUI entrypoints.

`install opencode-v2` is an undocumented compatibility alias: accepted for existing callers but omitted from help and user-facing installation examples. The default installer does not remove or migrate existing registrations. All workspace OpenCode development and release commands target this adapter.

The TUI bundle must compile JSX with OpenTUI's Solid build transform and keep `solid-js`, `@opentui/solid`, and `@opentui/core` external so slot components share the terminal host's Solid owner and OpenTUI renderer. Ordinary JSX compilation evaluates dynamic status text only at mount; bundling a second renderer crashes slot rendering with `No renderer found`.

## Preamble Injection

- Load and render through core once per OpenCode `sessionID`, cache the complete normal or diagnostic result, and inject that same result into every model call for the session.
- Use V2's outgoing model-boundary `session.hook("context")`; context changes remain outside persisted history and reapply after compaction.
- Renderable partition failures inject the diagnostic preamble and show one recovery toast per session. Unexpected rendering failures show an error toast and abort the model call with the underlying cause.

## Commands

Register `vcc-brain:user-init`, `vcc-brain:project-init`, and `vcc-brain:index`. Each command admits instructions for the agent to check the Helper version, upgrade when outdated, run the corresponding workflow operation, and handle failures in the current conversation.

## TUI Status

- Show `VCC Brain Connecting... (detail)` while the TUI verifies the active server plugin, `VCC Brain Ready (detail)` after a successful status query, and `VCC Brain Unavailable (detail)` after failure. Place this compact indicator in the built-in home footer status row; keep partition details in the session sidebar.
- Use `Local Build` for local packages and `vX.Y.Z` for installed packages.
- Show User, Private, and Shared as Checking, Loaded, Uninitialized, or Error in the session sidebar, with guidance to ask the agent to diagnose VCC Brain loading when needed.
- Cache status per V2 location. Query the resolved location when the initial home screen receives it, and refresh after a top-level session transitions from active to idle. Ignore subagent idle transitions.
- Retry status after server reconnection. The server is authoritative because project memory may be remote from the TUI process.

## RPC And Notifications

The server registers one typed plugin RPC contract. Its `status` method loads the location-scoped memory status through core and returns the display detail plus partition states. Its `toast` event carries recovery and fatal preamble notifications to each connected TUI. The TUI validates event data before showing a 10-second native toast.

## Native Update

OpenCode 2 owns plugin update checks and installation through `opencode plugin check` and `opencode plugin update`. VCC Brain does not mutate OpenCode's package cache or auto-update its own plugin. Helper's `install opencode` remains the installation path.

## Context Management

Opt-in request-view reduction for long sessions. Disabled by default; vanilla preamble and command behavior is unchanged while disabled. Requires an initialized Brain: without one the feature stays off and records one refusal receipt per session.

All keys live under `vcc-brain.contextManagement` in the plugin entry's `options`. Absent means the defaults (disabled); a present block with a wrong-typed value fails loudly with an error toast, never a silent fallback. The legacy `operator` key is still accepted when `vcc-brain` is absent:

```jsonc
{
  "vcc-brain": {
    "contextManagement": {
      "enabled": false,
      "ratio": 0.8,
      "hardCapTokens": 250000,
      "keepRecentTurns": 3,
      "compactOnComplete": true,
      "compactFloorTokens": 32000
    }
  }
}
```

`ratio` trims past that fraction of the model's declared window, `hardCapTokens` trims past that absolute size and backstops an unknown window, `keepRecentTurns` excludes the most recent assistant turns from trimming, `compactOnComplete` compacts at the end of successful runs, and `compactFloorTokens` skips end-of-run compaction below that size.

Trim replaces bulky completed tool input and output with omission notices and stores the originals on disk, recoverable in the same session through the `vcc-brain-read_omitted` tool. Pending, running, and errored tool calls, user messages, and the injected preamble are never trimmed. Every trim and compaction appends one JSON line to `~/.vcc-brain/state/context-log/<sessionID>.log`; failures and refusals are recorded in the same file, never silent.

Compaction is deterministic first, model-shaped fallback second. The hook compiles the request with the VCC region compiler and, when the framed checkpoint is smaller than the request and a keepID tail pointer exists at or after the keep cut, persists the checkpoint verbatim through the hook result with no model call: only original text moves, and every elision carries a `(seq N)` pointer back to its source event. When no keepID exists or the checkpoint would not shrink the request, the hook abstains and shapes the host's own summary instead. Compact receipts record which engine ran (`vcc` or `shaped`), with the checkpoint token size for the former.

Every context-hook turn refreshes a per-session snapshot of the cleaned raw request messages at `~/.vcc-brain/state/context-snapshot/<sessionID>.json`; the compaction hook refreshes it too, so a failed per-turn write heals at compaction time. The snapshot is the lossless counterpart of the checkpoint: the agent tools `vcc-brain-recall` (by `seq` range, tool-result pointer, or checkpoint ordinal) and `vcc-brain-search` (by keyword or regex, returning `(seq N)` pointers) restore exactly what the checkpoint elided. Writes are growth-guarded by snapshot version, message count, and tail ID, and best-effort — a failed write is never fatal, the tools simply report recall as unavailable. Seqs are 1-based ordinals over kept messages on both sides, so checkpoint pointers address the same events the tools read. Live-verified on host v2.3.2: override checkpoints with agreeing pointers, per-turn snapshot growth, and byte-for-byte recall after compaction.

Omitted payloads are retained per session up to 200 payloads, 32 MiB, and 30 days, with the count cap enforced automatically on every store; the `vcc-brain-prune` tool applies the same policy on demand. Receipts are never pruned. Both locations live under `~/.vcc-brain/state/`, operational state outside the Brain partitions that is safe to delete when a session is done with.

A host-reported failed compaction (`session.compaction.failed`) arms a per-session backoff: new requests are suppressed for ten minutes, then only real growth past the failure-point estimate re-arms. A compaction attempt running (or `session.compaction.ended`) clears the backoff. Requests are also single-flight: a second admission while one request is outstanding with an unknown outcome is skipped. The shared runtime lives on `globalThis` so a host bundle re-import on config change keeps dedup and backoff state instead of refiring. None of this stops a host-side retry loop already in progress — that needs the server stopped and the stuck inbox row deleted — it only stops our plugin from feeding it.

## Preamble Refresh

Opt-in mid-session preamble re-render when the Brain changes on disk. Disabled by default and independent from context management: preamble rendering is Brain behavior, not context reduction. Its own switch lives under `vcc-brain.preambleRefresh`:

```jsonc
{
  "vcc-brain": {
    "preambleRefresh": {
      "enabled": true
    }
  }
}
```

A fingerprint move (per-partition instructions, catalogs, and index files) re-renders from current disk state only when the provider's prompt cache is cold — rewriting the request prefix invalidates the cache, so a hot-cache refresh burns tokens for nothing. A moved fingerprint with a hot cache waits for the next cold request. The first request after a compaction refreshes unconditionally: compaction already flushed the cache. Trim never touches injected system parts, and a refresh never triggers trim or compaction evaluation by itself. Every refresh appends one JSON line to the session context log; re-render failures keep the old preamble and surface through the existing error channel.

## Brain Updates

Opt-in nudge to record durable knowledge, never an automatic Brain writer. Disabled by default with its own switch under `vcc-brain.brainUpdates`:

```jsonc
{
  "vcc-brain": {
    "brainUpdates": {
      "enabled": true,
      "toolCallThreshold": 25
    }
  }
}
```

The adapter counts distinct completed tool calls since the last Brain fingerprint move — error results count, pending or unpaired calls and VCC Brain's own helper calls do not — and appends one static reminder on the first request crossing `toolCallThreshold` (a positive integer, 25 by default). The reminder names no content and requires no edit: when nothing durable emerged, the agent makes none. A Brain change resets the baseline without reminding, and later crossings stay quiet until the Brain moves again. The feature stays inert when disabled, Brainless, stale, or when the fingerprint cannot be read.

## Cross-Session Recall

The adapter registers `vcc-brain-search-sessions` (keyword search over OTHER sessions, scoped to the setup-time project directory plus mutual peers) and `vcc-brain-recall-session` (restore one indexed session's turns by stored id like `dsh:<uuid>` or `opencode:ses_...`, optional single turn by seq). Same-conversation lookup stays on the context-management `vcc-brain-recall` / `vcc-brain-search` snapshot tools; the cross-session pair never reads the live session.

Both tools are thin: all sqlite FTS5 work lives in the helper (`recall-cross index|query|recall|forget` under `~/.vcc-brain/state/recall-index/`, 0700 dir / 0600 file, 30-day retention plus explicit `forget`). Each tool shells `vcc-brain-helper` with a 60s cooperative timeout, validates keywords, harness, sessionId, and seq without spawning, and degrades to plain text when the helper is missing. OpenCode results require one `vcc-brain-helper recall-cross index` run on the machine first; a cold index with an explicit OpenCode scope reports that instead of guessing.

## Per-Project Override

A session project may override the `opencode.json` config with an optional `<project>/.vcc-brain/config.json`, using the same block and key names without the `vcc-brain` wrapper. Present fields merge over the parsed `opencode.json` values; absent file or blocks inherit them. Precedence, lowest first: defaults, global `opencode.json`, project `opencode.json`, `.vcc-brain/config.json`. Unparsable content or a non-object root warns with an error toast and keeps everything; an invalid block warns and keeps that block while valid siblings still merge; absent or unreadable files fall back silently. Resolution is setup-time (one setup per project directory), unlike the DSH adapter's per-session resolution — DSH hosts many sessions with different cwds in one process, opencode does not.

The same file declares cross-session recall peers: a top-level `peers` list of project directory paths (e.g. `"peers": ["/home/jerome/checkouts/other"]`). The recall tools pass the setup-time project directory to the helper, which counts a peer only when that peer's own config lists this project back (both sides canonicalized) — mutual or nothing, resolved per query with no cache. Absent files, bad JSON, and non-array `peers` fall back silently to no peers (fail-closed: fewer peers only narrows scope). Explicit CLI `--peer` flags union in as-is; the tools never pass them.

## Differences From Reference

Pathway selections: bundled-core resolution, transform injection as an appended system text part, slash commands, status UI, and harness-native updates. All are accepted reference pathways. Tool-time Helper subprocess for cross-session recall extends the accepted Helper-subprocess pathway from preamble rendering to recall tools: the adapter bundle cannot carry `node:sqlite`, so the recall tools shell `vcc-brain-helper recall-cross ...` as their own implementation. The command-handoff rule still holds: `/vcc-brain:*` commands only instruct the agent, never execute Helper for it. The appended system part versus a prepended synthetic user message is a documented placement choice within the transform pathway.

## Harness Notes

1. Command handoff: V2's plugin command definition has only `execute`, so the adapter admits the instruction prompt through `session.prompt` without running Helper itself.
2. Client/server ownership: V2 may run remotely, so the server reads memory and exposes status plus toast events through typed RPC while the TUI renders client-local UI. RPC events are ephemeral when no TUI is connected.
3. Readiness lifecycle: the package TUI loads only after the server plugin is active. `Connecting` means the TUI is verifying RPC connectivity; a server setup failure prevents this package TUI from loading.
4. Local development: V2 has no package-identity dedupe and no per-source disabling — `-<plugin-id>` disables every source with that ID, and re-adding the same ID re-enables both sources, failing the second as a duplicate. `bun run install:opencode` builds and links Helper, builds the distinct dev ID (`VCC_BRAIN_PLUGIN_ID=jwitmann.vcc-brain-dev`, via `build:opencode-v2:dev`), and registers its absolute `dist` directory in global server config after disabling the canonical ID. Existing settings, JSONC comments, and package registrations are preserved; repeated installation is idempotent. `OPENCODE_CONFIG_DIR` overrides the XDG/default config directory. There is no separate preview script. The published build retains the canonical ID, and the supervisor reports duplicate active IDs as plugin failures without dropping the whole generation.
5. V2 uses `Plugin.define({ id, setup })`, receives `sessionID` directly on the context event, and uses the `home.footer` and `sidebar.content` slots. Stable V2 uses `@opencode/plugin` and requires the corresponding plugin API at runtime.
6. Command registration snapshots registered commands before adding its transform and skips matching names. Later definitions replace earlier ones, so user configuration remains authoritative.

## Verification Gaps

- Integration-test actual V2 loading, slash-command conversation behavior, tool continuation and compaction injection, subagent injection, reconnect status, and installation against a runnable stable harness.
- Add focused integration tests for actual Helper-unavailable commands and unexpected preamble rendering.
