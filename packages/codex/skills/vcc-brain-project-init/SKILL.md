---

name: vcc-brain-project-init
description: Initialize and configure the VCC Brain Project Brain.
---

# VCC Brain Project Setup

1. Run `vcc-brain-helper version`. If an update is available, run `vcc-brain-helper upgrade` before continuing.
2. Run `vcc-brain-helper project init` and follow the emitted Project Setup guide, including when initialization reports failures.

For a new conversation to set up the Project Index, tell the user to invoke `$vcc-brain-index`.

## Recovery

- If Helper cannot start, install or repair the npm package `@jwitmann/vcc-brain-helper` globally and retry the failed command.
- If the version check or upgrade fails, diagnose the error and retry.
- If `vcc-brain-helper project init` reports a failure, use its output to resolve it and rerun it as needed.
- If you cannot resolve a problem, report the blocker.

Use Helper output as working context. Do not reproduce it wholesale or reimplement Helper logic.
