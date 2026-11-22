# VCC Brain for Codex

VCC Brain gives Codex durable project and user context maintained by agents as readable Markdown.

## Install

```sh
vcc-brain-helper install codex
```

Start a fresh Codex session after installation. Codex reviews plugin hooks on startup; approve the VCC Brain hooks when prompted. Until the hooks are trusted, Codex skips preamble injection.

The plugin injects the VCC Brain preamble into new and cleared sessions, reinjects it after context compaction, and injects it into delegated subagents. Resumed and forked sessions keep their existing context.

The three VCC Brain workflows are available as explicitly invoked skills: `$vcc-brain-user-init`, `$vcc-brain-project-init`, and `$vcc-brain-index`. Codex plugins do not register slash commands; invoke the skills by name.

Updates are applied by rerunning `vcc-brain-helper install codex`. Hook definitions stay byte-stable across releases, so updates normally do not require renewed trust.
