import { storeOmission } from "@jwitmann/vcc-brain-core/context/store";
import { vol } from "memfs";
import { execFile } from "node:child_process";
import { beforeEach, expect, test, vi } from "vitest";

import { writeCompactionSnapshot } from "../src/compaction-snapshot.ts";
import {
  registerPruneTool,
  registerReadOmittedTool,
  registerRecallSessionTool,
  registerRecallTool,
  registerSearchSessionsTool,
  registerSearchTool,
} from "../src/tool.ts";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

const execFileMock = vi.mocked(execFile);

vi.mock("node:fs/promises", async () => {
  const { fs: memoryFileSystem } = await import("memfs");
  return {
    access: memoryFileSystem.promises.access,
    appendFile: memoryFileSystem.promises.appendFile,
    mkdir: memoryFileSystem.promises.mkdir,
    readFile: memoryFileSystem.promises.readFile,
    readdir: memoryFileSystem.promises.readdir,
    rename: memoryFileSystem.promises.rename,
    stat: memoryFileSystem.promises.stat,
    unlink: memoryFileSystem.promises.unlink,
    writeFile: memoryFileSystem.promises.writeFile,
  };
});

const SESSION = "ses_test";
const STATE = "/home/.vcc-brain/state";

type AddedTool = {
  name: string;
  description: string;
  input: unknown;
  options?: { codemode?: boolean };
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
  execFileMock.mockReset();
});

test("registers under a flat hyphenated name", async () => {
  const { editor, tool } = await addedTool();

  expect(editor.namespace).not.toHaveBeenCalled();
  expect(tool.name).toBe("vcc-brain-read_omitted");
  expect(tool.options).toEqual({ codemode: false });
  expect(tool.description).toContain("omitted by VCC Brain trimming or compaction");
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

test("registers prune under a flat hyphenated name", async () => {
  const { editor, tool } = await addedPruneTool();

  expect(editor.namespace).not.toHaveBeenCalled();
  expect(tool.name).toBe("vcc-brain-prune");
  expect(tool.options).toEqual({ codemode: false });
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

const SNAPSHOT_MESSAGES = [
  { id: "m1", role: "user", content: [{ type: "text", text: "please fix the login bug" }] },
  {
    id: "m2",
    role: "assistant",
    content: [{ type: "tool-call", id: "t1", name: "read", input: { file_path: "auth.js" } }],
  },
  {
    id: "m3",
    role: "tool",
    content: [
      {
        type: "tool-result",
        id: "t1",
        name: "read",
        result: { type: "text", value: "file contents line one" },
      },
    ],
  },
];

async function addedRecallTool() {
  const editor = { namespace: vi.fn(), add: vi.fn() };
  const context = {
    tool: { transform: vi.fn(async (callback: (editor: unknown) => void) => callback(editor)) },
  } as never;
  await registerRecallTool(context, { stateDirectory: STATE });
  return { editor, tool: editor.add.mock.calls[0]?.[0] as AddedTool };
}

async function addedSearchTool() {
  const editor = { namespace: vi.fn(), add: vi.fn() };
  const context = {
    tool: { transform: vi.fn(async (callback: (editor: unknown) => void) => callback(editor)) },
  } as never;
  await registerSearchTool(context, { stateDirectory: STATE });
  return { editor, tool: editor.add.mock.calls[0]?.[0] as AddedTool };
}

async function seedSnapshot(): Promise<void> {
  const written = await writeCompactionSnapshot(
    `${STATE}/context-snapshot`,
    SESSION,
    SNAPSHOT_MESSAGES,
    "2026-11-20T00:00:00Z",
  );
  expect(written.ok).toBe(true);
}

test("recall restores snapshot content by seq selection", async () => {
  await seedSnapshot();
  const { tool } = await addedRecallTool();

  const result = await tool.execute({ type: "seq", id: "1-2" }, { sessionID: SESSION });

  expect(result.content).toContain("**vcc-brain-recall seq 1-2**");
  expect(result.content).toContain("please fix the login bug");
  expect(result.content).toContain("[tool-call read]");
});

test("recall resolves result and checkpoint references", async () => {
  await seedSnapshot();
  const { tool } = await addedRecallTool();

  const resultRef = await tool.execute({ type: "result", id: "result 3" }, { sessionID: SESSION });
  expect(resultRef.content).toContain("file contents line one");

  const missing = await tool.execute({ type: "result", id: "result 99" }, { sessionID: SESSION });
  expect(missing.content).toContain("not found in this session");
});

test("recall registers under a flat hyphenated name", async () => {
  const { editor, tool } = await addedRecallTool();

  expect(editor.namespace).not.toHaveBeenCalled();
  expect(tool.name).toBe("vcc-brain-recall");
  expect(tool.options).toEqual({ codemode: false });
});

test("search registers under a flat hyphenated name", async () => {
  const { editor, tool } = await addedSearchTool();

  expect(editor.namespace).not.toHaveBeenCalled();
  expect(tool.name).toBe("vcc-brain-search");
  expect(tool.options).toEqual({ codemode: false });
});

test("recall validates input and reports a missing snapshot", async () => {
  const { tool } = await addedRecallTool();

  expect((await tool.execute({}, { sessionID: SESSION })).content).toBe(
    "Missing or invalid input: type must be one of seq, result, checkpoint.",
  );
  expect((await tool.execute({ type: "seq", id: " " }, { sessionID: SESSION })).content).toBe(
    "Missing required input: id.",
  );
  expect((await tool.execute({ type: "seq", id: "1" }, { sessionID: SESSION })).content).toBe(
    "No compaction snapshot yet for this session. Recall is available after the first compaction.",
  );

  const unsafe = await tool.execute({ type: "seq", id: "1" }, { sessionID: "../evil" });
  expect(unsafe.content).toBe("Could not read compaction snapshot for this session.");
});

test("search finds snapshot content with recall pointers", async () => {
  await seedSnapshot();
  const { tool } = await addedSearchTool();

  const result = await tool.execute({ pattern: "login" }, { sessionID: SESSION });

  expect(result.content).toContain("**vcc-brain-search login**");
  expect(result.content).toContain("[seq 1");
  expect(result.content).toContain("use recall");
});

test("search validates input and reports a missing snapshot", async () => {
  const { tool } = await addedSearchTool();

  expect((await tool.execute({}, { sessionID: SESSION })).content).toBe(
    "Missing required input: pattern.",
  );
  expect((await tool.execute({ pattern: "  " }, { sessionID: SESSION })).content).toBe(
    "Missing required input: pattern.",
  );
  expect((await tool.execute({ pattern: "login" }, { sessionID: SESSION })).content).toBe(
    "No compaction snapshot yet for this session. Search is available after the first compaction.",
  );

  const unsafe = await tool.execute({ pattern: "login" }, { sessionID: "../evil" });
  expect(unsafe.content).toBe("Could not read compaction snapshot for this session.");
});

async function addedSearchSessionsTool() {
  const editor = { namespace: vi.fn(), add: vi.fn() };
  const context = {
    tool: { transform: vi.fn(async (callback: (editor: unknown) => void) => callback(editor)) },
  } as never;
  await registerSearchSessionsTool(context, { projectDirectory: "/proj" });
  return { editor, tool: editor.add.mock.calls[0]?.[0] as AddedTool };
}

async function addedRecallSessionTool() {
  const editor = { namespace: vi.fn(), add: vi.fn() };
  const context = {
    tool: { transform: vi.fn(async (callback: (editor: unknown) => void) => callback(editor)) },
  } as never;
  await registerRecallSessionTool(context);
  return { editor, tool: editor.add.mock.calls[0]?.[0] as AddedTool };
}

function succeedStdout(stdout: string) {
  execFileMock.mockImplementation((_bin, _args, _options, callback) => {
    (callback as (error: null, stdout: string, stderr: string) => void)(null, stdout, "");
    return undefined as never;
  });
}

test("search-sessions registers flat and shells the helper with --project", async () => {
  const { editor, tool } = await addedSearchSessionsTool();

  expect(editor.namespace).not.toHaveBeenCalled();
  expect(tool.name).toBe("vcc-brain-search-sessions");
  expect(tool.options).toEqual({ codemode: false });

  succeedStdout("hits");
  const result = await tool.execute({ keywords: "deploy blue-green" }, { sessionID: SESSION });

  expect(result.content).toBe("hits");
  expect(execFileMock).toHaveBeenCalledOnce();
  const [bin, args] = execFileMock.mock.calls[0] as [string, string[]];
  expect(bin).toBe("vcc-brain-helper");
  expect(args).toEqual(["recall-cross", "query", "--project", "/proj", "deploy", "blue-green"]);
});

test("search-sessions validates keywords, harness, and dash words", async () => {
  const { tool } = await addedSearchSessionsTool();

  expect((await tool.execute({}, { sessionID: SESSION })).content).toBe(
    "Missing required input: keywords.",
  );
  expect((await tool.execute({ keywords: "  " }, { sessionID: SESSION })).content).toBe(
    "Missing required input: keywords.",
  );
  expect((await tool.execute({ keywords: "--top" }, { sessionID: SESSION })).content).toBe(
    "Invalid input: keywords must not start with '-'.",
  );
  expect(
    (await tool.execute({ keywords: "x", harness: "slack" }, { sessionID: SESSION })).content,
  ).toBe("Invalid input: harness must be one of dsh, opencode, all.");
  expect(execFileMock).not.toHaveBeenCalled();
});

test("search-sessions passes a valid harness through", async () => {
  const { tool } = await addedSearchSessionsTool();
  succeedStdout("opencode hits");

  const result = await tool.execute(
    { keywords: "atlas", harness: "opencode" },
    { sessionID: SESSION },
  );

  expect(result.content).toBe("opencode hits");
  const [, args] = execFileMock.mock.calls[0] as [string, string[]];
  expect(args).toEqual([
    "recall-cross",
    "query",
    "--project",
    "/proj",
    "--harness",
    "opencode",
    "atlas",
  ]);
});

test("search-sessions degrades when the helper is missing", async () => {
  const { tool } = await addedSearchSessionsTool();
  execFileMock.mockImplementation(() => {
    throw new Error("spawn ENOENT");
  });

  const result = await tool.execute({ keywords: "atlas" }, { sessionID: SESSION });

  expect(result.content).toBe("Could not run the recall index. Is vcc-brain-helper installed?");
});

test("recall-session registers flat and shells the helper by id", async () => {
  const { tool } = await addedRecallSessionTool();

  expect(tool.name).toBe("vcc-brain-recall-session");
  succeedStdout("turns");
  const result = await tool.execute({ sessionId: "opencode:ses_abc" }, { sessionID: SESSION });

  expect(result.content).toBe("turns");
  const [, args] = execFileMock.mock.calls[0] as [string, string[]];
  expect(args).toEqual(["recall-cross", "recall", "opencode:ses_abc"]);
});

test("recall-session validates id and seq", async () => {
  const { tool } = await addedRecallSessionTool();

  expect((await tool.execute({}, { sessionID: SESSION })).content).toBe(
    "Missing required input: sessionId.",
  );
  expect((await tool.execute({ sessionId: "--seq" }, { sessionID: SESSION })).content).toBe(
    "Invalid input: sessionId must not start with '-'.",
  );
  expect(
    (await tool.execute({ sessionId: "opencode:ses_abc", seq: "x" }, { sessionID: SESSION }))
      .content,
  ).toBe("Invalid input: seq must be a non-negative integer.");
  expect(execFileMock).not.toHaveBeenCalled();

  succeedStdout("one turn");
  const result = await tool.execute(
    { sessionId: "opencode:ses_abc", seq: "2" },
    { sessionID: SESSION },
  );
  expect(result.content).toBe("one turn");
  const [, args] = execFileMock.mock.calls[0] as [string, string[]];
  expect(args).toEqual(["recall-cross", "recall", "opencode:ses_abc", "--seq", "2"]);
});
