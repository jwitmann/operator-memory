# DeepSeek Harness

### Install

Requires Node.js 22.19 or newer, DeepSeek Harness, and the [Helper](../../README.md#installation) installed.

```sh
operator-helper install deepseek
```

Helper attempts the default Web and Desktop profiles independently. Restart Web after installation. Desktop uses its own bundled runtime: launch Desktop once to initialize its profile, fully quit the application, then rerun the install command using Desktop's installed `dsh` command. You can also install Operator from Desktop's Plugins page.

Install into another profile with DeepSeek's native command:

```sh
dsh plugin --profile <profile-name> add @jwitmann/operator-deepseek
```

### Verify

Web and Desktop display `Operator Ready (vX.Y.Z)` beneath the active conversation's composer when the plugin is available.

In a new conversation, ask:

```text
Is Operator Memory guidance available to you? Give a brief outline of what it says.
```

The agent should confirm the guidance is loaded and outline the Brain, partitions, and memory-aware workflow. If it cannot, injection is not working.

### Commands

DeepSeek command names use hyphens:

- `/operator-user-init`
- `/operator-project-init`
- `/operator-index`

Run each in a new conversation. See [Getting Started](../getting-started.md#appendix-commands) for what each command does. Profiles without DeepSeek's interactive command service still receive the Operator preamble but do not expose these commands.

Once the basics are running, see [Context Management](#context-management): host-driven compaction with per-session receipts. Off by default — enable it during project setup.

### Context Management

Long sessions must compact, and a plain summarizer rewrites your rules in the process — a restated rule is a different rule. The adapter shapes every compaction it requests so the summary references Brain paths instead of restating them, with durable findings written to the Brain first.

The adapter participates in host-driven compaction; there is no trim port. DeepSeek freezes agent-loop requests by host contract ("listeners read it, never rewrite it"), so request-view reduction has no legal seam — the host's own tool-result pruner owns that layer. There is no omission store and no `read_omitted`/`prune` tools on this adapter (`keepRecentTurns` is parsed for compatibility but reserved). Recovery reads the durable session log directly through `operator-recall` (seq, tool-result, or checkpoint restore) and `operator-search` (keyword or regex returning `(seq N)` pointers); checkpoint pointers address the host-readable log natively, so no snapshot file exists.

When session pressure or a completed run fires, the adapter requests compaction through the host's own compaction service — the same hook the host backend uses — so host policy stays authoritative. Verbatim deterministic compaction is a backend choice, not adapter code: [dsh-compaction-vcc](https://github.com/tingfeng-droid/dsh-compaction-vcc) installs as a drop-in for `dsh-compaction-basic` at the profile layer (`dsh plugin --profile <profile-name> add dsh-compaction-vcc`). Compact receipts attribute the engine from the session's compaction provenance (`vcc`, `shaped`, or `unknown`), reusing Core's receipt shapes in the session context log at `~/.operator/state/context-log/<sessionID>.log`.

Configuration is per project via `<project>/.operator/config.json`, using the same flat block names (no `operator` wrapper). All features default OFF; there is currently no profile-wide switch:

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

### Update

Rerun `operator-helper install deepseek`, or update a specific profile through DeepSeek:

```sh
dsh plugin --profile <profile-name> update @jwitmann/operator-deepseek
```

Fully quit Desktop before updating its profile and use Desktop's installed `dsh` command. Restart the affected profile after updating.

### Troubleshooting

- Web installs but Desktop does not: launch Desktop once, fully quit it, select Desktop's `dsh` command through **Manage dsh Command…**, then rerun the install. The npm-installed CLI cannot manage Desktop's profile. The Desktop Plugins page is an alternative.
- Commands are absent: the active profile does not provide DeepSeek's interactive command service. Preamble injection remains available.
- Operator guidance is absent: rerun the profile installation command and restart that profile.
- Missing memory or load failures: see [Troubleshooting](../troubleshooting.md).
- An out-of-process ACP, SDK, Codex, or Claude Code delegated agent does not receive Operator from its parent. Install the matching Operator adapter in that delegated harness.
