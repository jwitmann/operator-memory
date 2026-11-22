# VCC Brain Helper

VCC Brain: Durable context for agent-driven development.

VCC Brain Helper installs and manages VCC Brain, an agent-driven development framework that turns agent work into lasting project knowledge through continuous documentation.

### Install

VCC Brain Helper requires Node.js 20 or newer.

```sh
npm install --global @jwitmann/vcc-brain-helper
```

Or with Bun:

```sh
bun add --global --minimum-release-age 0 @jwitmann/vcc-brain-helper@latest
```

Install an adapter:

```sh
# OpenCode (V2)
vcc-brain-helper install opencode

# OpenCode 1 (legacy)
vcc-brain-helper install opencode-v1

# Pi
vcc-brain-helper install pi

# DeepSeek Harness
vcc-brain-helper install deepseek

# Kiro
vcc-brain-helper install kiro
```

OpenCode defaults to V2; `install opencode-v1` is the explicit legacy route. Existing plugin registrations are not migrated automatically.

Restart the harness, then run `/vcc-brain:user-init` in a new conversation to begin setup.

### Usage

Users interact with VCC Brain through the harness commands `/vcc-brain:user-init`, `/vcc-brain:project-init`, and `/vcc-brain:index`. These commands guide the working agent, which uses VCC Brain Helper for setup, status, and validation.

Run each VCC Brain command in a new conversation so the agent can focus on that operation with a clean working context. Initialization preserves existing content. Project setup configures `.vcc-brain/` in the global Git ignore but does not automatically untrack files already committed.

The direct user-facing Helper operation is adapter installation:

```sh
vcc-brain-helper install opencode
vcc-brain-helper install opencode-v1
vcc-brain-helper install pi
vcc-brain-helper install deepseek
vcc-brain-helper install kiro
```

VCC Brain Helper automatically checks for and installs updates when commands run. If it cannot determine whether Bun or npm owns the global installation, it asks for a manual update using the original installation method.

### Documentation

- [Overview and setup](https://github.com/jwitmann/vcc-brain#readme)
- [Getting Started](https://github.com/jwitmann/vcc-brain/blob/main/docs/getting-started.md)
- [Architecture](https://github.com/jwitmann/vcc-brain/blob/main/docs/architecture.md)
- [Troubleshooting](https://github.com/jwitmann/vcc-brain/blob/main/docs/troubleshooting.md)

Licensed under the BSD 3-Clause License.
