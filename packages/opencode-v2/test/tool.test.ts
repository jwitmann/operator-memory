import { storeOmission } from "@aerovato/operator-core/context/store";
import { vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";

import { registerPruneTool, registerReadOmittedTool } from "../src/tool.ts";

vi.mock("node:fs/promises", async () => {
  const { fs: memoryFileSystem } = await import("memfs");
  return {
    access: memoryFileSystem.promises.access,
    appendFile: memoryFileSystem.promises.appendFile,
    mkdir: memoryFileSystem.promises.mkdir,
    readFile: memoryFileSystem.promises.readFile,
    readdir: memoryFileSystem.promises.readdir,
    stat: memoryFileSystem.promises.stat,
    unlink: memoryFileSystem.promises.unlink,
    writeFile: memoryFileSystem.promises.writeFile,
  };
});

const SESSION = "ses_test";
const STATE = "/home/.operator/state";

type AddedTool = {
  name: string;
  description: string;
  input: unknown;
  execute: (input: unknown, context: { sessionID: string }) => Promise<{ content: string }>;
};

async function addedTool() {
  const editor = { namespace: vi.fn(), add: vi.fn() };
  const context = {
    tool: { transform: vi.fn(async (callback: (editor: unknown) => void) => callback(editor)) },
  } as never;
  await registerReadOmittedTool(context, { stateDirectory: STATE });
  return { editor, tool: editor.add.mock.calls[0]?.[0] as AddedTool };
}

beforeEach(() => {
  vol.reset();
});

test("registers under the operator namespace", async () => {
  const { editor, tool } = await addedTool();

  expect(editor.namespace).toHaveBeenCalledWith({
    name: "operator",
    description: "Operator Memory context management tools.",
  });
  expect(tool.name).toBe("read_omitted");
  expect(tool.description).toContain("omitted by Operator trimming or compaction");
});

test("retrieves a stored payload by content ID", async () => {
  const stored = await storeOmission(
    `${STATE}/omitted`,
    SESSION,
    "toolu_1:output",
    "original body",
  );
  expect(stored.ok && stored.value).toBe("omitted-001");
  const { tool } = await addedTool();

  const result = await tool.execute({ contentID: "omitted-001" }, { sessionID: SESSION });

  expect(result.content).toBe("original body");
});

test("reports unknown content IDs without failing", async () => {
  const { tool } = await addedTool();

  const result = await tool.execute({ contentID: "omitted-404" }, { sessionID: SESSION });

  expect(result.content).toBe("No omitted content found for Content ID: omitted-404");
});

test("rejects calls without a content ID", async () => {
  const { tool } = await addedTool();

  const missing = await tool.execute({}, { sessionID: SESSION });
  expect(missing.content).toBe("Missing required input: contentID.");

  const wrongType = await tool.execute({ contentID: 42 }, { sessionID: SESSION });
  expect(wrongType.content).toBe("Missing required input: contentID.");
});

test("rejects IDs outside the omission shape", async () => {
  const { tool } = await addedTool();

  const result = await tool.execute({ contentID: "index.jsonl" }, { sessionID: SESSION });

  expect(result.content).toBe("Invalid content ID: index.jsonl.");
});

async function addedPruneTool() {
  const editor = { namespace: vi.fn(), add: vi.fn() };
  const context = {
    tool: { transform: vi.fn(async (callback: (editor: unknown) => void) => callback(editor)) },
  } as never;
  await registerPruneTool(context, { stateDirectory: STATE });
  return { editor, tool: editor.add.mock.calls[0]?.[0] as AddedTool };
}

test("registers prune under the operator namespace", async () => {
  const { editor, tool } = await addedPruneTool();

  expect(editor.namespace).toHaveBeenCalledWith({
    name: "operator",
    description: "Operator Memory context management tools.",
  });
  expect(tool.name).toBe("prune");
  expect(tool.description).toContain("Prune the current session's omitted");
});

test("prunes the oldest payloads down to the requested cap", async () => {
  await storeOmission(`${STATE}/omitted`, SESSION, "toolu_1:output", "aaaa");
  await storeOmission(`${STATE}/omitted`, SESSION, "toolu_2:output", "bb");
  await storeOmission(`${STATE}/omitted`, SESSION, "toolu_3:output", "c");
  const { tool } = await addedPruneTool();

  const result = await tool.execute({ maxPayloads: 1 }, { sessionID: SESSION });

  expect(result.content).toBe("Pruned 2 payload(s), freed 6 byte(s), 1 remaining.");
  const pruned = await tool.execute({ contentID: "omitted-001" }, { sessionID: SESSION });
  expect(pruned.content).toBe("Pruned 0 payload(s), freed 0 byte(s), 1 remaining.");
});

test("prune falls back to defaults on invalid inputs", async () => {
  await storeOmission(`${STATE}/omitted`, SESSION, "toolu_1:output", "a");
  const { tool } = await addedPruneTool();

  const result = await tool.execute(
    { maxAgeDays: -1, maxPayloads: "many", maxBytes: Number.NaN },
    { sessionID: SESSION },
  );

  expect(result.content).toBe("Pruned 0 payload(s), freed 0 byte(s), 1 remaining.");
});
