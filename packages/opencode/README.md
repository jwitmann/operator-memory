# VCC Brain for OpenCode V1 (legacy)

VCC Brain: Durable context for agent-driven development.

This package is the legacy OpenCode V1 adapter for VCC Brain. For current OpenCode (V2), use `@jwitmann/vcc-brain-opencode-v2` through `vcc-brain-helper install opencode`.

### Install

Install VCC Brain Helper first:

```sh
npm install --global @jwitmann/vcc-brain-helper
```

Then install or update the OpenCode adapter:

```sh
vcc-brain-helper install opencode-v1
```

Restart OpenCode after installation. In a new conversation, run `/vcc-brain:user-init` to begin setup.

Do not install this package directly unless you are integrating VCC Brain with OpenCode manually. The VCC Brain Helper CLI is required for the plugin to work.

### OpenCode Commands

- `/vcc-brain:user-init` initializes or revises user-global instructions.
- `/vcc-brain:project-init` initializes project setup and guides Private and Shared knowledge.
- `/vcc-brain:index` builds or refreshes the Project Index.
- `/vcc-brain:repair` diagnoses and repairs loading problems.

Run each VCC Brain command in a new conversation so the agent can focus on setup, indexing, or repair with a clean working context.

### Documentation

- [Overview and setup](https://github.com/jwitmann/vcc-brain#readme)
- [Getting Started](https://github.com/jwitmann/vcc-brain/blob/main/docs/getting-started.md)
- [Architecture](https://github.com/jwitmann/vcc-brain/blob/main/docs/architecture.md)
- [Troubleshooting](https://github.com/jwitmann/vcc-brain/blob/main/docs/troubleshooting.md)

Licensed under the BSD 3-Clause License.
