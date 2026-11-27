import { COMPILER_REV } from "@jwitmann/vcc-brain-core/context/compiler";
import { expect, test } from "vitest";

import {
  compileCompaction,
  DEFAULT_VCC_KEEP_MESSAGES,
  pickKeepID,
  projectResultValue,
  resolveVccCompilerConfig,
  toCompilerNode,
} from "../src/compaction-compiler.ts";

function textMessage(id: string, text: string) {
  return { id, role: "user", content: [{ type: "text", text }] };
}

test("projects assistant text and tool calls into nodes", () => {
  const node = toCompilerNode(
    {
      id: "m1",
      role: "assistant",
      content: [
        { type: "text", text: "working on it" },
        {
          type: "tool-call",
          id: "c1",
          name: "read",
          arguments: JSON.stringify({ file_path: "a.ts", other: 1 }),
        },
      ],
    },
    1,
  );
  expect(node?.seq).toBe(1);
  expect(node?.message?.role).toBe("assistant");
  const blocks = node?.message?.content ?? [];
  expect(blocks[0]).toMatchObject({ type: "text" });
  expect(blocks[1]).toMatchObject({ type: "tool-call", name: "read" });
});

test("drops compaction and effort control blocks", () => {
  const node = toCompilerNode(
    {
      id: "m1",
      role: "assistant",
      content: [
        { type: "compaction", text: "old" },
        { type: "effort", text: "x" },
      ],
    },
    2,
  );
  expect(node?.message?.content).toEqual([]);
});

test("links tool results to their call id", () => {
  const node = toCompilerNode(
    {
      id: "m3",
      role: "tool",
      toolCallId: "c1",
      content: [{ type: "tool-result", id: "c1", result: { type: "text", value: "ok" } }],
    },
    3,
  );
  expect(node?.message).toMatchObject({ role: "tool", toolCallId: "c1" });
});

test("re-enters a prior checkpoint as a checkpoint user message", () => {
  const node = toCompilerNode(
    {
      id: "m0",
      role: "assistant",
      content: [{ type: "compaction", text: "prior summary" }],
    },
    4,
  );
  expect(node?.message).toMatchObject({ role: "user", source: { kind: "compact-checkpoint" } });
});

test("skips system messages, nulls, and id-less shapes", () => {
  expect(toCompilerNode({ role: "system", content: [] }, 1)).toBeNull();
  expect(toCompilerNode(null, 1)).toBeNull();
  expect(toCompilerNode({ role: "user" }, 1)).toBeNull();
});

test("projects tool-result values to text", () => {
  expect(projectResultValue({ type: "text", value: "hi" })).toBe("hi");
  expect(projectResultValue({ type: "error", value: "boom" })).toBe("[error] boom");
  expect(projectResultValue({ type: "json", value: { a: 1 } })).toBe('{"a":1}');
  expect(projectResultValue(null)).toBe("");
});

test("picks the first id at or after the cut", () => {
  const messages = [{}, { id: "" }, { id: "keep-1" }, { id: "keep-2" }];
  expect(pickKeepID(messages, 2)).toBe("keep-1");
  expect(pickKeepID([{ role: "user" }], 6)).toBeUndefined();
  expect(pickKeepID([], 6)).toBeUndefined();
});

test("compiles a span with ids into an override", () => {
  const messages = Array.from({ length: 10 }, (_, index) =>
    textMessage(`m${index + 1}`, `older history ${index} `.repeat(60)),
  );
  const compiled = compileCompaction(
    messages,
    resolveVccCompilerConfig(),
    DEFAULT_VCC_KEEP_MESSAGES,
    20000,
  );
  expect(compiled !== undefined).toBe(true);
  // keepMessages 6 over 10 messages: the tail starts at m5.
  expect(compiled?.keepID).toBe("m5");
  expect(compiled?.summary).toContain(COMPILER_REV);
  expect(compiled?.summary).toContain("RECALL");
  expect(compiled !== undefined && compiled.summaryTokens < 20000).toBe(true);
});

test("abstains when no message id exists at or after the cut", () => {
  const messages = Array.from({ length: 10 }, (_, index) => ({
    role: "user",
    content: [{ type: "text", text: `older history ${index} `.repeat(60) }],
  }));
  expect(
    compileCompaction(messages, resolveVccCompilerConfig(), DEFAULT_VCC_KEEP_MESSAGES, 20000),
  ).toBeUndefined();
});

test("abstains when the framed checkpoint would not shrink the request", () => {
  const compiled = compileCompaction(
    [textMessage("m1", "hi")],
    resolveVccCompilerConfig(),
    DEFAULT_VCC_KEEP_MESSAGES,
    2,
  );
  expect(compiled).toBeUndefined();
});

test("resolves engine defaults with elision off", () => {
  const config = resolveVccCompilerConfig();
  expect(config.elideCheckpointInjectedBodies).toBe(false);
  expect(config.elideSourceKinds).toEqual([]);
  expect(config.framing.recallGuide).toContain("RECALL");
});

test("re-enters a tagged user-text checkpoint as a checkpoint user message", () => {
  const node = toCompilerNode(
    textMessage(
      "m9",
      "Continue the task directly from the messages that follow.\n\n<compacted-checkpoint>\n\nsummary body\n\n</compacted-checkpoint>",
    ),
    9,
  );
  expect(node?.message).toMatchObject({ role: "user", source: { kind: "compact-checkpoint" } });
});

test("does not mistake prose quoting one tag for a checkpoint", () => {
  const node = toCompilerNode(textMessage("m9", "what does <compacted-checkpoint> mean?"), 9);
  expect(node?.message).toMatchObject({ role: "user" });
  expect(node?.message).not.toMatchObject({ source: { kind: "compact-checkpoint" } });
});
