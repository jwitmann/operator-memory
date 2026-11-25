# Pi

### Install

Requires Node.js 20 or newer (for VCC Brain Helper) and the [Helper](../../README.md#installation) installed.

```sh
vcc-brain-helper install pi
```

Start a new Pi session after installation.

### Verify

In a new conversation, ask:

```text
Is VCC Brain guidance available to you? Give a brief outline of what it says.
```

The agent should confirm the guidance is loaded and outline the brain, partitions, and memory-aware workflow. If it cannot, injection is not working.

Secondary signal: the footer shows `· VCC Brain Active (vX.Y.Z)`; local builds show `(Local Build)`. `· VCC Brain Unavailable` means memory failed to load. `· VCC Brain Error` means rendering failed — rerun the install command and restart Pi.

### Commands

- `/vcc-brain:user-init`
- `/vcc-brain:project-init`
- `/vcc-brain:index`

Run each in a new conversation. See [Getting Started](../getting-started.md#appendix-commands) for what each command does.

### Update

Pi reports available package updates at startup. Apply them with:

```sh
pi update --extensions
```

### Compaction

VCC Brain on Pi is memory only: it ships no deterministic compaction of its own. For long sessions, pair it with the third-party [pi-tuck](https://github.com/galyavin/pi-tuck) extension, which compacts deterministically without a model call and can recall exact pre-cut content:

```sh
pi install npm:pi-tuck
```

pi-tuck is maintained outside this project. No adapter wires the two together yet — VCC Brain leaves `/compact` and automatic cuts to it, but the integration is unwritten and needs someone who runs Pi.

### Troubleshooting

- No VCC Brain footer: the extension did not load. Rerun `vcc-brain-helper install pi` and start a new session.
- VCC Brain commands appear with a numeric suffix such as `:1`: another extension registered the same name. Use the suffixed name or rename the conflicting extension.
- Subagents do not receive VCC Brain: only persistent package registrations are inherited by child processes. Install via the command above rather than a temporary `-e` registration.
- Footer `Unavailable` or missing memory: see [Troubleshooting](../troubleshooting.md).
