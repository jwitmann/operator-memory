import { beforeEach, expect, test, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "node:child_process";

import {
  apply,
  defineRecallSessionTool,
  defineRecallTool,
  defineSearchSessionsTool,
  defineSearchTool,
  inject,
  name,
} from "../src/tool.ts";

const execFileMock = vi.mocked(execFile);

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
  // The module mock above has no original implementation to restore to:
  // reset call history + implementations so each test starts clean.
  execFileMock.mockReset();
});

test("tool row exposes the agent-scoped composition identity", () => {
  expect(name).toBe("tool-recall");
  expect(inject).toEqual(["tools"]);
});

test("apply registers all four tools and disposes them", () => {
  const disposers = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
  const register = vi.fn(() => disposers[register.mock.calls.length - 1]);
  let dispose: (() => void) | undefined;
  apply({
    effect: (registerEffect: () => () => void) => {
      dispose = registerEffect();
    },
    tools: { register },
  } as never);

  expect(register).toHaveBeenCalledTimes(4);
  expect(register.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({ name: "vcc-brain-recall" }),
  );
  expect(register.mock.calls[1]?.[0]).toEqual(
    expect.objectContaining({ name: "vcc-brain-search" }),
  );
  expect(register.mock.calls[2]?.[0]).toEqual(
    expect.objectContaining({ name: "vcc-brain-search-sessions" }),
  );
  expect(register.mock.calls[3]?.[0]).toEqual(
    expect.objectContaining({ name: "vcc-brain-recall-session" }),
  );
  dispose?.();
  expect(disposers[0]).toHaveBeenCalledOnce();
  expect(disposers[1]).toHaveBeenCalledOnce();
  expect(disposers[2]).toHaveBeenCalledOnce();
  expect(disposers[3]).toHaveBeenCalledOnce();
});

test("recall restores a seq selection from the durable log", async () => {
  const tool = defineRecallTool();
  expect(tool.name).toBe("vcc-brain-recall");
  const out = (await tool.execute({ type: "seq", id: "1" }, execWith(LOG))) as {
    text: string;
    recalled: number;
    tokens: number;
  };

  expect(out.recalled).toBe(1);
  expect(out.text).toContain("**vcc-brain-recall seq 1** (1 event(s),");
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
  expect(tool.name).toBe("vcc-brain-search");
  const out = (await tool.execute({ pattern: "login" }, execWith(LOG))) as {
    text: string;
    totalMatches: number;
    pattern: string;
  };

  expect(out.totalMatches).toBe(1);
  expect(out.pattern).toBe("login");
  expect(out.text).toContain("**vcc-brain-search login** (1 matching event(s))");
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

function sessionWithCwd(cwd: string): unknown {
  return {
    header: { cwd },
    events: [],
    deriveEventMessage: () => null,
  };
}

function succeedWith(stdout: string) {
  execFileMock.mockImplementation((_bin, _args, _opts, callback) => {
    (callback as (error: null, stdout: string, stderr: string) => void)(null, stdout, "");
    return undefined as never;
  });
}

test("search-sessions shells to the helper with project scope", async () => {
  const tool = defineSearchSessionsTool();
  expect(tool.name).toBe("vcc-brain-search-sessions");
  succeedWith("helper output here");
  const out = (await tool.execute(
    { keywords: "deploy decision" },
    { agent: { session: sessionWithCwd("/home/u/checkouts/operator-memory") } },
  )) as { text: string; exitCode: number };
  expect(out.exitCode).toBe(0);
  expect(out.text).toBe("helper output here");
  expect(execFileMock).toHaveBeenCalledOnce();
  const [bin, invocation] = execFileMock.mock.calls[0] as [string, string[]];
  expect(bin).toBe("vcc-brain-helper");
  expect(invocation.slice(0, 2)).toEqual(["recall-cross", "query"]);
  expect(invocation).toContain("--project");
  expect(invocation).toContain("--project-dir");
  expect(invocation).toContain("/home/u/checkouts/operator-memory");
  expect(invocation.slice(-2)).toEqual(["deploy", "decision"]);
});

test("search-sessions validates input without spawning", async () => {
  const tool = defineSearchSessionsTool();
  const blank = (await tool.execute({ keywords: "  " }, execWith(LOG))) as { text: string };
  expect(blank.text).toContain("Missing required input: keywords.");
  const dashy = (await tool.execute({ keywords: "--project" }, execWith(LOG))) as { text: string };
  expect(dashy.text).toContain("must not start with '-'.");
  const noAgent = (await tool.execute({ keywords: "deploy" }, { agent: undefined })) as {
    text: string;
  };
  expect(noAgent.text).toContain("requires a calling agent with a session.");
  expect(execFileMock).not.toHaveBeenCalled();
});

test("recall-session restores by id with an optional seq", async () => {
  const tool = defineRecallSessionTool();
  expect(tool.name).toBe("vcc-brain-recall-session");
  succeedWith("full turns here");
  const out = (await tool.execute(
    { sessionId: "dsh:abc", seq: "2" },
    { agent: { session: sessionWithCwd("/proj") } },
  )) as { text: string; exitCode: number };
  expect(out.exitCode).toBe(0);
  expect(out.text).toBe("full turns here");
  const [, invocation] = execFileMock.mock.calls[0] as [string, string[]];
  expect(invocation).toEqual(["recall-cross", "recall", "dsh:abc", "--seq", "2"]);
});

test("recall-session validates input without spawning", async () => {
  const tool = defineRecallSessionTool();
  const blank = (await tool.execute({ sessionId: "  " }, execWith(LOG))) as { text: string };
  expect(blank.text).toContain("Missing required input: sessionId.");
  const badSeq = (await tool.execute({ sessionId: "dsh:abc", seq: "x" }, execWith(LOG))) as {
    text: string;
  };
  expect(badSeq.text).toContain("seq must be a non-negative integer");
  const dashy = (await tool.execute({ sessionId: "--help" }, execWith(LOG))) as { text: string };
  expect(dashy.text).toContain("must not start with '-'.");
  const noAgent = (await tool.execute({ sessionId: "dsh:abc" }, { agent: undefined })) as {
    text: string;
  };
  expect(noAgent.text).toContain("requires a calling agent with a session.");
  expect(execFileMock).not.toHaveBeenCalled();
});

test("session tools degrade to text when the helper is missing", async () => {
  execFileMock.mockImplementation(() => {
    throw new Error("spawn ENOENT");
  });
  const search = (await defineSearchSessionsTool().execute(
    { keywords: "deploy" },
    { agent: { session: sessionWithCwd("/proj") } },
  )) as { text: string };
  expect(search.text).toContain("vcc-brain-helper");
  const recall = (await defineRecallSessionTool().execute(
    { sessionId: "dsh:abc" },
    { agent: { session: sessionWithCwd("/proj") } },
  )) as { text: string };
  expect(recall.text).toContain("vcc-brain-helper");
});
