import { describe, expect, test } from "vitest";

import { shapeCompactionRequest } from "../src/shaping.ts";

const deps = {
  enabled: true,
  brainPaths: ["~/.operator/user", ".operator", ".operator-shared"] as readonly string[],
  isBrainAvailable: () => true,
};

function compactionOptions(text = "base instruction"): Record<string, unknown> {
  return {
    purpose: "compaction",
    sessionId: "session-test",
    messages: [{ role: "user", content: [{ type: "text", text }] }],
  };
}

describe("compaction shaping", () => {
  test("appends guidance as its own trailing message, leaving the host instruction intact", () => {
    const options = compactionOptions();
    const shaped = shapeCompactionRequest(options, deps);
    expect(shaped).toBe(true);
    const messages = options.messages as Record<string, unknown>[];
    expect(messages).toHaveLength(2);
    // Host instruction byte-identical: one directive per message.
    expect(messages[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "base instruction" }],
    });
    const guidance = (messages[1] as Record<string, unknown>).content as Record<string, unknown>[];
    expect(guidance).toHaveLength(1);
    expect(guidance[0]?.text).toContain("<compaction-instructions>");
    expect(guidance[0]?.text).toContain(".operator-shared");
  });

  test("shaped guidance names DSH recovery tools, never the omission store", () => {
    const options = compactionOptions();
    expect(shapeCompactionRequest(options, deps)).toBe(true);
    const messages = options.messages as Record<string, unknown>[];
    const guidance = (messages[1] as Record<string, unknown>).content as Record<string, unknown>[];
    const text = guidance[0]?.text as string;
    expect(text).toContain("vcc-brain-recall");
    expect(text).toContain("vcc-brain-search");
    expect(text).not.toContain("vcc-brain-read_omitted");
    expect(text).not.toContain("omitted-001");
  });

  test("works when the trailing element is frozen (array stays mutable)", () => {
    const options = compactionOptions();
    const messages = options.messages as object[];
    Object.freeze(messages[0]);
    expect(shapeCompactionRequest(options, deps)).toBe(true);
    expect(messages).toHaveLength(2);
  });

  test("ignores non-compaction purposes and unavailable brains", () => {
    const other = { purpose: "chat", messages: [] };
    expect(shapeCompactionRequest(other, deps)).toBe(false);
    expect(other.messages).toEqual([]);

    const gated = compactionOptions();
    expect(
      shapeCompactionRequest(gated, {
        ...deps,
        isBrainAvailable: () => false,
      }),
    ).toBe(false);
    expect(gated.messages as Record<string, unknown>[]).toHaveLength(1);
  });

  test("fails closed without a session identity and never throws on frozen structures", () => {
    const noSession = { purpose: "compaction", messages: [] };
    expect(shapeCompactionRequest(noSession, deps)).toBe(false);

    const frozen = compactionOptions();
    Object.freeze(frozen.messages);
    expect(shapeCompactionRequest(frozen, deps)).toBe(false);
  });

  test("disabled shaping never mutates", () => {
    const options = compactionOptions();
    expect(shapeCompactionRequest(options, { ...deps, enabled: false } as never)).toBe(false);
  });
});
