import { describe, expect, test } from "vitest";
import { DEFAULT_CONTEXT_MANAGEMENT_CONFIG } from "../src/config.ts";
import { dispatchSessionEvent, type EventsDeps } from "../src/events.ts";
import { countSessionCompletedCalls, createDshRuntime, sessionRuntime } from "../src/runtime.ts";

function deps(overrides: Partial<EventsDeps> = {}): EventsDeps {
  return {
    config: { ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG, enabled: false },
    stateDirectory: "/tmp/operator-dsh-test-state",
    tokenMeter: {
      measure: () => {
        throw new Error("no meter in this test");
      },
      contextPressure: () => ({}),
    },
    isBrainAvailable: () => true,
    reportReceiptFailure: () => undefined,
    ...overrides,
  };
}

const session = { id: "session-test" };

describe("session-event tool counter", () => {
  test("pairs call and result by callId", async () => {
    const runtime = createDshRuntime();
    const d = deps();
    await dispatchSessionEvent(
      session,
      {
        type: "tool/call",
        data: { turn: 1, step: 1, callId: "c1", name: "bash", arguments: "{}" },
      },
      d,
      runtime,
    );
    expect(countSessionCompletedCalls(sessionRuntime(runtime, session.id))).toBe(0);
    await dispatchSessionEvent(
      session,
      {
        type: "tool/result",
        data: { turn: 1, step: 1, message: { role: "tool", toolCallId: "c1" } },
      },
      d,
      runtime,
    );
    expect(countSessionCompletedCalls(sessionRuntime(runtime, session.id))).toBe(1);
  });

  test("result without call does not count; operator tools excluded", async () => {
    const runtime = createDshRuntime();
    const d = deps();
    await dispatchSessionEvent(
      session,
      {
        type: "tool/result",
        data: { turn: 1, step: 1, message: { role: "tool", toolCallId: "orphan" } },
      },
      d,
      runtime,
    );
    expect(countSessionCompletedCalls(sessionRuntime(runtime, session.id))).toBe(0);

    await dispatchSessionEvent(
      session,
      { type: "tool/call", data: { callId: "c2", name: "operator:read_omitted" } },
      d,
      runtime,
    );
    await dispatchSessionEvent(
      session,
      { type: "tool/result", data: { message: { role: "tool", toolCallId: "c2" } } },
      d,
      runtime,
    );
    expect(countSessionCompletedCalls(sessionRuntime(runtime, session.id))).toBe(0);
  });

  test("non-completed turn/end never stashes compaction intent", async () => {
    const runtime = createDshRuntime();
    const d = deps({
      config: { ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG, enabled: true },
    });
    await dispatchSessionEvent(
      session,
      { type: "turn/end", data: { turn: 1, reason: { kind: "error" } } },
      d,
      runtime,
    );
    expect(sessionRuntime(runtime, session.id).pendingCompaction).toBe(null);
  });

  test("malformed events are ignored, never fatal", async () => {
    const runtime = createDshRuntime();
    const d = deps();
    await dispatchSessionEvent(null, null, d, runtime);
    await dispatchSessionEvent(session, { nope: true }, d, runtime);
    await dispatchSessionEvent(session, { type: "tool/call", data: {} }, d, runtime);
    expect(runtime.sessions.size).toBeLessThanOrEqual(1);
  });

  test("successful compaction writes a priced receipt from a fresh measurement", async () => {
    const runtime = createDshRuntime();
    const d = deps({
      config: { ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG, enabled: true },
      tokenMeter: {
        measure: () => ({ totalTokens: 5000 }),
        contextPressure: () => ({}),
      },
    });
    await dispatchSessionEvent(
      session,
      { type: "compaction/end", data: { turn: 1, compactionId: "c1" } },
      d,
      runtime,
    );
    const entry = sessionRuntime(runtime, session.id);
    expect(entry.lastEstimate).toBe(5000);
    expect(entry.preambleRefreshPending).toBe(true);
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const log = await readFile(
      join("/tmp/operator-dsh-test-state", "context-log", `${session.id}.log`),
      "utf8",
    );
    const receipt = JSON.parse(log.trim().split("\n").pop() as string) as {
      kind: string;
      trigger: string;
      summarized: number;
    };
    expect(receipt.kind).toBe("compact");
    expect(receipt.trigger).toBe("manual");
    expect(receipt.summarized).toBe(5000);
  });

  test("compaction receipt attributes the engine from the summary provenance", async () => {
    for (const [provider, engine] of [
      ["dsh-compaction-vcc", "vcc"],
      ["deepseek-chat", "shaped"],
    ] as const) {
      const runtime = createDshRuntime();
      const d = deps({
        config: { ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG, enabled: true },
        tokenMeter: {
          measure: () => ({ totalTokens: 5000 }),
          contextPressure: () => ({}),
        },
      });
      await dispatchSessionEvent(
        session,
        {
          type: "compaction/summary",
          data: { provider, model: provider === "dsh-compaction-vcc" ? "vcc-compiler" : "x" },
        },
        d,
        runtime,
      );
      await dispatchSessionEvent(
        session,
        { type: "compaction/end", data: { turn: 1, compactionId: "c1" } },
        d,
        runtime,
      );
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const log = await readFile(
        join("/tmp/operator-dsh-test-state", "context-log", `${session.id}.log`),
        "utf8",
      );
      const receipt = JSON.parse(log.trim().split("\n").pop() as string) as { engine: string };
      expect(receipt.engine).toBe(engine);
      // Consumed once: a later end without a new summary is unattributed.
      expect(sessionRuntime(runtime, session.id).lastCompactionSource).toBeNull();
    }
  });

  test("compaction receipt stays unknown with no observed summary", async () => {
    const runtime = createDshRuntime();
    const d = deps({
      config: { ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG, enabled: true },
      tokenMeter: {
        measure: () => ({ totalTokens: 5000 }),
        contextPressure: () => ({}),
      },
    });
    await dispatchSessionEvent(
      session,
      { type: "compaction/end", data: { turn: 1, compactionId: "c1" } },
      d,
      runtime,
    );
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const log = await readFile(
      join("/tmp/operator-dsh-test-state", "context-log", `${session.id}.log`),
      "utf8",
    );
    const receipt = JSON.parse(log.trim().split("\n").pop() as string) as { engine: string };
    expect(receipt.engine).toBe("unknown");
  });

  test("failed compaction arms the backoff and skips the receipt", async () => {
    const runtime = createDshRuntime();
    const d = deps({
      config: { ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG, enabled: true },
      tokenMeter: {
        measure: () => ({ totalTokens: 5000 }),
        contextPressure: () => ({}),
      },
    });
    // Seed an estimate first so the failure has something to arm against.
    sessionRuntime(runtime, session.id).lastEstimate = 4000;
    await dispatchSessionEvent(
      session,
      { type: "compaction/end", data: { turn: 1, compactionId: "c1", error: "boom" } },
      d,
      runtime,
    );
    const entry = sessionRuntime(runtime, session.id);
    expect(entry.lastCompactionFailure).toEqual({ at: expect.any(Number), estimate: 4000 });
    expect(entry.pendingCompaction).toBe(null);
  });

  function completedTurn() {
    return { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } };
  }

  function metered(totalTokens: number, contextWindow?: number) {
    return {
      measure: () => ({ totalTokens }),
      contextPressure: () => (contextWindow === undefined ? {} : { contextWindow }),
    };
  }

  test("ratio pressure stashes intent even with compactOnComplete off", async () => {
    const runtime = createDshRuntime();
    const d = deps({
      config: {
        ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
        enabled: true,
        compactOnComplete: false,
        ratio: 0.5,
      },
      tokenMeter: metered(100000, 100000),
    });
    await dispatchSessionEvent(session, completedTurn(), d, runtime);
    expect(sessionRuntime(runtime, session.id).pendingCompaction).toEqual({
      cause: "ratio",
      estimate: 100000,
      at: expect.any(Number),
    });
  });

  test("pressure cause wins when both pressure and floor fire", async () => {
    const runtime = createDshRuntime();
    const d = deps({
      config: {
        ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
        enabled: true,
        compactOnComplete: true,
        compactFloorTokens: 1000,
        ratio: 0.5,
      },
      tokenMeter: metered(100000, 100000),
    });
    await dispatchSessionEvent(session, completedTurn(), d, runtime);
    expect(sessionRuntime(runtime, session.id).pendingCompaction?.cause).toBe("ratio");
  });

  test("task-complete still fires below ratio when the floor is met", async () => {
    const runtime = createDshRuntime();
    const d = deps({
      config: {
        ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
        enabled: true,
        compactOnComplete: true,
        compactFloorTokens: 1000,
        ratio: 0.8,
      },
      tokenMeter: metered(50000, 100000),
    });
    await dispatchSessionEvent(session, completedTurn(), d, runtime);
    expect(sessionRuntime(runtime, session.id).pendingCompaction?.cause).toBe("task-complete");
  });

  test("disabled config stashes nothing on a completed turn", async () => {
    const runtime = createDshRuntime();
    const d = deps({
      tokenMeter: metered(100000, 100000),
    });
    await dispatchSessionEvent(session, completedTurn(), d, runtime);
    expect(sessionRuntime(runtime, session.id).pendingCompaction).toBe(null);
  });

  test("a missing meter skips evaluation without stashing or throwing", async () => {
    const runtime = createDshRuntime();
    const d = deps({
      config: {
        ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
        enabled: true,
        compactOnComplete: true,
        compactFloorTokens: 0,
      },
      tokenMeter: undefined,
      meterForSession: () => null,
    });
    await dispatchSessionEvent(session, completedTurn(), d, runtime);
    expect(sessionRuntime(runtime, session.id).pendingCompaction).toBe(null);
  });

  test("a per-session meter covers a missing profile meter", async () => {
    const runtime = createDshRuntime();
    const d = deps({
      config: {
        ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
        enabled: true,
        compactOnComplete: true,
        compactFloorTokens: 1000,
        ratio: 0.8,
      },
      tokenMeter: undefined,
      meterForSession: () => metered(50000, 100000),
    });
    await dispatchSessionEvent(session, completedTurn(), d, runtime);
    expect(sessionRuntime(runtime, session.id).pendingCompaction?.cause).toBe("task-complete");
  });
});
