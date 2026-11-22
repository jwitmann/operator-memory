---

name: vcc-brain-index
description: Build or refresh the VCC Brain Project Index.
---

# VCC Brain Project Index Setup

1. Run `vcc-brain-helper version`. If an update is available, run `vcc-brain-helper upgrade` before continuing.
2. Run `vcc-brain-helper index init` and follow the emitted Project Index Setup guide, including when inspection reports failures.

If the Project Brain is missing, tell the user to invoke `$vcc-brain-project-init` to set it up.

## Recovery

- If Helper cannot start, install or repair the npm package `@jwitmann/vcc-brain-helper` globally and retry the failed command.
- If the version check or upgrade fails, diagnose the error and retry.
- If `vcc-brain-helper index init` reports a failure, use its output to resolve it and rerun it as needed.
- If you cannot resolve a problem, report the blocker.

Use Helper output as working context. Do not reproduce it wholesale or reimplement Helper logic.
