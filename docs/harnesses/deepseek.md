# DeepSeek Harness

### Install

Requires Node.js 22.19 or newer, DeepSeek Harness, and the [Helper](../../README.md#installation) installed.

```sh
vcc-brain-helper install deepseek
```

Helper attempts the default Web and Desktop profiles independently. Restart Web after installation. Desktop uses its own bundled runtime: launch Desktop once to initialize its profile, fully quit the application, then rerun the install command using Desktop's installed `dsh` command. You can also install VCC Brain from Desktop's Plugins page.

Install into another profile with DeepSeek's native command:

```sh
dsh plugin --profile <profile-name> add @jwitmann/vcc-brain-deepseek
```

### Verify

Web and Desktop display `VCC Brain Ready (vX.Y.Z)` beneath the active conversation's composer when the plugin is available.

In a new conversation, ask:

```text
Is VCC Brain guidance available to you? Give a brief outline of what it says.
```

The agent should confirm the guidance is loaded and outline the Brain, partitions, and memory-aware workflow. If it cannot, injection is not working.

### Commands

DeepSeek command names use hyphens:

- `/vcc-brain-user-init`
- `/vcc-brain-project-init`
- `/vcc-brain-index`

Run each in a new conversation. See [Getting Started](../getting-started.md#appendix-commands) for what each command does. Profiles without DeepSeek's interactive command service still receive the VCC Brain preamble but do not expose these commands.

Once the basics are running, see [Context Management](#context-management): host-driven compaction with per-session receipts. Off by default — enable it during project setup.

### Context Management

Long sessions must compact, and a plain summarizer rewrites your rules in the process — a restated rule is a different rule. The adapter shapes every compaction it requests so the summary references Brain paths instead of restating them, with durable findings written to the Brain first.

The adapter participates in host-driven compaction; there is no trim port. DeepSeek freezes agent-loop requests by host contract ("listeners read it, never rewrite it"), so request-view reduction has no legal seam — the host's own tool-result pruner owns that layer. There is no omission store and no `read_omitted`/`prune` tools on this adapter (`keepRecentTurns` is parsed for compatibility but reserved). Recovery reads the durable session log directly through `vcc-brain-recall` (seq, tool-result, or checkpoint restore) and `vcc-brain-search` (keyword or regex returning `(seq N)` pointers); checkpoint pointers address the host-readable log natively, so no snapshot file exists.

When session pressure or a completed run fires, the adapter requests compaction through the host's own compaction service — the same hook the host backend uses — so host policy stays authoritative. Verbatim deterministic compaction is a backend choice, not adapter code: [dsh-compaction-vcc](https://github.com/tingfeng-droid/dsh-compaction-vcc) installs as a drop-in for `dsh-compaction-basic` at the profile layer (`dsh plugin --profile <profile-name> add dsh-compaction-vcc`). Compact receipts attribute the engine from the session's compaction provenance (`vcc`, `shaped`, or `unknown`), reusing Core's receipt shapes in the session context log at `~/.vcc-brain/state/context-log/<sessionID>.log`.

Configuration is per project via `<project>/.vcc-brain/config.json`, using the same flat block names (no `vcc-brain` wrapper). All features default OFF; there is currently no profile-wide switch:

```json
{
  "contextManagement": {
    "enabled": true,
    "ratio": 0.8,
    "hardCapTokens": 250000,
    "compactOnComplete": true,
    "compactFloorTokens": 32000
  },
  "brainUpdates": {
    "enabled": true
  },
  "preambleRefresh": {
    "enabled": true
  }
}
```

Present fields merge over the profile defaults, so a project can flip one knob and inherit the rest. Invalid blocks warn once and fall back; unreadable files fall back silently. Brain-update reminders and preamble refreshes follow the same gates as the OpenCode adapter (fingerprint-era quiet, cold-cache timing) and fail closed without a Brain.

### Cross-Session Recall

Beyond the curated Brain, the agent can search the raw text of past sessions. `vcc-brain-search-sessions` takes keywords and returns matching turns with their stored session ids; `vcc-brain-recall-session` restores one indexed session's full turns by id, optionally a single turn by sequence number. Use `vcc-brain-search` for the current conversation; the cross-session pair never reads the live session.

Search scope is the calling session's project plus mutual peers; out-of-scope sessions are excluded, not downranked. History syncs on demand at query time; ask the agent to run `vcc-brain-helper recall-cross index` once to warm the machine-wide index. The index lives local-only under `~/.vcc-brain/state/recall-index/` (directory `0700`, file `0600`) with 30-day retention, and the agent can explicitly forget a superseded session. Sessions carrying exactly the title `[no-recall]` are never indexed. The tools work wherever the plugin is active, independent of the command service.

Declare peers in the project's `.vcc-brain/config.json`:

```jsonc
{ "peers": ["/home/jerome/checkouts/other-project"] }
```

Sharing is mutual: the other project must list this one back. Without a mutual declaration, recall stays scoped to the current project.

### Update

Rerun `vcc-brain-helper install deepseek`, or update a specific profile through DeepSeek:

```sh
dsh plugin --profile <profile-name> update @jwitmann/vcc-brain-deepseek
```

Fully quit Desktop before updating its profile and use Desktop's installed `dsh` command. Restart the affected profile after updating.

### Troubleshooting

- Web installs but Desktop does not: launch Desktop once, fully quit it, select Desktop's `dsh` command through **Manage dsh Command…**, then rerun the install. The npm-installed CLI cannot manage Desktop's profile. The Desktop Plugins page is an alternative.
- Commands are absent: the active profile does not provide DeepSeek's interactive command service. Preamble injection remains available.
- VCC Brain guidance is absent: rerun the profile installation command and restart that profile.
- Missing memory or load failures: see [Troubleshooting](../troubleshooting.md).
- An out-of-process ACP, SDK, Codex, or Claude Code delegated agent does not receive VCC Brain from its parent. Install the matching VCC Brain adapter in that delegated harness.
