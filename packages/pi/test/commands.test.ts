import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import { VCC_BRAIN_COMMAND_NAMES, registerCommands } from "../src/commands.ts";

type CommandHandler = (
  arguments_: string,
  context: { readonly waitForIdle: () => Promise<void> },
) => Promise<void>;

test.each([
  ["vcc-brain:user-init", "user init", "User Setup"],
  ["vcc-brain:project-init", "project init", "Project Setup"],
  ["vcc-brain:index", "index init", "Project Index Setup"],
] as const)("hands %s to the agent without executing Helper", async (name, operation, guide) => {
  const commands = new Map<string, CommandHandler>();
  const sendUserMessage = vi.fn();
  registerCommands({
    registerCommand: (id: string, definition: { readonly handler: CommandHandler }) =>
      commands.set(id, definition.handler),
    sendUserMessage,
  } as unknown as ExtensionAPI);
  const waitForIdle = vi.fn().mockResolvedValue(undefined);

  await commands.get(name)?.("", { waitForIdle });

  expect(waitForIdle).toHaveBeenCalledOnce();
  expect(sendUserMessage).toHaveBeenCalledWith(expect.any(String), {
    expandPromptTemplates: false,
  });
  const text = sendUserMessage.mock.calls[0]?.[0] as string;
  expect(text).toContain("1. Run `vcc-brain-helper version`");
  expect(text).toContain("run `vcc-brain-helper upgrade` before continuing");
  expect(text).toContain(`2. Run \`vcc-brain-helper ${operation}\``);
  expect(text).toContain(guide);
  expect(text).toContain("npm package `@jwitmann/vcc-brain-helper` globally");
  expect(text).not.toContain("<vcc-brain-command>");
});

test("registers exact names and leaves duplicate renaming to Pi", () => {
  const registered = new Set<string>(["vcc-brain:index"]);
  const names: string[] = [];
  const pi = {
    registerCommand: (name: string) => {
      const registeredName = registered.has(name) ? `${name}:1` : name;
      registered.add(registeredName);
      names.push(registeredName);
    },
  } as unknown as ExtensionAPI;
  registerCommands(pi);

  expect(names).toEqual(["vcc-brain:user-init", "vcc-brain:project-init", "vcc-brain:index:1"]);
  expect(VCC_BRAIN_COMMAND_NAMES).toHaveLength(3);
});
