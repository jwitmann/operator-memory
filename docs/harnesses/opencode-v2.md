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

```text
Is Operator Memory guidance available to you? Give a brief outline of what it says.
```

The agent should confirm the guidance is loaded and outline the brain, partitions, and memory-aware workflow. If it cannot, injection is not working.

Secondary signals: the home footer shows `Operator Ready (vX.Y.Z)` and the session sidebar shows partition states. `Operator Connecting` means the TUI is still verifying the server plugin; `Operator Unavailable` means the status query failed.

### Commands

- `/operator:user-init`
- `/operator:project-init`
- `/operator:index`

Run each in a new conversation. See [Getting Started](../getting-started.md#appendix-commands) for what each command does.

Once the basics are running, see [Context Management](#context-management): deterministic trim and compaction that reduce what a session resends to the model. Off by default — enable it during project setup.

### Context Management

When enabled, Operator Memory reduces what a session resends to the model. Three deterministic rules, evaluated with token arithmetic and host-reported run outcomes — never model judgment. Compaction runs through the deterministic VCC engine, ported in-tree from the [VCC reference engine](https://github.com/jwitmann/opencode-vcc-compaction):

1. A run ends successfully and context clears `compactFloorTokens`: compact once.
2. Estimated context passes `ratio` of the model window: trim bulky tool I/O, then compact if still over.
3. Estimated context passes `hardCapTokens`: same as above, absolute.

Trimming replaces completed tool inputs and outputs with short notices and stores the originals on disk; compaction summarizes history through the host's normal compaction, shaped to reference your Brain instead of inlining it. The host's own native compaction keeps working unchanged — this feature acts earlier and audits everything it does.

#### Prerequisites

The Brain must exist: run `/operator:user-init` (cross-project memory) or `/operator:project-init` (project memory) first. Without an initialized Brain the feature stays off and records one refusal receipt per session explaining why. The feature itself is off by default.

#### Configuration

Preferred: per-project `<project>/.operator/config.json`, using the same flat block names (no `operator` wrapper). `operator-helper project init` scaffolds it with everything disabled; the setup interview asks which features to enable. Present fields merge over plugin options below, so the project file wins on conflict:

```json
{
  "contextManagement": {
    "enabled": true,
    "ratio": 0.8,
    "hardCapTokens": 250000,
    "keepRecentTurns": 3,
    "compactOnComplete": true,
    "compactFloorTokens": 32000
  }
}
```

Alternative: organization-wide defaults through the `plugins` entry's `options` in global (`~/.config/opencode/opencode.json`) or project-root `opencode.json`/`opencode.jsonc` — which merge, so project settings add to global ones. Note: `.opencode/opencode.json` inside a project is not a live config path; plugin entries there are ignored. A local directory plugin entry resolves `<dir>/index.js` and ignores `package.json` `main`, so point it at the built `dist` directory:

```jsonc
{
  "plugins": [
    {
      "package": "<operator-memory>/packages/opencode-v2/dist",
      "options": {
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
    }
  ]
}
```

- `enabled`: the master switch. Vanilla Operator behavior is unchanged while `false`.
- `ratio`: trim past this fraction of the model's declared window.
- `hardCapTokens`: trim past this absolute size. The backstop when the model window is unknown.
- `keepRecentTurns`: the most recent assistant turns are never trimmed.
- `compactOnComplete`: compact at the end of successful runs.
- `compactFloorTokens`: skip end-of-run compaction below this size; small sessions gain nothing from it.

#### What it leaves behind

Receipts, one JSON line per trim or compaction, at `~/.operator/state/context-log/<sessionID>.log`:

```text
trim trigger=hard-cap tokens=20206 removed=8305 omissions=1
compact trigger=task-complete summarized=11951
```

Compact receipts name their cause: the firing trigger, or `manual` for compactions you (or the host) initiated. Refusals look like `refusal reason=brain-unavailable`.

Trimmed payloads live as plain files under `~/.operator/state/omitted/<sessionID>/<contentID>`, with an index per session. These are operational state, not Brain documents: never cataloged, safe to delete when the session is done with.

#### Recovering trimmed content

A notice in place of trimmed output names a content ID. In the same session, ask the agent to call `operator-read_omitted` with that ID — or call it yourself with the ID from the receipt log. IDs from other sessions do not resolve; re-trimming a session reuses the same IDs.

Checkpoints are a separate mechanism with their own recovery tools (`operator-recall`, `operator-search`); see the implementation spec for the contract.

#### Notes and limits

- A trim that fires writes one receipt; steady-state re-trims apply silently with identical notices.
- A satisfied trigger rests until context grows again (10 percent of the window or 25,000 tokens), so continued sessions do not re-compact on every run.
- Pending, running, and errored tool calls, user messages, and the preamble are never trimmed.
- Under `opencode run`, a compaction requested at the very end of the run can occasionally lose a race with process shutdown; mid-run compactions and interactive sessions are unaffected.

### Preamble Refresh

Opt-in mid-session preamble re-render when the Brain changes on disk — independent from context management, disabled by default, with its own switch. Prefer `<project>/.operator/config.json` (`{ "preambleRefresh": { "enabled": true } }`, scaffolded disabled by project init); the plugin-`options` form below sets organization-wide defaults instead:

```jsonc
{
  "plugins": [
    {
      "package": "<operator-memory>/packages/opencode-v2/dist",
      "options": {
        "operator": {
          "preambleRefresh": {
            "enabled": true
          }
        }
      }
    }
  ]
}
```

A Brain change re-renders from current disk state only when the provider's prompt cache is cold — rewriting the request prefix on a hot cache burns tokens for nothing. A hot-cache change waits for the next cold request, and the first request after a compaction refreshes unconditionally (compaction already flushed the cache). A refresh never triggers trim or compaction evaluation by itself. Every refresh appends one JSON line to the session context log; re-render failures keep the old preamble and surface through the existing error channel.

### Brain Updates

Opt-in nudge to record durable knowledge — never an automatic Brain writer. Disabled by default, with its own switch. Prefer `<project>/.operator/config.json` (`{ "brainUpdates": { "enabled": true, "toolCallThreshold": 25 } }`, scaffolded disabled by project init); the plugin-`options` form below sets organization-wide defaults instead:

```jsonc
{
  "plugins": [
    {
      "package": "<operator-memory>/packages/opencode-v2/dist",
      "options": {
        "operator": {
          "brainUpdates": {
            "enabled": true,
            "toolCallThreshold": 25
          }
        }
      }
    }
  ]
}
```

The adapter counts distinct completed tool calls since the last Brain change and appends one static reminder on the first request crossing the threshold. The reminder names no content and requires no edit: when nothing durable emerged, the agent makes none. A Brain change resets the baseline without reminding, and later crossings stay quiet until the Brain moves again.

### Update

OpenCode V2 owns plugin updates:

```sh
opencode plugin check
opencode plugin update
```

Restart OpenCode after updating.

### Troubleshooting

- `Operator Connecting` persists: the server plugin is not active. Rerun `operator-helper install opencode` and restart OpenCode.
- `Operator Unavailable` or sidebar `Error`: see [Troubleshooting](../troubleshooting.md).
- Duplicate plugin failures after installing both the global package and a local dev build: OpenCode V2 cannot dedupe package identity. Remove one source with `opencode plugin remove`.
