# Codex

### Install

Requires Node.js 20 or newer (for VCC Brain Helper) and the [Helper](../../README.md#installation) installed.

```sh
vcc-brain-helper install codex
```

This installs the plugin from VCC Brain's local marketplace as `jwitmann@vcc-brain` and verifies it is enabled. Start a fresh Codex session after installation.

**When Codex first starts the plugin, it prompts you to approve VCC Brain's hooks. Approve them — until you do, preamble injection silently does not run.**

### Verify

Codex has no status UI, so verify through the agent. In a fresh session, ask:

```text
Is VCC Brain guidance available to you? Give a brief outline of what it says.
```

The agent should confirm the guidance is loaded and outline the brain, partitions, and memory-aware workflow. If it cannot, confirm the hooks were approved during Codex's startup review and that the plugin is enabled, then start a fresh session.

### Commands

Codex plugins cannot register slash commands. The VCC Brain workflows are plugin skills, invoked explicitly or through Codex's skills picker:

- `$vcc-brain-user-init`
- `$vcc-brain-project-init`
- `$vcc-brain-index`

See [Getting Started](../getting-started.md#appendix-commands) for what each workflow does.

### Update

Codex has no native update flow for marketplace plugins. Rerun:

```sh
vcc-brain-helper install codex
```

Then start a fresh Codex session.

### Troubleshooting

- No preamble injection: hooks were not approved. Codex reviews untrusted or modified hooks at startup; approve VCC Brain's hooks when prompted. Helper never writes hook trust itself.
- The `codex` CLI is unavailable: Helper instead writes the `vcc-brain` marketplace entry to `config.toml` (in `CODEX_HOME`, default `~/.codex`) and you install the plugin manually from Codex's plugins browser.
- Installation fails with an invalid `config.toml` error: Helper refuses to edit a `config.toml` whose `marketplaces` value is not expressed as tables. Convert it to table form and rerun the install command.
- Missing memory or load failures: see [Troubleshooting](../troubleshooting.md).
