# OpenCode

OpenCode V2 is the default supported version. For legacy installations, see [OpenCode V1](opencode.md).

### Install

Requires Node.js 20 or newer (for Operator Helper) and the [Helper](../../README.md#installation) installed.

```sh
operator-helper install opencode
```

Restart OpenCode after installation. Until OpenCode reloads the plugin, commands and preamble injection will not work.

The default command no longer installs V1; use `install opencode-v1` for legacy installations. Installing V2 does not remove or migrate existing plugin registrations.

### Verify

In a new conversation, ask:

```
Is Operator Memory guidance available to you? Give a brief outline of what it says.
```

The agent should confirm the guidance is loaded and outline the brain, partitions, and memory-aware workflow. If it cannot, injection is not working.

Secondary signals: the home footer shows `Operator Ready (vX.Y.Z)` and the session sidebar shows partition states. `Operator Connecting` means the TUI is still verifying the server plugin; `Operator Unavailable` means the status query failed.

### Commands

- `/operator:user-init`
- `/operator:project-init`
- `/operator:index`
- `/operator:repair`

Run each in a new conversation. See [Getting Started](../getting-started.md#appendix-commands) for what each command does.

### Context Management

Context management is an opt-in feature that reduces what a session resends to the model. It stays off unless enabled, so vanilla Operator behavior is unchanged while disabled. It requires an initialized Brain: run `/operator:user-init` or `/operator:project-init` first. Without one the feature stays off and records one refusal receipt per session.

All keys live under `operator.contextManagement` in the plugin entry's `options`:

```jsonc
{
  "operator": {
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

`enabled` is the master switch. `ratio` trims past that fraction of the model's declared window, `hardCapTokens` trims past that absolute size and backstops an unknown window, `keepRecentTurns` excludes the most recent assistant turns from trimming, `compactOnComplete` compacts at the end of successful runs, and `compactFloorTokens` skips end-of-run compaction below that size.

Trim replaces bulky completed tool input and output with omission notices and stores the originals on disk under `~/.operator/state/omitted/<sessionID>/`, recoverable in the same session through the `operator:read_omitted` tool. Every trim and compaction appends one JSON line to `~/.operator/state/context-log/<sessionID>.log`. Pending, running, and errored tool calls, user messages, and the injected preamble are never trimmed. A satisfied trigger rests until context grows again, so continued sessions do not re-compact on every run.

Omitted payloads are retained per session up to 200 payloads, 32 MiB, and 30 days, with the count cap enforced automatically on every store; the `operator:prune` tool applies the same policy on demand. Receipts are never pruned. Both locations live under `~/.operator/state/`, operational state outside the Brain partitions that is safe to delete when a session is done with.

### Update

OpenCode V2 owns plugin updates:

```sh
opencode plugin check
opencode plugin update
```

Restart OpenCode after updating.

### Troubleshooting

- `Operator Connecting` persists: the server plugin is not active. Rerun `operator-helper install opencode` and restart OpenCode.
- `Operator Unavailable` or sidebar `Error`: run `/operator:repair` in a new conversation. See [Troubleshooting](../troubleshooting.md).
- Duplicate plugin failures after installing both the global package and a local dev build: OpenCode V2 cannot dedupe package identity. Remove one source with `opencode plugin remove`.
