# Claude Code

### Install

Requires Claude Code `v2.1.287` or newer, Node.js 20 or newer, and the [Helper](../../README.md#installation) installed on `PATH`.

```sh
vcc-brain-helper install claude-code
```

Helper registers the marketplace from `jwitmann/vcc-brain`, installs `vcc-brain@vcc-brain` from npm through Claude's native installer, and verifies it is enabled. Claude owns the package download and cache. Start a new Claude Code process after installation.

### Verify

Run `claude plugin list` and confirm `vcc-brain@vcc-brain` is enabled. In a fresh Claude Code process, ask:

```text
Is VCC Brain guidance available to you? Give a brief outline of what it says.
```

The agent should describe the Brain, partitions, and memory-aware workflow. VCC Brain has no status UI in Claude Code.

### Commands

- `/vcc-brain:user-init` — Configure the User Partition.
- `/vcc-brain:project-init` — Configure the Project Brain.
- `/vcc-brain:index` — Build or refresh the Project Index.

These are explicitly invoked skills. The agent runs Helper and follows its output in the current conversation, using your existing tool permissions. See [Getting Started](../getting-started.md#appendix-commands).

### Memory And Updates

VCC Brain renders memory once per Claude Code process. It appends that preamble to the main system prompt and prepends the same text to delegated subagents' task prompts. Compaction keeps the cached preamble. `/clear`, `/resume`, and `/branch` do not refresh it; restart Claude Code to load changed memory.

Install adapter updates with:

```sh
vcc-brain-helper install claude-code
```

Or use Claude's native update command:

```sh
claude plugin update vcc-brain@vcc-brain
```

Then restart Claude Code. Third-party marketplace auto-update is off by default; enable it in Claude's `/plugin` marketplace settings if wanted.

### Troubleshooting

- No injection: check the Claude Code version, confirm the plugin is enabled, and ensure `vcc-brain-helper` is on `PATH`.
- Hooks disabled: `disableAllHooks`, `--bare`, and `--safe-mode` prevent VCC Brain's mod injection. Organization policies such as `allowManagedHooksOnly` and `allowManagedModsOnly` can restrict installed hooks or mods; check the applicable policy with your administrator.
- Helper failure: VCC Brain logs a recovery cue and injects nothing. Repair Helper's global installation and restart Claude Code.
- Local plugin load failure: run `claude plugin validate <plugin-directory>` and launch with `claude --debug` for load diagnostics. For development, `bun run preview:claude-code` builds Helper and the adapter and launches the local plugin.
- Direct `<package>@npm` installation reports an account gate: use `vcc-brain-helper install claude-code`, which uses the repository marketplace's npm source instead.

See [Troubleshooting](../troubleshooting.md) for partition and memory repair.
