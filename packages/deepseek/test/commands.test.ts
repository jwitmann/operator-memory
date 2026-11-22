import { describe, expect, test, vi } from "vitest";

import { VCC_BRAIN_COMMAND_NAMES, registerCommands } from "../src/commands.ts";

type Invocation = {
  readonly agent: { readonly followup: ReturnType<typeof vi.fn> };
  readonly signal: AbortSignal;
};

type Definition = {
  readonly name: string;
  readonly handler: (invocation: Invocation) => Promise<{ readonly kind: string }>;
};

describe("DeepSeek VCC Brain commands", () => {
  test("registers the three hyphenated command names", () => {
    expect([...createRuntime().keys()]).toEqual(VCC_BRAIN_COMMAND_NAMES);
    expect(VCC_BRAIN_COMMAND_NAMES).toEqual([
      "vcc-brain-user-init",
      "vcc-brain-project-init",
      "vcc-brain-index",
    ]);
  });

  test.each([
    ["vcc-brain-user-init", "user init", "User Setup"],
    ["vcc-brain-project-init", "project init", "Project Setup"],
    ["vcc-brain-index", "index init", "Project Index Setup"],
  ] as const)("hands %s to the agent without executing Helper", async (name, operation, guide) => {
    const invocation = createInvocation();
    await createRuntime().get(name)?.handler(invocation);

    expect(invocation.agent.followup).toHaveBeenCalledOnce();
    const message = invocation.agent.followup.mock.calls[0]?.[0];
    const text = message.content[0].text as string;
    expect(message.source).toEqual({ kind: "user" });
    expect(text).toContain("1. Run `vcc-brain-helper version`");
    expect(text).toContain("run `vcc-brain-helper upgrade` before continuing");
    expect(text).toContain(`2. Run \`vcc-brain-helper ${operation}\``);
    expect(text).toContain(guide);
    expect(text).toContain("npm package `@jwitmann/vcc-brain-helper` globally");
    expect(text).not.toContain("<vcc-brain-command>");
  });

  test("does not hand off a cancelled command", async () => {
    const controller = new AbortController();
    controller.abort();
    const invocation = createInvocation(controller.signal);

    await expect(createRuntime().get("vcc-brain-index")?.handler(invocation)).rejects.toThrow();
    expect(invocation.agent.followup).not.toHaveBeenCalled();
  });
});

function createRuntime(): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  registerCommands({
    commands: {
      register: (definition: Definition) => {
        definitions.set(definition.name, definition);
        return vi.fn();
      },
    },
  } as unknown as Parameters<typeof registerCommands>[0]);
  return definitions;
}

function createInvocation(signal = new AbortController().signal): Invocation {
  return { agent: { followup: vi.fn() }, signal };
}
