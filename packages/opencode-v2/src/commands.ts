import type { Context } from "@opencode/plugin/promise/plugin";

export const VCC_BRAIN_COMMAND_NAMES = [
  "vcc-brain:user-init",
  "vcc-brain:project-init",
  "vcc-brain:index",
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
} as const;

export async function registerCommands(context: Context): Promise<void> {
  const existing = new Set((await context.command.list()).data.map(command => command.name));
  await context.command.transform(draft => {
    for (const name of VCC_BRAIN_COMMAND_NAMES) {
      if (existing.has(name)) continue;
      const command = commands[name];
      draft.add({
        name,
        description: command.description,
        execute: async input => {
          await context.session.prompt({
            ...input.prompt,
            sessionID: input.sessionID,
            text: `# ${command.description}

1. Run \`vcc-brain-helper version\`. If an update is available, run \`vcc-brain-helper upgrade\` before continuing.
2. Run \`vcc-brain-helper ${command.operation}\`. ${command.guide}

## Recovery

- If Helper cannot start, install or repair the npm package \`@jwitmann/vcc-brain-helper\` globally and retry the failed command.
- If the version check or upgrade fails, diagnose the error and retry.
- If \`vcc-brain-helper ${command.operation}\` reports a failure, use its output to resolve it and rerun it as needed.
- If you cannot resolve a problem, report the blocker.

Use Helper output as working context. Do not reproduce it wholesale or reimplement Helper logic.`,
            delivery: input.delivery,
          });
        },
      });
    }
  });
}
