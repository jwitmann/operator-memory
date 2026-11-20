import { beforeEach, expect, test, vi } from "vitest";

import { apply, defineRecallTool, defineSearchTool, inject, name } from "../src/tool.ts";

// DSH-shaped durable log fixtures: the host log is append-only and readable
// directly, so the tools take the calling agent's session as-is. The fake
// deriver mirrors the host contract (derived message or null).
function makeSession(
  events: Array<{ readonly seq: number; readonly type: string; readonly data?: unknown }>,
) {
  return {
    events,
    deriveEventMessage(event: { readonly data?: unknown }) {
      const message = (event as { data?: { message?: unknown } }).data?.message;
      if (message === null || message === undefined || typeof message !== "object") return null;
      return message;
    },
  };
}

const LOG = makeSession([
  { seq: 0, type: "session.created", data: {} },
  {
    seq: 1,
    type: "user/message",
    data: {
      message: { role: "user", content: [{ type: "text", text: "please fix the login bug" }] },
    },
  },
  {
    seq: 2,
    type: "assistant/message",
    data: {
      message: {
        role: "assistant",
        content: [{ type: "tool-call", name: "read", arguments: '{"path":"a.js"}' }],
      },
    },
  },
  {
    seq: 3,
    type: "tool/result",
    data: { message: { role: "tool", content: [{ type: "text", text: "file contents here" }] } },
  },
]);

function execWith(session: unknown) {
  return { agent: session === null ? undefined : { session } };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

test("tool row exposes the agent-scoped composition identity", () => {
  expect(name).toBe("tool-recall");
  expect(inject).toEqual(["tools"]);
});

test("apply registers recall and search and disposes both", () => {
  const disposers = [vi.fn(), vi.fn()];
  const register = vi.fn(() => disposers[register.mock.calls.length - 1]);
  let dispose: (() => void) | undefined;
  apply({
    effect: (registerEffect: () => () => void) => {
      dispose = registerEffect();
    },
    tools: { register },
  } as never);

  expect(register).toHaveBeenCalledTimes(2);
  expect(register.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ name: "operator-recall" }));
  expect(register.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ name: "operator-search" }));
  dispose?.();
  expect(disposers[0]).toHaveBeenCalledOnce();
  expect(disposers[1]).toHaveBeenCalledOnce();
});

test("recall restores a seq selection from the durable log", async () => {
  const tool = defineRecallTool();
  expect(tool.name).toBe("operator-recall");
  const out = (await tool.execute({ type: "seq", id: "1" }, execWith(LOG))) as {
    text: string;
    recalled: number;
    tokens: number;
  };

  expect(out.recalled).toBe(1);
  expect(out.text).toContain("**operator-recall seq 1** (1 event(s),");
  expect(out.text).toContain("please fix the login bug");
});

test("recall resolves result pointers against tool/result events", async () => {
  const tool = defineRecallTool();
  const out = (await tool.execute({ type: "result", id: "3" }, execWith(LOG))) as {
    text: string;
    recalled: number;
  };

  expect(out.recalled).toBe(1);
  expect(out.text).toContain("file contents here");
});

test("recall reports invalid input without throwing", async () => {
  const tool = defineRecallTool();
  // The framework validates the enum before execute runs.
  await expect(tool.execute({ type: "oops", id: "1" }, execWith(LOG))).rejects.toThrow(/one of/);

  const missing = (await tool.execute({ type: "seq", id: "  " }, execWith(LOG))) as {
    text: string;
  };
  expect(missing.text).toContain("Missing required input: id.");

  const noAgent = (await tool.execute({ type: "seq", id: "1" }, { agent: undefined })) as {
    text: string;
  };
  expect(noAgent.text).toContain("requires a calling agent with a session.");

  const notFound = (await tool.execute({ type: "seq", id: "99" }, execWith(LOG))) as {
    text: string;
  };
  expect(notFound.text).toContain("not found in this session");
});

test("recall degrades to text on a poisoned session log", async () => {
  const tool = defineRecallTool();
  const poisoned = {
    events: [
      { seq: 0, type: "session.created", data: {} },
      { seq: 1, type: "user/message", data: { message: { role: "user" } } },
    ],
    deriveEventMessage: () => {
      throw new Error("host deriver blew up");
    },
  };
  const out = (await tool.execute({ type: "seq", id: "1" }, execWith(poisoned))) as {
    text: string;
    recalled: number;
  };
  expect(out.text).toContain("Could not read the session log.");
  expect(out.recalled).toBe(0);
});

test("search degrades to text on a poisoned session log", async () => {
  const tool = defineSearchTool();
  const poisoned = {
    events: [{ seq: 0, type: "session.created", data: {} }],
    deriveEventMessage: () => {
      throw new Error("host deriver blew up");
    },
  };
  const out = (await tool.execute({ pattern: "login" }, execWith(poisoned))) as {
    text: string;
    totalMatches: number;
  };
  expect(out.text).toContain("Could not read the session log.");
  expect(out.totalMatches).toBe(0);
});

test("search finds keyword hits with recall pointers", async () => {
  const tool = defineSearchTool();
  expect(tool.name).toBe("operator-search");
  const out = (await tool.execute({ pattern: "login" }, execWith(LOG))) as {
    text: string;
    totalMatches: number;
    pattern: string;
  };

  expect(out.totalMatches).toBe(1);
  expect(out.pattern).toBe("login");
  expect(out.text).toContain("**operator-search login** (1 matching event(s))");
  expect(out.text).toContain("[seq 1");
});

test("search reports invalid input and patterns without throwing", async () => {
  const tool = defineSearchTool();
  const empty = (await tool.execute({ pattern: "  " }, execWith(LOG))) as { text: string };
  expect(empty.text).toContain("Missing required input: pattern.");

  const badPattern = (await tool.execute({ pattern: "(" }, execWith(LOG))) as {
    text: string;
    totalMatches: number;
  };
  expect(badPattern.totalMatches).toBe(0);
  expect(badPattern.text).toContain("Invalid search pattern: (.");

  const noAgent = (await tool.execute({ pattern: "login" }, { agent: undefined })) as {
    text: string;
  };
  expect(noAgent.text).toContain("requires a calling agent with a session.");
});

test("recall falls back to raw payloads for log-only events", async () => {
  const tool = defineRecallTool();
  const logOnly = makeSession([
    { seq: 0, type: "session.created", data: {} },
    { seq: 1, type: "compaction/end", data: { compactionId: "c1" } },
  ]);
  const out = (await tool.execute({ type: "seq", id: "1" }, execWith(logOnly))) as {
    text: string;
    recalled: number;
  };

  expect(out.recalled).toBe(1);
  expect(out.text).toContain("compactionId");
});
