type KiroFile = {
  readonly path: string;
  readonly content: string;
};

const HOOK = `${JSON.stringify(
  {
    version: "v1",
    hooks: [
      {
        name: "VCC Brain preamble",
        trigger: "SessionStart",
        action: { type: "command", command: "vcc-brain-helper preamble" },
        timeout: 120,
        enabled: true,
      },
    ],
  },
  null,
  2,
)}\n`;

const STEERING = `---
inclusion: always
---

# VCC Brain

VCC Brain is installed for Kiro. If you do not see VCC Brain's preamble guidance above wrapped within \`<vcc-brain-guidance>\`, manually run the \`vcc-brain-helper preamble\` command once from the workspace root and follow all instructions from the command output. If the command fails, report to the user and stop. Do not run if the preamble is already available.
`;

const RECOVERY = (command: string) => `## Recovery

- If Helper cannot start, install or repair the npm package \`@jwitmann/vcc-brain-helper\` globally and retry the failed command.
- If the version check or upgrade fails, diagnose the error and retry.
- If \`vcc-brain-helper ${command}\` reports a failure, use its output to resolve it and rerun it as needed.
- If you cannot resolve a problem, report the blocker.

Use Helper output as working context. Do not reproduce it wholesale or reimplement Helper logic.
`;

const USER_INIT = `---
name: vcc-brain-user-init
description: Initialize and configure the VCC Brain User Partition. Use only when the user invokes /vcc-brain-user-init.
---

# VCC Brain User Setup

1. Run \`vcc-brain-helper version\`. If an update is available, run \`vcc-brain-helper upgrade\` before continuing.
2. Run \`vcc-brain-helper user init\` and follow the emitted User Setup guide, including when initialization reports failures.

${RECOVERY("user init")}`;

const PROJECT_INIT = `---
name: vcc-brain-project-init
description: Initialize and configure the VCC Brain Project Brain. Use only when the user invokes /vcc-brain-project-init.
---

# VCC Brain Project Setup

1. Run \`vcc-brain-helper version\`. If an update is available, run \`vcc-brain-helper upgrade\` before continuing.
2. Run \`vcc-brain-helper project init\` and follow the emitted Project Setup guide, including when initialization reports failures.

For a new conversation to set up the Project Index, tell the user to invoke \`/vcc-brain-index\`.

${RECOVERY("project init")}`;

const INDEX = `---
name: vcc-brain-index
description: Build or refresh the VCC Brain Project Index. Use only when the user invokes /vcc-brain-index.
---

# VCC Brain Project Index Setup

1. Run \`vcc-brain-helper version\`. If an update is available, run \`vcc-brain-helper upgrade\` before continuing.
2. Run \`vcc-brain-helper index init\` and follow the emitted Project Index Setup guide, including when inspection reports failures.

If the Project Brain is missing, tell the user to invoke \`/vcc-brain-project-init\` to set it up.

${RECOVERY("index init")}`;

export const KIRO_FILES: ReadonlyArray<KiroFile> = [
  { path: "hooks/vcc-brain.json", content: HOOK },
  { path: "steering/vcc-brain.md", content: STEERING },
  { path: "skills/vcc-brain-user-init/SKILL.md", content: USER_INIT },
  { path: "skills/vcc-brain-project-init/SKILL.md", content: PROJECT_INIT },
  { path: "skills/vcc-brain-index/SKILL.md", content: INDEX },
];
