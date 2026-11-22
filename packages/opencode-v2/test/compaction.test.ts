import { readReceipts } from "@jwitmann/vcc-brain-core/context/receipts";
import { vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";

import type { ContextManagementConfig } from "../src/context-config.ts";
import { DEFAULT_BRAIN_PATHS, registerCompactionHook } from "../src/compaction.ts";
import { readCompactionSnapshot } from "../src/compaction-snapshot.ts";
import { createContextRuntime, sessionRuntime } from "../src/runtime.ts";

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

const CONFIG: ContextManagementConfig = {
  enabled: true,
  ratio: 0.8,
  hardCapTokens: 250000,
  keepRecentTurns: 3,
  compactOnComplete: true,
  compactFloorTokens: 32000,
};

function hookFake() {
  const sessionHook = vi.fn();
  const context = { session: { hook: sessionHook } };
  return { context: context as never, sessionHook };
}

function compactionEvent(messageCount: number): TestEvent {
  const messages = Array.from({ length: messageCount }, (_, index) => ({
    role: "assistant",
    content: [{ type: "text", text: `older history ${index}` }],
  }));
  return makeEvent(messages);
}

type TestMessage = {
  readonly id?: string;
  readonly role: string;
  readonly content: readonly unknown[];
  readonly toolCallId?: string;
};

function makeEvent(messages: readonly TestMessage[]): TestEvent {
  return {
    sessionID: SESSION,
    model: { id: "anthropic/claude-sonnet-4", providerID: "anthropic" },
    system: [{ type: "text", text: "summarize" }],
    messages: [...messages],
    options: {},
    tools: {},
    agent: "build",
    result: null,
  };
}

function largeIdEvent(): TestEvent {
  const messages: TestMessage[] = [];
  for (let index = 0; index < 10; index += 1) {
    messages.push({
      id: `a${index}`,
      role: "assistant",
      content: [
        {
          type: "tool-call",
          id: `c${index}`,
          name: "read",
          input: JSON.stringify({ file_path: "f.js" }),
        },
      ],
    });
    messages.push({
      id: `b${index}`,
      role: "tool",
      toolCallId: `c${index}`,
      content: [
        {
          type: "tool-result",
          id: `c${index}`,
          result: { type: "text", value: `output line ${index} `.repeat(500) },
        },
      ],
    });
  }
  messages.push({ id: "tail1", role: "user", content: [{ type: "text", text: "continue" }] });
  for (let index = 0; index < 5; index += 1) {
    messages.push({
      id: `t${index}`,
      role: "user",
      content: [{ type: "text", text: `tail ${index}` }],
    });
  }
  return makeEvent(messages);
}

type TestEvent = {
  sessionID: string;
  model: { id: string; providerID: string };
  system: { type: string; text: string }[];
  messages: TestMessage[];
  options: Record<string, never>;
  tools: Record<string, never>;
  agent: string;
  result: { summary: string; metadata?: { keepID?: string } } | null;
};

const DEPS = {
  config: CONFIG,
  stateDirectory: STATE,
  brainPaths: DEFAULT_BRAIN_PATHS,
  isBrainAvailable: () => true,
  reportReceiptFailure: () => undefined,
  refreshEnabled: false,
};

beforeEach(() => {
  vol.reset();
});

test("shapes the request and leaves messages intact", async () => {
  const { context, sessionHook } = hookFake();
  registerCompactionHook(context, DEPS, createContextRuntime());
  const hook = sessionHook.mock.calls[0]?.[1] as (event: TestEvent) => Promise<void>;

  const event = compactionEvent(3);
  await hook(event);

  // Brain-referencing instructions land on the system prompt; nothing is
  // removed or summarized by the hook itself.
  expect(event.system).toHaveLength(2);
  const instructions = event.system[1]?.text ?? "";
  expect(instructions).toContain("~/.vcc-brain/user");
  expect(instructions).toContain("vcc-brain-read_omitted");
  expect(event.messages).toHaveLength(3);
  expect(event.result).toBeNull();

  const receipts = await readReceipts(`${STATE}/context-log`, SESSION);
  expect(receipts.ok && receipts.value).toHaveLength(1);
  expect(receipts.ok ? receipts.value[0] : null).toMatchObject({
    kind: "compact",
    trigger: "manual",
    engine: "shaped",
  });
});

test("overrides with a compiled checkpoint and keepID when the span shrinks", async () => {
  const { context, sessionHook } = hookFake();
  registerCompactionHook(context, DEPS, createContextRuntime());
  const hook = sessionHook.mock.calls[0]?.[1] as (event: TestEvent) => Promise<void>;

  const event = largeIdEvent();
  await hook(event);

  // Deterministic override: verbatim summary plus tail pointer, no extra
  // system shaping.
  expect(event.result !== null).toBe(true);
  expect(event.result?.summary).toContain("RECALL");
  expect(event.result?.metadata?.keepID).toBe("tail1");
  expect(event.system).toHaveLength(1);
  expect(event.messages).toHaveLength(26);

  const receipts = await readReceipts(`${STATE}/context-log`, SESSION);
  expect(receipts.ok ? receipts.value[0] : null).toMatchObject({
    kind: "compact",
    trigger: "manual",
    engine: "vcc",
  });
  const summaryTokens =
    receipts.ok && receipts.value[0]?.kind === "compact" ? receipts.value[0].summaryTokens : null;
  expect(typeof summaryTokens).toBe("number");
});

test("falls back to shaping when no message id exists at or after the cut", async () => {
  const { context, sessionHook } = hookFake();
  registerCompactionHook(context, DEPS, createContextRuntime());
  const hook = sessionHook.mock.calls[0]?.[1] as (event: TestEvent) => Promise<void>;

  // Same bulk as the override span but without ids: no keepID, so abstain.
  const messages = Array.from({ length: 10 }, (_, index) => ({
    role: "user",
    content: [{ type: "text", text: `older history ${index} `.repeat(60) }],
  }));
  const event = makeEvent(messages);
  await hook(event);

  expect(event.result).toBeNull();
  expect(event.system).toHaveLength(2);
  const receipts = await readReceipts(`${STATE}/context-log`, SESSION);
  expect(receipts.ok ? receipts.value[0] : null).toMatchObject({
    kind: "compact",
    engine: "shaped",
    summaryTokens: null,
  });
});

test("falls back to shaping when the framed checkpoint would not shrink the request", async () => {
  const { context, sessionHook } = hookFake();
  registerCompactionHook(context, DEPS, createContextRuntime());
  const hook = sessionHook.mock.calls[0]?.[1] as (event: TestEvent) => Promise<void>;

  const event = makeEvent([{ id: "m1", role: "user", content: [{ type: "text", text: "hi" }] }]);
  await hook(event);

  expect(event.result).toBeNull();
  expect(event.system).toHaveLength(2);
  const receipts = await readReceipts(`${STATE}/context-log`, SESSION);
  expect(receipts.ok ? receipts.value[0] : null).toMatchObject({
    kind: "compact",
    engine: "shaped",
    summaryTokens: null,
  });
});

test("writes a compaction snapshot for recall on both paths", async () => {
  const { context, sessionHook } = hookFake();
  registerCompactionHook(context, DEPS, createContextRuntime());
  const hook = sessionHook.mock.calls[0]?.[1] as (event: TestEvent) => Promise<void>;

  await hook(largeIdEvent());
  const overrideSnap = await readCompactionSnapshot(`${STATE}/context-snapshot`, SESSION);
  expect(overrideSnap.ok && overrideSnap.value?.count).toBe(26);
  expect(overrideSnap.ok && overrideSnap.value?.lastID).toBe("t4");

  // A wiped state directory with a live in-memory guard is not a real host
  // state (hosts never wipe the directory mid-process), so the second leg
  // uses a fresh runtime like a new process would.
  vol.reset();
  registerCompactionHook(context, DEPS, createContextRuntime());
  const hook2 = sessionHook.mock.calls[1]?.[1] as (event: TestEvent) => Promise<void>;
  await hook2(compactionEvent(3));
  const shapedSnap = await readCompactionSnapshot(`${STATE}/context-snapshot`, SESSION);
  expect(shapedSnap.ok && shapedSnap.value?.count).toBe(3);
});

test("heals a lagging snapshot on compaction when the per-turn write failed", async () => {
  const { context, sessionHook } = hookFake();
  const runtime = createContextRuntime();
  // Simulate a session whose last per-turn write failed: the guard lags
  // the conversation, and the file is missing.
  sessionRuntime(runtime, SESSION).snapshotSeen = { version: 1, count: 1 };
  registerCompactionHook(context, DEPS, runtime);
  const hook = sessionHook.mock.calls[0]?.[1] as (event: TestEvent) => Promise<void>;

  await hook(compactionEvent(3));

  const snap = await readCompactionSnapshot(`${STATE}/context-snapshot`, SESSION);
  expect(snap.ok && snap.value?.count).toBe(3);
  expect(sessionRuntime(runtime, SESSION).snapshotSeen?.count).toBe(3);

  // An unchanged conversation is a growth-guarded no-op (same seen reference).
  const seenAfterHeal = sessionRuntime(runtime, SESSION).snapshotSeen;
  await hook(compactionEvent(3));
  expect(sessionRuntime(runtime, SESSION).snapshotSeen).toBe(seenAfterHeal);
});

test("labels the receipt with the recorded request cause", async () => {
  const { context, sessionHook } = hookFake();
  const runtime = createContextRuntime();
  runtime.pendingCauses.set(SESSION, { cause: "task-complete", at: Date.now() });
  registerCompactionHook(context, DEPS, runtime);
  const hook = sessionHook.mock.calls[0]?.[1] as (event: TestEvent) => Promise<void>;

  await hook(compactionEvent(1));

  const receipts = await readReceipts(`${STATE}/context-log`, SESSION);
  expect(receipts.ok ? receipts.value[0] : null).toMatchObject({
    kind: "compact",
    trigger: "task-complete",
  });
  // Consumed once: a later host-initiated compaction is labeled manual.
  expect(runtime.pendingCauses.has(SESSION)).toBe(false);
});

test("labels a stale recorded cause manual instead of reusing it", async () => {
  const { context, sessionHook } = hookFake();
  const runtime = createContextRuntime();
  runtime.pendingCauses.set(SESSION, { cause: "task-complete", at: 0 });
  registerCompactionHook(context, DEPS, runtime);
  const hook = sessionHook.mock.calls[0]?.[1] as (event: TestEvent) => Promise<void>;

  await hook(compactionEvent(1));

  // A requested-but-never-executed compaction must not label a far-future
  // host-initiated compaction with its stale trigger.
  const receipts = await readReceipts(`${STATE}/context-log`, SESSION);
  expect(receipts.ok ? receipts.value[0] : null).toMatchObject({
    kind: "compact",
    trigger: "manual",
  });
  expect(runtime.pendingCauses.has(SESSION)).toBe(false);
});

test("clears the failure backoff when a compaction attempt runs", async () => {
  const { context, sessionHook } = hookFake();
  const runtime = createContextRuntime();
  sessionRuntime(runtime, SESSION).lastCompactionFailure = { at: Date.now(), estimate: 100000 };
  registerCompactionHook(context, DEPS, runtime);
  const hook = sessionHook.mock.calls[0]?.[1] as (event: TestEvent) => Promise<void>;

  await hook(compactionEvent(1));

  // The attempt was honored: a later failure re-arms the backoff from scratch.
  expect(sessionRuntime(runtime, SESSION).lastCompactionFailure).toBeNull();
});

test("leaves the request alone and refuses when the Brain is unavailable", async () => {
  const { context, sessionHook } = hookFake();
  registerCompactionHook(
    context,
    { ...DEPS, isBrainAvailable: () => false },
    createContextRuntime(),
  );
  const hook = sessionHook.mock.calls[0]?.[1] as (event: TestEvent) => Promise<void>;

  const event = compactionEvent(4);
  await hook(event);

  expect(event.result).toBeNull();
  expect(event.system).toHaveLength(1);
  expect(event.messages).toHaveLength(4);
  const receipts = await readReceipts(`${STATE}/context-log`, SESSION);
  expect(receipts.ok && receipts.value).toHaveLength(1);
  expect(receipts.ok ? receipts.value[0] : null).toMatchObject({
    kind: "refusal",
    reason: "brain-unavailable",
  });
});

test("arms a post-compaction preamble refresh when refresh is enabled", async () => {
  const { context, sessionHook } = hookFake();
  const runtime = createContextRuntime();
  registerCompactionHook(context, { ...DEPS, refreshEnabled: true }, runtime);
  const hook = sessionHook.mock.calls[0]?.[1] as (event: TestEvent) => Promise<void>;

  await hook(compactionEvent(1));

  expect(sessionRuntime(runtime, SESSION).preambleRefreshPending).toBe(true);
});

test("leaves the refresh flag alone when refresh is disabled", async () => {
  const { context, sessionHook } = hookFake();
  const runtime = createContextRuntime();
  registerCompactionHook(context, DEPS, runtime);
  const hook = sessionHook.mock.calls[0]?.[1] as (event: TestEvent) => Promise<void>;

  await hook(compactionEvent(1));

  expect(sessionRuntime(runtime, SESSION).preambleRefreshPending).toBe(false);
});
