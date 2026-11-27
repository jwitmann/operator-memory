# OpenCode

OpenCode V2 is the supported version. OpenCode V1 is not supported.

### Install

Requires Node.js 20 or newer (for VCC Brain Helper) and the [Helper](../../README.md#installation) installed.

```sh
vcc-brain-helper install opencode
```

Restart OpenCode after installation. Until OpenCode reloads the plugin, commands and preamble injection will not work.

OpenCode V1 is not supported and its package was never published, so there is no working V1 install route. Installing V2 does not remove or migrate existing plugin registrations.

### Verify

In a new conversation, ask:

```text
Is VCC Brain guidance available to you? Give a brief outline of what it says.
```

The agent should confirm the guidance is loaded and outline the brain, partitions, and memory-aware workflow. If it cannot, injection is not working.

Secondary signals: the home footer shows `VCC Brain Ready (vX.Y.Z)` and the session sidebar shows partition states. `VCC Brain Connecting` means the TUI is still verifying the server plugin; `VCC Brain Unavailable` means the status query failed.

### Commands

- `/vcc-brain:user-init`
- `/vcc-brain:project-init`
- `/vcc-brain:index`

Run each in a new conversation. See [Getting Started](../getting-started.md#appendix-commands) for what each command does.

Once the basics are running, see [Context Management](#context-management): deterministic trim and compaction that reduce what a session resends to the model. Off by default — use full mode only where no external VCC compaction engine runs in the same sessions, or `"vcc"` mode alongside one (see [One compaction provider per session](#one-compaction-provider-per-session)).

### Context Management

When enabled, VCC Brain reduces what a session resends to the model. Three deterministic rules, evaluated with token arithmetic and host-reported run outcomes — never model judgment. Trim is ours in both modes; in full mode snapshot recall is also ours, and the compaction override runs through an in-tree port of the [VCC reference engine](https://github.com/jwitmann/opencode-vcc-compaction) — a fallback subset (no `vccRev`/`vccConfigHash` stamping, no tunables), not the full engine. That port exists from before a standalone engine was available: where the standalone `opencode-vcc-compaction` engine is installed, prefer it with `"mode": "vcc"` — one compaction provider per session.

Why shaped compaction matters: a plain summarizer rewrites what it touches, including your rules — a restated rule is a different rule, and the next session treats the paraphrase as fact. VCC Brain's compaction instructions forbid restating Brain content: durable findings are written to the Brain before summarizing, the summary references Brain paths instead of inlining them, and trimmed tool output keeps verbatim omission handles recoverable through `vcc-brain-read_omitted`. Your rules survive long sessions as pointers to verbatim source. Shaping is prompt-only — the host still writes the summary.

1. A run ends successfully and context clears `compactFloorTokens`: call for a compaction once.
2. Estimated context passes `ratio` of the model window: trim bulky tool I/O, then call for a compaction if still over.
3. Estimated context passes `hardCapTokens`: same as above, absolute.

In full mode these rules issue compaction *calls* — requests to the host. In `"vcc"` mode threshold rules still trim but do not request compaction; only the end-of-run rule still calls. The summary itself is the VCC engine's work: our deterministic override in full mode, the standalone engine in `"vcc"` mode. Triggers decide *when*; the engine decides *how*.

Trimming replaces completed tool inputs and outputs with short notices and stores the originals on disk; compaction summarizes history through the host's normal compaction, shaped to reference your Brain instead of inlining it. The host's own native compaction keeps working unchanged — this feature acts earlier and audits everything it does.

#### Prerequisites

The Brain must exist: run `/vcc-brain:user-init` (cross-project memory) or `/vcc-brain:project-init` (project memory) first. Without an initialized Brain the feature stays off and records one refusal receipt per session explaining why. The feature itself is off by default.

#### One compaction provider per session

Do not enable VCC Brain context management in full mode in a session that already runs another compaction/recall engine (for example the standalone `opencode-vcc-port`). Two active stacks write two snapshot stores and register two recall tool pairs with incompatible checkpoint shapes, and the agent can call the wrong recall. When our plugin detects a foreign engine in full mode it stands its own context management down automatically (warning toast; preamble, refresh, and brain updates stay on). Use `"vcc"` mode for supported coexistence, or disable ours entirely: exactly one provider summarizes and recalls per session.

#### Configuration

Preferred: per-project `<project>/.vcc-brain/config.json`, using the same flat block names (no `vcc-brain` wrapper). `vcc-brain-helper project init` scaffolds it with everything disabled; the setup interview asks which features to enable. Present fields merge over plugin options below, so the project file wins on conflict:

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
      "package": "<vcc-brain>/packages/opencode-v2/dist",
      "options": {
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
    }
  ]
}
```

- `enabled`: the master switch. Vanilla VCC Brain behavior is unchanged while `false`.
- `mode`: `"full"` (default) or `"vcc"`. `"vcc"` partitions ownership with an external VCC compaction engine: trim, trigger evaluation, receipts, and omission recovery stay on, while the compaction hook, snapshot, per-session recall/search, and engine stand-down stay off. Threshold compaction calls are suppressed; end-of-run calls still fire. The engine summarizes whatever the host compacts. An invalid value fails loudly.
- `ratio`: trim past this fraction of the model's declared window.
- `hardCapTokens`: trim past this absolute size. The backstop when the model window is unknown.
- `keepRecentTurns`: the most recent assistant turns are never trimmed.
- `compactOnComplete`: call for a host compaction at the end of successful runs — the call only; the active engine performs the summary.
- `compactFloorTokens`: skip end-of-run compaction below this size; small sessions gain nothing from it.

#### What it leaves behind

Receipts, one JSON line per trim or compaction, at `~/.vcc-brain/state/context-log/<sessionID>.log`:

```text
trim trigger=hard-cap tokens=20206 removed=8305 omissions=1
compact trigger=task-complete summarized=11951
```

Compact receipts name their cause: the firing trigger, or `manual` for compactions you (or the host) initiated. Refusals look like `refusal reason=brain-unavailable`.

Trimmed payloads live as plain files under `~/.vcc-brain/state/omitted/<sessionID>/<contentID>`, with an index per session. These are operational state, not Brain documents: never cataloged, safe to delete when the session is done with.

#### Recovering trimmed content

A notice in place of trimmed output names a content ID. In the same session, ask the agent to call `vcc-brain-read_omitted` with that ID — or call it yourself with the ID from the receipt log. IDs from other sessions do not resolve; re-trimming a session reuses the same IDs.

Checkpoints are a separate mechanism with their own recovery tools (`vcc-brain-recall`, `vcc-brain-search`); see the implementation spec for the contract.

#### Notes and limits

- A trim that fires writes one receipt; steady-state re-trims apply silently with identical notices.
- A satisfied trigger rests until context grows again (10 percent of the window or 25,000 tokens), so continued sessions do not re-compact on every run.
- Pending, running, and errored tool calls, user messages, and the preamble are never trimmed.
- Under `opencode run`, a compaction requested at the very end of the run can occasionally lose a race with process shutdown; mid-run compactions and interactive sessions are unaffected.

### Preamble Refresh

Opt-in mid-session preamble re-render when the Brain changes on disk — independent from context management, disabled by default, with its own switch. Prefer `<project>/.vcc-brain/config.json` (`{ "preambleRefresh": { "enabled": true } }`, scaffolded disabled by project init); the plugin-`options` form below sets organization-wide defaults instead:

```jsonc
{
  "plugins": [
    {
      "package": "<vcc-brain>/packages/opencode-v2/dist",
      "options": {
        "vcc-brain": {
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

Opt-in nudge to record durable knowledge — never an automatic Brain writer. Disabled by default, with its own switch. Prefer `<project>/.vcc-brain/config.json` (`{ "brainUpdates": { "enabled": true, "toolCallThreshold": 25 } }`, scaffolded disabled by project init); the plugin-`options` form below sets organization-wide defaults instead:

```jsonc
{
  "plugins": [
    {
      "package": "<vcc-brain>/packages/opencode-v2/dist",
      "options": {
        "vcc-brain": {
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

### Cross-Session Recall

Beyond the curated Brain, the agent can search the raw text of past sessions. `vcc-brain-search-sessions` takes keywords and returns matching turns with their stored session ids; `vcc-brain-recall-session` restores one indexed session's full turns by id, optionally a single turn by sequence number. Same-conversation lookup stays on the `vcc-brain-recall` / `vcc-brain-search` snapshot tools; the cross-session pair never reads the live session.

Search scope is the setup-time project directory plus mutual peers; out-of-scope sessions are excluded, not downranked. OpenCode results require one `vcc-brain-helper recall-cross index` run on the machine first — ask the agent to run it; a cold index reports that instead of guessing. The index lives local-only under `~/.vcc-brain/state/recall-index/` (directory `0700`, file `0600`) with 30-day retention, and the agent can explicitly forget a superseded session. Sessions carrying exactly the title `[no-recall]` are never indexed.

Declare peers in the project's `.vcc-brain/config.json`:

```jsonc
{ "peers": ["/home/jerome/checkouts/other-project"] }
```

Sharing is mutual: the other project must list this one back. Without a mutual declaration, recall stays scoped to the current project.

### Update

OpenCode V2 owns plugin updates:

```sh
opencode plugin check
opencode plugin update
```

Restart OpenCode after updating.

### Troubleshooting

- `VCC Brain Connecting` persists: the server plugin is not active. Rerun `vcc-brain-helper install opencode` and restart OpenCode.
- `VCC Brain Unavailable` or sidebar `Error`: see [Troubleshooting](../troubleshooting.md).
- Duplicate plugin failures after installing both the global package and a local dev build: OpenCode V2 cannot dedupe package identity. Remove one source with `opencode plugin remove`.
