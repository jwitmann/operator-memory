import { join } from "node:path";
import {
  type BrainUpdateActivityState,
  EMPTY_BRAIN_UPDATE_ACTIVITY_STATE,
} from "@jwitmann/operator-core/brain-updates";
import { appendReceipt, readReceipts } from "@jwitmann/operator-core/context/receipts";
import {
  dedupDeltaTokens,
  EMPTY_TRIGGER_STATE,
  type TriggerKind,
  type TriggerState,
} from "@jwitmann/operator-core/context/triggers";

// DSH-native per-session runtime. Unlike the opencode port (which anchors a
// hand-rolled token estimator on step events), pressure estimates come from
// the host's `ctx.tokenMeter`: `measure(session).totalTokens` for trigger
// evaluation and `contextPressure().contextWindow` for the model window.
// Only bookkeeping lives here; measurement stays host-owned.

export type SessionRuntime = {
  triggerState: TriggerState;
  // Latest host-measured pressure and the window it was priced against.
  lastEstimate: number | null;
  contextWindow: number | null;
  // Latest provider usage totals observed on assistant/message, for the
  // refresh cold-cache check.
  lastStepCacheRead: number | null;
  // Tool-call pairing: names from tool/call, completion from tool/result.
  // A completed unit is a callId present in both with a non-operator name.
  pendingCallNames: Map<string, string>;
  completedCallIds: Set<string>;
  // Compaction intent stashed by the turn/end observer, consumed once by the
  // agent/pre-step enforcer (compactNow needs an idle agent, so the observer
  // itself must never compact).
  pendingCompaction: {
    readonly cause: TriggerKind;
    readonly estimate: number;
    readonly at: number;
  } | null;
  // Single-flight guard for in-flight pre-step compactions.
  compactionInFlight: boolean;
  // Last host-reported failed compaction, for failure backoff.
  lastCompactionFailure: { at: number; estimate: number } | null;
  // Canonical preamble fingerprint; null until the first render seeds it.
  preambleFingerprint: string | null;
  // Set when compaction lands: the next preamble check refreshes without
  // the cold-cache and estimate-floor gates.
  preambleRefreshPending: boolean;
  // Brain-update activity for this session (fingerprint era + threshold).
  brainUpdateActivity: BrainUpdateActivityState;
  // Provenance of the last compaction summary event (`compaction/summary`
  // carries the provider route and model that wrote it), consumed once by
  // the compaction-end receipt to attribute the engine. Null when no
  // summary has been observed yet this process.
  lastCompactionSource: { readonly provider: string; readonly model: string } | null;
};

export type DshRuntime = {
  readonly sessions: Map<string, SessionRuntime>;
  readonly refusals: Set<string>;
  readonly reportedReceiptFailures: Set<string>;
  readonly hydrated: Set<string>;
  // Compaction causes recorded by our own enforcer, consumed once for the
  // receipt label. Entries expire so a requested-but-never-executed
  // compaction cannot mislabel a far-future host-initiated one.
  readonly pendingCauses: Map<string, PendingCause>;
};

export type PendingCause = {
  readonly cause: TriggerKind;
  readonly at: number;
};

export type ReceiptFailureKind =
  | "trim"
  | "compact"
  | "refusal"
  | "refresh"
  | "brain-reminder"
  | "event-stream";

export const PENDING_CAUSE_TTL_MS = 10 * 60 * 1000;
export const FAILED_COMPACTION_COOLDOWN_MS = 10 * 60 * 1000;

export type DshDeps = {
  readonly stateDirectory: string;
  readonly isBrainAvailable: (sessionId: string) => boolean;
  readonly reportReceiptFailure: (sessionId: string | null, kind: ReceiptFailureKind) => void;
  readonly isCurrent?: () => boolean;
};

export function isDshStale(deps: Pick<DshDeps, "isCurrent">): boolean {
  return deps.isCurrent !== undefined && !deps.isCurrent();
}

export function createDshRuntime(): DshRuntime {
  return {
    sessions: new Map(),
    refusals: new Set(),
    reportedReceiptFailures: new Set(),
    hydrated: new Set(),
    pendingCauses: new Map(),
  };
}

const SHARED_RUNTIME_KEY = "__operatorDshRuntime";

function readSharedRuntime(): DshRuntime | null {
  const existing = (globalThis as Record<string, unknown>)[SHARED_RUNTIME_KEY];
  if (typeof existing !== "object" || existing === null) return null;
  const record = existing as Record<string, unknown>;
  // Cross-version guard: a stale global from an older bundle shape is
  // discarded instead of adopted. All five collections are required.
  if (
    !(record.sessions instanceof Map)
    || !(record.refusals instanceof Set)
    || !(record.reportedReceiptFailures instanceof Set)
    || !(record.hydrated instanceof Set)
    || !(record.pendingCauses instanceof Map)
  ) {
    return null;
  }
  return existing as DshRuntime;
}

export function sharedDshRuntime(): DshRuntime {
  const existing = readSharedRuntime();
  if (existing !== null) return existing;
  const created = createDshRuntime();
  (globalThis as Record<string, unknown>)[SHARED_RUNTIME_KEY] = created;
  return created;
}

export function sessionRuntime(runtime: DshRuntime, sessionId: string): SessionRuntime {
  const existing = runtime.sessions.get(sessionId);
  if (existing !== undefined) {
    const legacy = existing as unknown as {
      lastCompactionFailure?: unknown;
      lastCompactionSource?: unknown;
    };
    if (legacy.lastCompactionFailure === undefined) existing.lastCompactionFailure = null;
    if (legacy.lastCompactionSource === undefined) existing.lastCompactionSource = null;
    return existing;
  }
  const created: SessionRuntime = {
    triggerState: EMPTY_TRIGGER_STATE,
    lastEstimate: null,
    contextWindow: null,
    lastStepCacheRead: null,
    pendingCallNames: new Map(),
    completedCallIds: new Set(),
    pendingCompaction: null,
    compactionInFlight: false,
    lastCompactionFailure: null,
    preambleFingerprint: null,
    preambleRefreshPending: false,
    brainUpdateActivity: EMPTY_BRAIN_UPDATE_ACTIVITY_STATE,
    lastCompactionSource: null,
  };
  runtime.sessions.set(sessionId, created);
  return created;
}

// Counts completed tool work for this session: callIds with both a recorded
// call and a recorded result, excluding Operator's own namespace. Error
// results count: a failure can still produce a durable lesson.
export function countSessionCompletedCalls(
  session: Pick<SessionRuntime, "pendingCallNames" | "completedCallIds">,
): number {
  let count = 0;
  for (const callId of session.completedCallIds) {
    const name = session.pendingCallNames.get(callId);
    if (name !== undefined && !isOperatorTool(name)) count += 1;
  }
  return count;
}

function isOperatorTool(name: string): boolean {
  return name === "operator" || name.startsWith("operator-");
}

// Failure backoff: a fresh failure suppresses unconditionally; past the
// cooldown only real growth past the failure point re-arms.
export function shouldSuppressCompactionRequest(
  session: Pick<SessionRuntime, "lastCompactionFailure">,
  estimatedTokens: number,
  windowTokens: number,
  now: number,
): boolean {
  const failure = session.lastCompactionFailure;
  if (failure === null) return false;
  if (now - failure.at <= FAILED_COMPACTION_COOLDOWN_MS) return true;
  return estimatedTokens - failure.estimate < dedupDeltaTokens(windowTokens);
}

export async function ensureSessionHydrated(
  stateDirectory: string,
  runtime: DshRuntime,
  sessionId: string,
): Promise<void> {
  if (runtime.hydrated.has(sessionId)) return;
  const receipts = await readReceipts(join(stateDirectory, "context-log"), sessionId);
  if (!receipts.ok) return;
  const session = sessionRuntime(runtime, sessionId);
  const fired: Partial<Record<TriggerKind, number>> = {};
  for (const receipt of receipts.value) {
    if (receipt.kind === "refusal") {
      runtime.refusals.add(sessionId);
    } else if (receipt.kind === "trim") {
      fired[receipt.trigger] = receipt.tokens;
    } else if (receipt.kind === "compact" && receipt.trigger !== "manual") {
      fired[receipt.trigger] = receipt.summarized;
    }
  }
  session.triggerState = { fired: { ...fired, ...session.triggerState.fired } };
  runtime.hydrated.add(sessionId);
}

export async function ensureRefusalReceipt(
  stateDirectory: string,
  runtime: DshRuntime,
  sessionId: string,
  deps: Pick<DshDeps, "reportReceiptFailure" | "isCurrent">,
): Promise<void> {
  if (runtime.refusals.has(sessionId)) return;
  runtime.refusals.add(sessionId);
  const written = await appendReceipt(join(stateDirectory, "context-log"), sessionId, {
    kind: "refusal",
    at: new Date().toISOString(),
    reason: "brain-unavailable",
  });
  if (!written.ok) reportReceiptFailureOnce(runtime, deps, sessionId, "refusal");
}

export function reportReceiptFailureOnce(
  runtime: DshRuntime,
  deps: Pick<DshDeps, "reportReceiptFailure" | "isCurrent">,
  sessionId: string | null,
  kind: ReceiptFailureKind,
): void {
  if (isDshStale(deps)) return;
  const key = sessionId === null ? `null:${kind}` : sessionId;
  if (runtime.reportedReceiptFailures.has(key)) return;
  runtime.reportedReceiptFailures.add(key);
  deps.reportReceiptFailure(sessionId, kind);
}
