import type { Config } from "@opencode-ai/plugin";
import { expect, test } from "vitest";

import { OPERATOR_COMMAND_NAMES, registerCommands } from "../src/commands.ts";

test("registers commands without replacing user definitions", () => {
  const config = {
    command: { "vcc-brain:index": { description: "Custom", template: "Custom index" } },
  } as Config;
  registerCommands(config);

  expect(config.command?.["vcc-brain:index"]?.template).toBe("Custom index");
  expect(Object.keys(config.command ?? {}).sort()).toEqual([...OPERATOR_COMMAND_NAMES].sort());
});

test.each([
  ["vcc-brain:user-init", "user init", "User Setup"],
  ["vcc-brain:project-init", "project init", "Project Setup"],
  ["vcc-brain:index", "index init", "Project Index Setup"],
  ["vcc-brain:repair", "memory check", "reported load failures"],
] as const)("hands %s to the agent without running Helper", (name, operation, guide) => {
  const config = {} as Config;
  registerCommands(config);
  const template = config.command?.[name]?.template ?? "";

  expect(template).toContain("1. Run `vcc-brain-helper version`");
  expect(template).toContain("run `vcc-brain-helper upgrade` before continuing");
  expect(template).toContain(`2. Run \`vcc-brain-helper ${operation}\``);
  expect(template).toContain(guide);
  expect(template).toContain("npm package `@jwitmann/vcc-brain-helper` globally");
  expect(template).not.toContain("!`");
  expect(template).not.toContain("<vcc-brain-command>");
});
