import type { Context } from "@opencode/plugin/promise/plugin";
import { fs, vol } from "memfs";
import { homedir } from "node:os";
import { beforeEach, expect, test, vi } from "vitest";

const { emitToast, loadMemorySnapshot, loadPreamble } = vi.hoisted(() => ({
  emitToast: vi.fn(() => Promise.resolve()),
  loadMemorySnapshot: vi.fn(() =>
    Promise.resolve({
      user: { ok: true as const, value: { exists: true } },
      private: { ok: true as const, value: { exists: false } },
      shared: { ok: true as const, value: { exists: true } },
    }),
  ),
  loadPreamble: vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      value: { content: "operator preamble", loaded: true, initialized: true },
    }),
  ),
}));

vi.mock("@aerovato/operator-core/memory/load", () => ({ loadMemorySnapshot }));
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
    writeFile: memoryFileSystem.promises.writeFile,
  };
});

import OperatorPlugin from "../src/index.ts";
import type { RequestMessage } from "@aerovato/operator-core/context/tokens";

beforeEach(() => {
  vol.reset();
});

const PROJECT = "/project";
const HOME = homedir();

function seedBrain(): void {
  for (const root of [
    `${PROJECT}/.operator`,
    `${PROJECT}/.operator-shared`,
    `${HOME}/.operator/user`,
  ]) {
    fs.mkdirSync(`${root}/index`, { recursive: true });
    fs.writeFileSync(`${root}/operator.md`, `# ops ${root}`);
    fs.writeFileSync(`${root}/catalog.md`, `# catalog ${root}`);
    if (!root.endsWith("user")) {
      fs.writeFileSync(`${root}/index/index.md`, `# index ${root}`);
    }
  }
}

const SESSION = `ses_brain_updates_index_${Date.now()}`;

function completedMessages(count: number): RequestMessage[] {
  const calls: unknown[] = [];
  const results: unknown[] = [];
  for (let index = 0; index < count; index++) {
    const id = `toolu_index_${index}`;
    calls.push({ type: "tool-call", id, name: "read", input: { filePath: `/${id}` } });
    results.push({
      type: "tool-result",
      id,
      name: "read",
      result: { type: "text", value: id },
    });
  }
  return [
    { role: "assistant", content: calls },
    { role: "tool", content: results },
  ];
}

test("wires the enabled Brain-update threshold through the preamble hook", async () => {
  seedBrain();
  const sessionHook = vi.fn();
  const context = {
    location: { directory: PROJECT },
    options: { operator: { brainUpdates: { enabled: true, toolCallThreshold: 25 } } },
    command: {
      list: () => Promise.resolve({ data: [], location: { directory: PROJECT } }),
      transform: vi.fn(),
    },
    rpc: { register: vi.fn(() => Promise.resolve({ events: { emit: emitToast } })) },
    session: { hook: sessionHook },
  } as unknown as Context;

  await OperatorPlugin.setup(context);
  const hook = sessionHook.mock.calls[0]?.[1] as (event: {
    sessionID: string;
    system: { type: string; text: string }[];
    messages: unknown[];
  }) => Promise<void>;

  const seeded = {
    sessionID: SESSION,
    system: [],
    messages: completedMessages(0),
  };
  await hook(seeded);
  expect(seeded.system).toEqual([{ type: "text", text: "operator preamble" }]);

  const reminded = {
    sessionID: SESSION,
    system: [],
    messages: completedMessages(25),
  };
  await hook(reminded);
  expect(reminded.system[0]?.text).toContain("<operator-brain-update-reminder>");
});
