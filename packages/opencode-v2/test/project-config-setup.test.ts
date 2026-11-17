import type { Context } from "@opencode/plugin/promise/plugin";
import { fs, vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";

import type { RequestMessage } from "@aerovato/operator-core/context/tokens";

const { emitToast, loadPreamble } = vi.hoisted(() => ({
  emitToast: vi.fn(() => Promise.resolve()),
  loadPreamble: vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      value: { content: "operator preamble", loaded: true, initialized: true },
    }),
  ),
}));

vi.mock("@aerovato/operator-core/memory/load", () => ({
  loadMemorySnapshot: vi.fn(),
}));
vi.mock("../src/preamble.ts", () => ({ loadPreamble }));
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

import OperatorPlugin from "../src/index.ts";

const PROJECT = "/project";

function completedMessages(count: number): RequestMessage[] {
  const calls: unknown[] = [];
  const results: unknown[] = [];
  for (let index = 0; index < count; index++) {
    const id = `toolu_${index}`;
    calls.push({ type: "tool-call", id, name: "read", input: { filePath: `/${id}` } });
    results.push({ type: "tool-result", id, name: "read", result: { type: "text", value: id } });
  }
  return [
    { role: "assistant", content: calls },
    { role: "tool", content: results },
  ];
}

function setupContext(options: unknown) {
  const sessionHook = vi.fn();
  const context = {
    location: { directory: PROJECT },
    options,
    command: {
      list: () => Promise.resolve({ data: [], location: { directory: PROJECT } }),
      transform: vi.fn(async callback => callback({ add: vi.fn() })),
    },
    rpc: {
      register: vi.fn(() => Promise.resolve({ events: { emit: emitToast } })),
    },
    session: { hook: sessionHook },
  } as unknown as Context;
  return { context, sessionHook };
}

beforeEach(() => {
  vol.reset();
  vi.clearAllMocks();
});

test("project file disable wins over opencode.json through setup", async () => {
  fs.mkdirSync(`${PROJECT}/.operator`, { recursive: true });
  fs.writeFileSync(
    `${PROJECT}/.operator/config.json`,
    JSON.stringify({ brainUpdates: { enabled: false } }),
  );
  const { context, sessionHook } = setupContext({
    operator: { brainUpdates: { enabled: true, toolCallThreshold: 25 } },
  });
  await OperatorPlugin.setup(context);

  expect(sessionHook).toHaveBeenCalledWith("context", expect.any(Function));
  const hook = sessionHook.mock.calls[0]?.[1];
  // First fire seeds the fingerprint baseline with no completed work, the
  // second brings 25 fresh calls — which would cross the threshold and
  // remind if the project disable did not win.
  const seeding = { sessionID: "session-a", system: [], messages: completedMessages(0) };
  await hook(seeding);
  expect(seeding.system).toEqual([{ type: "text", text: "operator preamble" }]);
  const crossing = { sessionID: "session-a", system: [], messages: completedMessages(25) };
  await hook(crossing);
  expect(crossing.system).toEqual([{ type: "text", text: "operator preamble" }]);
});

test("opencode.json enable reminds without a project file (control)", async () => {
  const { context, sessionHook } = setupContext({
    operator: { brainUpdates: { enabled: true, toolCallThreshold: 25 } },
  });
  await OperatorPlugin.setup(context);

  const hook = sessionHook.mock.calls[0]?.[1];
  const first = { sessionID: "session-b", system: [], messages: completedMessages(0) };
  await hook(first);
  expect(first.system).toEqual([{ type: "text", text: "operator preamble" }]);
  const second = { sessionID: "session-b", system: [], messages: completedMessages(25) };
  await hook(second);
  expect(second.system[0]?.text).toContain("operator-brain-update-reminder");
});

test("invalid project JSON toasts and falls back to opencode.json", async () => {
  fs.mkdirSync(`${PROJECT}/.operator`, { recursive: true });
  fs.writeFileSync(`${PROJECT}/.operator/config.json`, "{not json");
  const { context } = setupContext({
    operator: { brainUpdates: { enabled: true, toolCallThreshold: 25 } },
  });
  await OperatorPlugin.setup(context);

  expect(emitToast).toHaveBeenCalledWith(
    "toast",
    expect.objectContaining({ message: expect.stringContaining(".operator/config.json") }),
  );
});
