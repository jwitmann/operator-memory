# VCC Brain for DeepSeek Harness

VCC Brain gives DeepSeek Harness durable project and user context maintained by agents as readable Markdown.

## Install

Requires Node.js 22.19 or newer, DeepSeek Harness, and the [Helper](https://github.com/jwitmann/vcc-brain#installation) installed.

```sh
vcc-brain-helper install deepseek
```

Helper attempts the default Web and Desktop profiles independently. Restart Web after installation. Desktop uses its own bundled runtime: launch Desktop once to initialize its profile, fully quit the application, then rerun the install command using Desktop's installed `dsh` command.

Install into another profile with DeepSeek's native command:

```sh
dsh plugin --profile <profile-name> add @jwitmann/vcc-brain-deepseek
```

## Verify

Web and Desktop display `VCC Brain Ready (vX.Y.Z)` beneath the active conversation's composer when the plugin is available. In a new conversation, ask the agent whether VCC Brain guidance is available; it should outline the Brain, partitions, and memory-aware workflow.

## Commands

DeepSeek command names use hyphens:

- `/vcc-brain-user-init`
- `/vcc-brain-project-init`
- `/vcc-brain-index`

Profiles without DeepSeek's interactive command service still receive the VCC Brain preamble but do not expose these commands.

## Update

Rerun `vcc-brain-helper install deepseek`, or update a specific profile through DeepSeek:

```sh
dsh plugin --profile <profile-name> update @jwitmann/vcc-brain-deepseek
```

Fully quit Desktop before updating its profile and restart the affected profile after updating. See the [DeepSeek Harness guide](https://github.com/jwitmann/vcc-brain/blob/main/docs/harnesses/deepseek.md) for troubleshooting.
