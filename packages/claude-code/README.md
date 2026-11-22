# VCC Brain for Claude Code

VCC Brain gives Claude Code durable project and user context maintained by agents as readable Markdown.

## Install

Requires Claude Code `v2.1.287` or newer and VCC Brain Helper on `PATH`.

```sh
vcc-brain-helper install claude-code
```

Start a new Claude Code process after installation. Run `claude plugin list` to confirm `vcc-brain@vcc-brain` is enabled, then ask the agent whether VCC Brain guidance is available.

The plugin injects the preamble into the main system prompt and subagent task prompts. It renders memory once per process; restart Claude Code to reload memory. `/clear` does not refresh the cached preamble.

## Commands

- `/vcc-brain:user-init` — Configure the User Partition.
- `/vcc-brain:project-init` — Configure the Project Brain.
- `/vcc-brain:index` — Build or refresh the Project Index.

## Update

Rerun `vcc-brain-helper install claude-code` or use `claude plugin update vcc-brain@vcc-brain`, then restart Claude Code.

See the [Claude Code guide](https://github.com/jwitmann/vcc-brain/blob/main/docs/harnesses/claude-code.md) for verification, updates, and troubleshooting. For local development, run `bun run preview:claude-code` from the workspace root.
