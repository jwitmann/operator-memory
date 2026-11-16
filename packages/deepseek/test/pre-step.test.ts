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
    );
    expect(fired).toBe(false);
    expect(session.lastCompactionFailure).toEqual({ at: now, estimate: 100000 });
  });
});
