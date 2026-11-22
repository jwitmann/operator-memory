import { appendReceipt } from "@jwitmann/vcc-brain-core/context/receipts";
import { evaluateTrigger } from "@jwitmann/vcc-brain-core/context/triggers";
import type { Context } from "@deepseek-ai/cordis";
import { join } from "node:path";

import { type ContextManagementConfig, toTriggerConfig } from "./config.ts";
import {
  type DshDeps,
  type DshRuntime,
  ensureRefusalReceipt,
  ensureSessionHydrated,
  isDshStale,
  PENDING_CAUSE_TTL_MS,
  reportReceiptFailureOnce,
  sessionRuntime,
  shouldSuppressCompactionRequest,
} from "./runtime.ts";

// Single observer on `session/event` (post-commit feed). DSH has no stream
// to die, so unlike the opencode port there is no resubscribe bound:
// teardown is effect disposal. Failures are contained per event; the
// observer never throws into the host.
//
// Observed (all via the durable log, so exactly what landed in history):
// - tool/call + tool/result join by callId for the brain-update counter.
// - assistant/message usage for the refresh cold-cache check.
// - turn/end{completed} for trigger evaluation (failed/error turns never
//   compact — parity with opencode's succeeded-only subscription).
// - compaction/summary + compaction/end for receipts, failure backoff, and
//   the preamble-refresh pending flag.

export type TokenMeterLike = {
  measure(session: unknown): { readonly totalTokens: number };
  contextPressure(session: unknown): { readonly contextWindow?: number };
};

export type EventsDeps = DshDeps & {
  readonly config: ContextManagementConfig;
  // Resolved per evaluation, never cached here: the meter starts with the
  // session's agent scope, so an early miss must not pin the failure. Either
  // source suffices; absent both skips evaluation without stashing.
  readonly tokenMeter?: TokenMeterLike;
  // Optional per-project override: resolves the effective block for a
  // session project. Absent = profile block (pre-override behavior).
  readonly resolveConfig?: (projectDirectory: string) => Promise<ContextManagementConfig>;
  readonly meterForSession?: (sessionId: string) => TokenMeterLike | null;
};

export function registerSessionObservers(
  context: Context,
  deps: EventsDeps,
  runtime: DshRuntime,
): void {
  context.on("session/event", (session: unknown, event: unknown) => {
    void dispatchSessionEvent(session, event, deps, runtime).catch(() => undefined);
  });
}

type SessionRef = { readonly id: string };

function asSession(value: unknown): SessionRef | null {
  if (typeof value !== "object" || value === null || !("id" in value)) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" ? { id } : null;
}

type EventRef = { readonly type: string; readonly data: Record<string, unknown> };

function asEvent(value: unknown): EventRef | null {
  if (typeof value !== "object" || value === null || !("type" in value)) return null;
  const type = (value as Record<string, unknown>).type;
  if (typeof type !== "string") return null;
  const raw = (value as Record<string, unknown>).data;
  const data = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { type, data };
}

// Exported for tests. Unknown shapes (future event kinds, malformed
// payloads) are ignored, never fatal.
export async function dispatchSessionEvent(
  rawSession: unknown,
  rawEvent: unknown,
  deps: EventsDeps,
  runtime: DshRuntime,
): Promise<void> {
  if (isDshStale(deps)) return;
  const session = asSession(rawSession);
  const event = asEvent(rawEvent);
  if (session === null || event === null) return;

  switch (event.type) {
    case "tool/call": {
      const callId = typeof event.data.callId === "string" ? (event.data.callId as string) : null;
      const name = typeof event.data.name === "string" ? (event.data.name as string) : null;
      if (callId === null || name === null) return;
      sessionRuntime(runtime, session.id).pendingCallNames.set(callId, name);
      return;
    }
    case "tool/result": {
      const message = event.data.message;
      const toolCallId =
        typeof message === "object"
        && message !== null
        && "toolCallId" in message
        && typeof (message as Record<string, unknown>).toolCallId === "string"
          ? ((message as Record<string, unknown>).toolCallId as string)
          : null;
      if (toolCallId === null) return;
      sessionRuntime(runtime, session.id).completedCallIds.add(toolCallId);
      return;
    }
    case "assistant/message": {
      const message = event.data.message;
      const usage =
        typeof message === "object" && message !== null && "usage" in message
          ? ((message as Record<string, unknown>).usage as Record<string, unknown> | undefined)
          : undefined;
      if (usage === undefined || usage === null || typeof usage !== "object") return;
      const entry = sessionRuntime(runtime, session.id);
      const cacheRead = usage.cacheReadTokens;
      entry.lastStepCacheRead =
        typeof cacheRead === "number" && Number.isFinite(cacheRead) ? cacheRead : 0;
      return;
    }
    case "turn/end": {
      await handleTurnEnd(session.id, rawSession, event.data, deps, runtime);
      return;
    }
    case "compaction/summary": {
      // A summary landed; the checkpoint follows in compaction/end. Stash
      // the writer provenance for the end receipt's engine attribution —
      // the only record of which backend (vcc or basic) compiled.
      const provider = typeof event.data.provider === "string" ? event.data.provider : null;
      const model = typeof event.data.model === "string" ? event.data.model : null;
      if (provider !== null && model !== null) {
        sessionRuntime(runtime, session.id).lastCompactionSource = { provider, model };
      }
      return;
    }
    case "compaction/end": {
      await handleCompactionEnd(session.id, rawSession, event.data, deps, runtime).catch(
        () => undefined,
      );
      return;
    }
    default:
      return;
  }
}

async function handleTurnEnd(
  sessionId: string,
  rawSession: unknown,
  data: Record<string, unknown>,
  deps: EventsDeps,
  runtime: DshRuntime,
): Promise<void> {
  const reason = data.reason;
  const kind =
    typeof reason === "object" && reason !== null && "kind" in reason
      ? ((reason as Record<string, unknown>).kind as unknown)
      : null;
  if (kind !== "completed") return;
  const effectiveConfig = await effectiveContextConfig(deps, rawSession);
  if (!effectiveConfig.enabled) return;

  await ensureSessionHydrated(deps.stateDirectory, runtime, sessionId);
  if (isDshStale(deps)) return;

  if (!deps.isBrainAvailable(sessionId)) {
    await ensureRefusalReceipt(deps.stateDirectory, runtime, sessionId, deps);
    return;
  }

  // The meter resolves per evaluation and is never cached here: a miss
  // skips evaluation without stashing, so the next turn/end retries once
  // the agent scope has cached the service (self-healing on startup).
  const meter = deps.meterForSession?.(sessionId) ?? deps.tokenMeter ?? null;
  if (meter === null) return;

  // Host numbers are validated: one malformed reading must not poison the
  // session's estimate or receipts for its lifetime.
  let estimate: number;
  let window: number | null;
  try {
    estimate = meter.measure(rawSession).totalTokens;
    const rawWindow = meter.contextPressure(rawSession).contextWindow;
    if (!Number.isFinite(estimate)) return;
    window = rawWindow === undefined ? null : Number.isFinite(rawWindow) ? rawWindow : null;
  } catch {
    return;
  }

  const session = sessionRuntime(runtime, sessionId);
  session.lastEstimate = estimate;
  session.contextWindow = window;

  // Both candidate sets, sharing one dedup store (mirrors opencode's
  // per-request hook plus completion trigger, which share runtime state).
  // DSH has no per-request seam, so the turn-end observer evaluates both:
  // turn-end totals only grow within a turn, so nothing a per-request check
  // would catch is missed — enforcement is pre-step either way. Pressure
  // causes win on ties: they name the real reason.
  const triggerConfig = toTriggerConfig(effectiveConfig);
  const pressure = evaluateTrigger(
    session.triggerState,
    "request",
    estimate,
    window ?? 0,
    triggerConfig,
  );
  const complete = evaluateTrigger(
    pressure.state,
    "task-complete",
    estimate,
    window ?? 0,
    triggerConfig,
  );
  const decision = pressure.fire !== null ? pressure : complete;
  session.triggerState = decision.state;
  if (decision.fire === null) return;
  if (shouldSuppressCompactionRequest(session, estimate, window ?? 0, Date.now())) return;

  // Intent only. The cause is recorded by the pre-step enforcer at the
  // dispatch site: a stashed-but-never-enforced intent must never mislabel
  // a later host-initiated compaction. The stash expires on read.
  session.pendingCompaction = { cause: decision.fire, estimate, at: Date.now() };
}

async function handleCompactionEnd(
  sessionId: string,
  rawSession: unknown,
  data: Record<string, unknown>,
  deps: EventsDeps,
  runtime: DshRuntime,
): Promise<void> {
  const session = sessionRuntime(runtime, sessionId);
  const error = data.error;
  if (typeof error === "string" && error.length > 0) {
    // The summary stash is deliberately kept: a post-failure retry runs
    // under the same backend, so a later success without a fresh summary
    // still attributes correctly.
    if (session.lastEstimate !== null) {
      session.lastCompactionFailure = { at: Date.now(), estimate: session.lastEstimate };
    }
    session.pendingCompaction = null;
    return;
  }
  session.lastCompactionFailure = null;
  session.pendingCompaction = null;
  // The checkpoint rewrote history: refresh the preamble without gates.
  session.preambleRefreshPending = true;
  // Attribute the engine from the summary provenance stashed above: the VCC
  // backend reports its own provider route, anything else went through a
  // model summarizer. Consumed once, like the receipt cause.
  const source = session.lastCompactionSource;
  session.lastCompactionSource = null;
  const engine =
    source === null ? "unknown" : source.provider === "dsh-compaction-vcc" ? "vcc" : "shaped";

  // Price the receipt off a fresh host measurement: mid-turn pressure
  // compactions land before any turn/end evaluation, so lastEstimate may
  // still be null here. Best-effort; a failed read keeps the prior value.
  // The meter resolves per event like the turn/end path; a miss keeps the
  // prior estimate.
  const meter = deps.meterForSession?.(sessionId) ?? deps.tokenMeter ?? null;
  if (meter !== null) {
    try {
      const measured = meter.measure(rawSession).totalTokens;
      if (Number.isFinite(measured)) session.lastEstimate = measured;
    } catch {
      // Keep the prior estimate; the receipt below clamps regardless.
    }
  }

  // Best-effort audit trail. The cause is recorded by our own pre-step
  // enforcer; a host-initiated compaction (or a stale entry from a
  // stashed-but-never-enforced intent past its TTL) is labeled manual.
  // Receipts gate on the session project's effective config.
  if (!(await effectiveContextConfig(deps, rawSession)).enabled) return;
  const pending = runtime.pendingCauses.get(sessionId);
  const cause =
    pending !== undefined && Date.now() - pending.at <= PENDING_CAUSE_TTL_MS
      ? pending.cause
      : "manual";
  runtime.pendingCauses.delete(sessionId);
  const written = await appendReceipt(join(deps.stateDirectory, "context-log"), sessionId, {
    kind: "compact",
    trigger: cause,
    at: new Date().toISOString(),
    summarized: Math.max(0, session.lastEstimate ?? 0),
    engine,
    summaryTokens: null,
  });
  if (!written.ok) reportReceiptFailureOnce(runtime, deps, sessionId, "compact");
}

export function reportEventStreamFailure(runtime: DshRuntime, deps: EventsDeps): void {
  reportReceiptFailureOnce(runtime, deps, null, "event-stream");
}

// Effective context-management block for this session: the session
// project's override merged over the profile block, or the profile block
// when no resolver is wired (tests, pre-override callers) or the session
// carries no cwd. Never rejects: IO failures fall back to the profile.
async function effectiveContextConfig(
  deps: EventsDeps,
  rawSession: unknown,
): Promise<ContextManagementConfig> {
  if (deps.resolveConfig === undefined) return deps.config;
  const cwd = readSessionCwd(rawSession);
  if (cwd === null) return deps.config;
  try {
    return await deps.resolveConfig(cwd);
  } catch {
    return deps.config;
  }
}

function readSessionCwd(session: unknown): string | null {
  if (typeof session !== "object" || session === null) return null;
  const header = (session as Record<string, unknown>).header;
  if (typeof header !== "object" || header === null) return null;
  const cwd = (header as Record<string, unknown>).cwd;
  return typeof cwd === "string" ? cwd : null;
}
