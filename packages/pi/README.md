# VCC Brain for Pi

VCC Brain gives Pi durable project and user context maintained by agents as readable Markdown.

## Install

```sh
vcc-brain-helper install pi
```

The extension injects one immutable rendered VCC Brain preamble into every model call for each session and registers `/vcc-brain:user-init`, `/vcc-brain:project-init`, and `/vcc-brain:index`.

Pi displays VCC Brain status in its footer. Pi checks installed packages for updates and prompts you to run `pi update --extensions` when an update is available.
