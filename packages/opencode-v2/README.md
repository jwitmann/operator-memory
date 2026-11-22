# VCC Brain for OpenCode

VCC Brain gives current OpenCode (V2) durable project and user context maintained by agents as readable Markdown. Legacy OpenCode V1 is frozen and unpublished: it receives no releases and no V1 package ships under the new scope.

### Install

```sh
vcc-brain-helper install opencode
```

The server plugin injects one immutable rendered VCC Brain preamble into every model call for each session and registers `/vcc-brain:user-init`, `/vcc-brain:project-init`, and `/vcc-brain:index`.

The TUI displays connecting and ready state, package version or local-build identity, User/Private/Shared partition status, repair guidance, completed-turn refresh, and preamble recovery and error notifications.

### Local Development

From the repository root, run `bun run install:opencode`. It builds and links Helper, builds the development plugin, and registers its local directory globally while disabling the published plugin ID. Existing config is preserved. Restart OpenCode to load the build; there is no separate preview command.
