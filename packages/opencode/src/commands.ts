import type { Config } from "@opencode-ai/plugin";

export const OPERATOR_COMMAND_NAMES = [
  "vcc-brain:user-init",
  "vcc-brain:project-init",
  "vcc-brain:index",
  "vcc-brain:repair",
] as const;

const commands = {
  "vcc-brain:user-init": {
    description: "Initialize VCC Brain User Instructions",
    operation: "user init",
    guide:
      "Follow the User Setup guide in its output, including when initialization reports failures.",
  },
  "vcc-brain:project-init": {
    description: "Initialize VCC Brain Project",
    operation: "project init",
    guide:
      "Follow the Project Setup guide in its output, including when initialization reports failures.",
  },
  "vcc-brain:index": {
    description: "Build or refresh the VCC Brain Project Index",
    operation: "index init",
    guide:
      "Follow the Project Index Setup guide in its output, including when inspection reports failures.",
  },
  "vcc-brain:repair": {
    description: "Repair VCC Brain",
    operation: "memory check",
    guide:
      "If no issues are detected, stop. Otherwise, repair only the reported load failures without initializing absent partitions. Rerun `vcc-brain-helper memory check` to confirm the repair, then read the applicable VCC Brain memory documents.",
  },
} as const;

export function registerCommands(config: Config): void {
  config.command ??= {};
  for (const name of OPERATOR_COMMAND_NAMES) {
    const command = commands[name];
    config.command[name] ??= {
      description: command.description,
      template: `# ${command.description}

1. Run \`vcc-brain-helper version\`. If an update is available, run \`vcc-brain-helper upgrade\` before continuing.
2. Run \`vcc-brain-helper ${command.operation}\`. ${command.guide}

## Recovery

- If Helper cannot start, install or repair the npm package \`@jwitmann/vcc-brain-helper\` globally and retry the failed command.
- If the version check or upgrade fails, diagnose the error and retry.
- If \`vcc-brain-helper ${command.operation}\` reports a failure, use its output to resolve it and rerun it as needed.
- If you cannot resolve a problem, report the blocker.

Use Helper output as working context. Do not reproduce it wholesale or reimplement Helper logic.`,
    };
  }
}
