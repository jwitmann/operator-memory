# VCC Brain Helper

[![npm version](https://img.shields.io/npm/v/@jwitmann/vcc-brain-helper?color=8cdb9f)](https://www.npmjs.com/package/@jwitmann/vcc-brain-helper) [![Node.js 20+](https://img.shields.io/badge/Node.js-%3E%3D20-417e3f?logo=nodedotjs&logoColor=white)](https://nodejs.org/) [![BSD-3-Clause license](https://img.shields.io/badge/License-BSD--3--Clause-22C55E)](https://github.com/jwitmann/vcc-brain/blob/main/LICENSE) [![CI](https://github.com/jwitmann/vcc-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/jwitmann/vcc-brain/actions)

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
# OpenCode (V2, default)
vcc-brain-helper install opencode

# Pi
vcc-brain-helper install pi

# DeepSeek Harness
vcc-brain-helper install deepseek

# Codex
vcc-brain-helper install codex

# Claude Code
vcc-brain-helper install claude-code
```

OpenCode V1 is not supported and its package was never published, so there is no working V1 install route. Existing plugin registrations are not migrated automatically.

The OpenCode install registers the native plugin package through OpenCode's own plugin command — the equivalent of running it yourself:

```sh
opencode plugin add @jwitmann/vcc-brain-opencode-v2@latest
```

Or declare it in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@jwitmann/vcc-brain-opencode-v2"]
}
```

With options (organization-wide defaults that per-project `.vcc-brain/config.json` overrides; string and object forms can mix in one `plugins` array):

```jsonc
{
  "plugins": [
    {
      "package": "@jwitmann/vcc-brain-opencode-v2",
      "options": {
        "vcc-brain": {
          "contextManagement": { "enabled": true, "ratio": 0.8 }
        }
      }
    }
  ]
}
```

For local development, register the built output by directory path instead (a local directory entry resolves `<dir>/index.js`, so point it at `dist`):

```jsonc
{
  "plugins": [{ "package": "<vcc-brain>/packages/opencode-v2/dist" }]
}
```

Restart the harness, then run `/vcc-brain:user-init` in a new conversation to begin setup.

### Usage

Users interact with VCC Brain through the harness commands `/vcc-brain:user-init`, `/vcc-brain:project-init`, and `/vcc-brain:index`. These commands guide the working agent, which uses VCC Brain Helper for setup, status, and validation.

Run each VCC Brain command in a new conversation so the agent can focus on that operation with a clean working context. Initialization preserves existing content. Project setup configures `.vcc-brain/` in the global Git ignore but does not automatically untrack files already committed.

The direct user-facing Helper operation is adapter installation:

```sh
vcc-brain-helper install opencode
vcc-brain-helper install pi
vcc-brain-helper install deepseek
vcc-brain-helper install codex
vcc-brain-helper install claude-code
```

VCC Brain Helper automatically checks for and installs updates when commands run. If it cannot determine whether Bun or npm owns the global installation, it asks for a manual update using the original installation method.

### Documentation

- [Overview and setup](https://github.com/jwitmann/vcc-brain#readme)
- [Getting Started](https://github.com/jwitmann/vcc-brain/blob/main/docs/getting-started.md)
- [Architecture](https://github.com/jwitmann/vcc-brain/blob/main/docs/architecture.md)
- [Troubleshooting](https://github.com/jwitmann/vcc-brain/blob/main/docs/troubleshooting.md)

Licensed under the BSD 3-Clause License.
