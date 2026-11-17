import { describe, expect, test, vi } from "vitest";
import { DEFAULT_CONTEXT_MANAGEMENT_CONFIG } from "../src/config.ts";
import { maybeEnforceCompaction, type PreStepDeps } from "../src/pre-step.ts";
import { createDshRuntime, PENDING_CAUSE_TTL_MS, sessionRuntime } from "../src/runtime.ts";

function deps(overrides: Partial<PreStepDeps> = {}): PreStepDeps {
  return {
    config: { ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG, enabled: true },
    stateDirectory: "/tmp/operator-dsh-test-state",
    compaction: {
      compactIfNeeded: () => {
        throw new Error("no compaction service in this test");
      },
    },
    isBrainAvailable: () => true,
    reportReceiptFailure: () => undefined,
    ...overrides,
  };
}

function payload(sessionId = "session-test", signal = new AbortController().signal): unknown {
  return { agent: { session: { id: sessionId } }, signal };
}

describe("pre-step enforcement", () => {
  test("enforces stashed intent once via host policy", async () => {
    const runtime = createDshRuntime();
    const compactIfNeeded = vi.fn(async () => ({ ok: true }));
    const session = sessionRuntime(runtime, "session-test");
    session.pendingCompaction = { cause: "task-complete", estimate: 100000, at: Date.now() };

    const fired = await maybeEnforceCompaction(
      payload(),
      deps({ compaction: { compactIfNeeded } }),
      runtime,
      Date.now(),
      { allowCommandFallback: false },
    );
    expect(fired).toBe(true);
    expect(compactIfNeeded).toHaveBeenCalledOnce();
    expect(session.pendingCompaction).toBe(null);
    expect(runtime.pendingCauses.get("session-test")?.cause).toBe("task-complete");
  });

  test("stale intent expires without compacting", async () => {
    const runtime = createDshRuntime();
    const compactIfNeeded = vi.fn(async () => ({ ok: true }));
    const session = sessionRuntime(runtime, "session-test");
    session.pendingCompaction = {
      cause: "task-complete",
      estimate: 100000,
      at: Date.now() - PENDING_CAUSE_TTL_MS - 1000,
    };

    const fired = await maybeEnforceCompaction(
      payload(),
      deps({ compaction: { compactIfNeeded } }),
      runtime,
      Date.now(),
      { allowCommandFallback: false },
    );
    expect(fired).toBe(false);
    expect(compactIfNeeded).not.toHaveBeenCalled();
  });

  test("no intent or disabled config never fires", async () => {
    const runtime = createDshRuntime();
    const now = Date.now();
    const compactIfNeeded = vi.fn(async () => ({ ok: true }));
    expect(
      await maybeEnforceCompaction(
        payload(),
        deps({ compaction: { compactIfNeeded } }),
        runtime,
        now,
        { allowCommandFallback: false },
      ),
    ).toBe(false);
    expect(
      await maybeEnforceCompaction(
        payload(),
        deps({
          config: { ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG, enabled: false },
          compaction: { compactIfNeeded },
        }),
        runtime,
        now,
        { allowCommandFallback: false },
      ),
    ).toBe(false);
    expect(compactIfNeeded).not.toHaveBeenCalled();
  });

  test("a host-reported failure suppresses dispatch under the cooldown", async () => {
    const runtime = createDshRuntime();
    const now = Date.now();
    const compactIfNeeded = vi.fn(async () => ({ ok: true }));
    const session = sessionRuntime(runtime, "session-test");
    session.pendingCompaction = { cause: "task-complete", estimate: 100000, at: now };
    session.lastCompactionFailure = { at: now, estimate: 100000 };
    session.lastEstimate = 100000;
    session.contextWindow = 1000000;

    const fired = await maybeEnforceCompaction(
      payload(),
      deps({ compaction: { compactIfNeeded } }),
      runtime,
      now,
      { allowCommandFallback: false },
    );
    expect(fired).toBe(false);
    expect(compactIfNeeded).not.toHaveBeenCalled();
    // Intent survives suppression: real growth past the failure re-arms.
    expect(session.pendingCompaction).not.toBe(null);
  });

  test("a dispatch throw arms the backoff instead of hot-looping", async () => {
    const runtime = createDshRuntime();
    const now = Date.now();
    const compactIfNeeded = vi.fn(async () => {
      throw new Error("transient host error");
    });
    const session = sessionRuntime(runtime, "session-test");
    session.pendingCompaction = { cause: "task-complete", estimate: 100000, at: now };
    session.lastEstimate = 100000;
    session.contextWindow = 1000000;

    const fired = await maybeEnforceCompaction(
      payload(),
      deps({ compaction: { compactIfNeeded } }),
      runtime,
      now,
      { allowCommandFallback: false },
    );
    expect(fired).toBe(false);
    expect(session.lastCompactionFailure).toEqual({ at: now, estimate: 100000 });
  });

  test("a missing service skips enforcement and leaves the stash intact", async () => {
    const runtime = createDshRuntime();
    const now = Date.now();
    const session = sessionRuntime(runtime, "session-test");
    session.pendingCompaction = { cause: "task-complete", estimate: 100000, at: now };

    const fired = await maybeEnforceCompaction(
      payload(),
      deps({ compaction: undefined, compactionForAgent: () => null }),
      runtime,
      now,
      { allowCommandFallback: false },
    );
    expect(fired).toBe(false);
    expect(session.pendingCompaction).not.toBe(null);
  });

  test("a per-agent service covers a missing profile service", async () => {
    const runtime = createDshRuntime();
    const compactIfNeeded = vi.fn(async () => ({ ok: true }));
    const session = sessionRuntime(runtime, "session-test");
    session.pendingCompaction = { cause: "task-complete", estimate: 100000, at: Date.now() };

    const fired = await maybeEnforceCompaction(
      payload(),
      deps({
        compaction: undefined,
        compactionForAgent: () => ({ compactIfNeeded }),
      }),
      runtime,
      Date.now(),
      { allowCommandFallback: false },
    );
    expect(fired).toBe(true);
    expect(compactIfNeeded).toHaveBeenCalledOnce();
    expect(session.pendingCompaction).toBe(null);
  });

  test("falls back to the /compact command when no compaction service resolves", async () => {
    const runtime = createDshRuntime();
    const now = Date.now();
    const agent = { session: { id: "session-test" } };
    const signal = new AbortController().signal;
    const execute = vi.fn(async () => ({ result: { kind: "success" } }));
    const session = sessionRuntime(runtime, "session-test");
    session.pendingCompaction = { cause: "task-complete", estimate: 100000, at: now };

    const fired = await maybeEnforceCompaction(
      { agent, signal },
      deps({
        compaction: undefined,
        compactionForAgent: () => null,
        commands: { execute },
      }),
      runtime,
      now,
      { allowCommandFallback: true },
    );
    expect(fired).toBe(true);
    expect(execute).toHaveBeenCalledWith(agent, "/compact", [], signal);
    expect(session.pendingCompaction).toBe(null);
    expect(runtime.pendingCauses.get("session-test")?.cause).toBe("task-complete");
  });

  test("a command-reported failure arms the backoff and drops the intent", async () => {
    const runtime = createDshRuntime();
    const now = Date.now();
    const execute = vi.fn(async () => ({ result: { kind: "error" } }));
    const session = sessionRuntime(runtime, "session-test");
    session.pendingCompaction = { cause: "task-complete", estimate: 100000, at: now };
    session.lastEstimate = 100000;
    session.contextWindow = 1000000;

    const fired = await maybeEnforceCompaction(
      payload(),
      deps({
        compaction: undefined,
        compactionForAgent: () => null,
        commands: { execute },
      }),
      runtime,
      now,
      { allowCommandFallback: true },
    );
    expect(fired).toBe(false);
    expect(session.pendingCompaction).toBe(null);
    expect(session.lastCompactionFailure).toEqual({ at: now, estimate: 100000 });
  });

  test("an unknown /compact command leaves the stash for a later composition", async () => {
    const runtime = createDshRuntime();
    const now = Date.now();
    const execute = vi.fn(async () => undefined);
    const session = sessionRuntime(runtime, "session-test");
    session.pendingCompaction = { cause: "task-complete", estimate: 100000, at: now };

    const fired = await maybeEnforceCompaction(
      payload(),
      deps({
        compaction: undefined,
        compactionForAgent: () => null,
        commands: { execute },
      }),
      runtime,
      now,
      { allowCommandFallback: true },
    );
    expect(fired).toBe(false);
    expect(session.pendingCompaction).not.toBe(null);
  });

  test("a pre-step caller never drives the command fallback", async () => {
    // The backend refuses mid-loop agents, so only the idle listener allows
    // the `/compact` dispatch. A pre-step attempt leaves the stash for it.
    const runtime = createDshRuntime();
    const now = Date.now();
    const execute = vi.fn(async () => ({ result: { kind: "success" } }));
    const session = sessionRuntime(runtime, "session-test");
    session.pendingCompaction = { cause: "task-complete", estimate: 100000, at: now };

    const fired = await maybeEnforceCompaction(
      payload(),
      deps({
        compaction: undefined,
        compactionForAgent: () => null,
        commands: { execute },
      }),
      runtime,
      now,
      { allowCommandFallback: false },
    );
    expect(fired).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(session.pendingCompaction).not.toBe(null);
  });

  test("records the cause before invoking so the end-event receipt finds it", async () => {
    // The receipt is written when compaction/end lands, which can precede
    // the attempt's own resolution — the entry must already exist at
    // invoke time, not only after success resolves.
    const runtime = createDshRuntime();
    const now = Date.now();
    let observedAtInvoke: unknown = "unset";
    const execute = vi.fn(async () => {
      observedAtInvoke = runtime.pendingCauses.get("session-test");
      return { result: { kind: "success" } };
    });
    const session = sessionRuntime(runtime, "session-test");
    session.pendingCompaction = { cause: "ratio", estimate: 100000, at: now };

    const fired = await maybeEnforceCompaction(
      payload(),
      deps({
        compaction: undefined,
        compactionForAgent: () => null,
        commands: { execute },
      }),
      runtime,
      now,
      { allowCommandFallback: true },
    );
    expect(fired).toBe(true);
    expect(observedAtInvoke).toEqual({ cause: "ratio", at: now });
    expect(runtime.pendingCauses.get("session-test")).toEqual({ cause: "ratio", at: now });
  });

  test("a failed command attempt drops the cause entry it recorded", async () => {
    const runtime = createDshRuntime();
    const now = Date.now();
    const execute = vi.fn(async () => ({ result: { kind: "error" } }));
    const session = sessionRuntime(runtime, "session-test");
    session.pendingCompaction = { cause: "task-complete", estimate: 100000, at: now };
    session.lastEstimate = 100000;
    session.contextWindow = 1000000;

    const fired = await maybeEnforceCompaction(
      payload(),
      deps({
        compaction: undefined,
        compactionForAgent: () => null,
        commands: { execute },
      }),
      runtime,
      now,
      { allowCommandFallback: true },
    );
    expect(fired).toBe(false);
    expect(runtime.pendingCauses.get("session-test")).toBe(undefined);
  });
});
