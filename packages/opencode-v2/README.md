# VCC Brain for OpenCode

VCC Brain gives current OpenCode (V2) durable project and user context maintained by agents as readable Markdown. Legacy OpenCode V1 is frozen and unpublished: it receives no releases and no V1 package ships under the new scope.

## Install

Requires Node.js 20 or newer and VCC Brain Helper installed.

```sh
vcc-brain-helper install opencode
```

Restart OpenCode after installation. Until OpenCode reloads the plugin, commands and preamble injection will not work.

## Verify

In a new conversation, ask the agent whether VCC Brain guidance is available; it should outline the Brain, partitions, and memory-aware workflow. The home footer shows `VCC Brain Ready (vX.Y.Z)` when the server plugin is active.

## Commands

- `/vcc-brain:user-init` — Configure the User Partition.
- `/vcc-brain:project-init` — Configure the Project Brain.
- `/vcc-brain:index` — Build or refresh the Project Index.

The agent can also search past sessions by keyword (`vcc-brain-search-sessions`) and restore a session's full turns (`vcc-brain-recall-session`), scoped to the current project plus mutual peers. Ask the agent to run `vcc-brain-helper recall-cross index` once on the machine so OpenCode history is indexed.

## Update

OpenCode owns plugin updates:

```sh
opencode plugin check
opencode plugin update
```

Restart OpenCode after updating.

See the [OpenCode guide](https://github.com/jwitmann/vcc-brain/blob/main/docs/harnesses/opencode-v2.md) for verification, updates, and troubleshooting.

## Local Development

From the repository root, run `bun run install:opencode`. It builds and links Helper, builds the development plugin, and registers its local directory globally while disabling the published plugin ID. Existing config is preserved. Restart OpenCode to load the build; there is no separate preview command.
