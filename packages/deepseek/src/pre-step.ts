import type { Context } from "@deepseek-ai/cordis";
import type { PreStepDecision } from "@deepseek-ai/dsh-agent";
import type { ContextManagementConfig } from "./config.ts";
import {
  type DshDeps,
  type DshRuntime,
  isDshStale,
  PENDING_CAUSE_TTL_MS,
  sessionRuntime,
  shouldSuppressCompactionRequest,
} from "./runtime.ts";

// Loop-timed enforcement on `agent/pre-step`. DSH offers no anytime
// admission: `compactNow` outside an idle window throws `busy` (proven live),
// so the turn/end observer only stashes intent and the actual request fires
// here, inside the loop's own step boundary — the same hook the host's
// `compaction-basic` backend uses for its pressure path. The host policy
// stays authoritative: our call goes through `ctx.compaction.compactIfNeeded`
// (or `compactNow` when idle), single-flight per session, with the failure
// backoff consulted before every attempt. When no compaction service is
// reachable from any scope, the last resort drives the user-facing `/compact`
// command through the host's own dispatch (`commands.execute`) — the same
// handler manual `/compact` uses, with its `command/run` + `command/done`
// lifecycle appended like a typed invocation.

export type CompactionService = {
  compactIfNeeded(agent: unknown, trigger: "pressure", signal: AbortSignal): Promise<unknown>;
};

export type CommandExecution = {
  readonly result: { readonly kind: string };
};

export type CommandsService = {
  execute(
    agent: unknown,
    line: string,
    attachments: readonly unknown[],
    signal: AbortSignal,
  ): Promise<CommandExecution | undefined>;
};

export type PreStepDeps = DshDeps & {
  readonly config: ContextManagementConfig;
  // Resolved per enforcement attempt, not cached: the backend starts on
  // first use, so an early miss must not pin the failure. Absent =
  // unenforced with the stash left intact for the next step.
  readonly compaction?: CompactionService;
  readonly compactionForAgent?: (agent: unknown) => CompactionService | null;
  // Last-resort enforcement when no compaction service resolves: drives
  // `/compact` through the host command dispatch. Same miss semantics:
  // absent leaves the stash intact for the next step.
  readonly commands?: CommandsService;
  readonly commandsForAgent?: (agent: unknown) => CommandsService | null;
  // Optional per-project override: resolves the effective block for an
  // agent project. Absent = profile block (pre-override behavior).
  readonly resolveConfig?: (projectDirectory: string) => Promise<ContextManagementConfig>;
};

export function registerLoopEnforcement(
  context: Context,
  deps: PreStepDeps,
  runtime: DshRuntime,
): void {
  context.on(
    "agent/pre-step",
    async (
      payload: { readonly agent: unknown; readonly signal: AbortSignal },
      next: () => Promise<PreStepDecision>,
    ): Promise<PreStepDecision> => {
      const effective = await effectiveContextConfig(deps, payload.agent);
      if (!effective.enabled) return next();
      await maybeEnforceCompaction(payload, { ...deps, config: effective }, runtime, Date.now(), {
        allowCommandFallback: false,
      }).catch(() => undefined);
      return next();
    },
  );
  // Idle-timed fallback: `compactNow` (behind the `/compact` dispatch)
  // refuses mid-loop agents, so the command path can only run here, when
  // the driver is down. Same gates, same single-flight and backoff — the
  // only difference is the command fallback is allowed. Never throws into
  // the host; a missed agent shape simply does nothing.
  context.on("agent/status", (payload: unknown) => {
    void (async () => {
      try {
        const update = readStatusUpdate(payload);
        if (update.agent === null || update.status !== "idle") return;
        const effective = await effectiveContextConfig(deps, update.agent);
        if (!effective.enabled) return;
        await maybeEnforceCompaction(
          { agent: update.agent, signal: new AbortController().signal },
          { ...deps, config: effective },
          runtime,
          Date.now(),
          { allowCommandFallback: true },
        ).catch(() => undefined);
      } catch {
        // Never break the host for enforcement.
      }
    })();
  });
}

// Effective block for this agent's project. Never rejects: IO failures
// fall back to the profile block.
async function effectiveContextConfig(
  deps: PreStepDeps,
  agent: unknown,
): Promise<ContextManagementConfig> {
  if (deps.resolveConfig === undefined) return deps.config;
  try {
    return await deps.resolveConfig(readAgentCwd(agent));
  } catch {
    return deps.config;
  }
}

function readAgentCwd(agent: unknown): string {
  if (typeof agent !== "object" || agent === null) return process.cwd();
  const session = (agent as Record<string, unknown>).session;
  if (typeof session !== "object" || session === null) return process.cwd();
  const header = (session as Record<string, unknown>).header;
  if (typeof header !== "object" || header === null) return process.cwd();
  const cwd = (header as Record<string, unknown>).cwd;
  return typeof cwd === "string" ? cwd : process.cwd();
}

// Exported for tests. Callers pass the clock explicitly (no default args).
// The command fallback runs only when the caller allows it: `compactNow`
// (behind the `/compact` dispatch) refuses mid-loop agents, so pre-step
// callers pass false and idle callers pass true.
export async function maybeEnforceCompaction(
  payload: unknown,
  deps: PreStepDeps,
  runtime: DshRuntime,
  now: number,
  options: { readonly allowCommandFallback: boolean },
): Promise<boolean> {
  if (isDshStale(deps)) return false;
  const agent = readAgent(payload);
  const signal = readSignal(payload);
  if (agent === null || signal === null || signal.aborted) return false;
  const sessionId = readSessionId(agent);
  if (sessionId === null) return false;

  // Services resolve per attempt and are never pinned: a miss leaves the
  // stash untouched so the next step retries (self-healing once the backend
  // starts). Only a real attempt clears intent; TTL expiry is time-based
  // hygiene. The shared gates run before either service resolves so both
  // paths stay under the same single-flight, availability, and backoff
  // discipline.
  const session = sessionRuntime(runtime, sessionId);
  const pending = session.pendingCompaction;
  if (pending === null) return false;
  if (now - pending.at > PENDING_CAUSE_TTL_MS) {
    session.pendingCompaction = null;
    return false;
  }
  if (session.compactionInFlight) return false;
  if (!deps.isBrainAvailable(sessionId)) return false;
  // Failure backoff is consulted at dispatch, not only at stash time: a
  // host-reported failure between the stash and this step suppresses the
  // re-request until the cooldown passes and real growth resumes.
  if (shouldSuppressCompactionRequest(session, pending.estimate, session.contextWindow ?? 0, now)) {
    return false;
  }

  // The cause is recorded at this dispatch site: a rejected call leaves no
  // entry, so a later host-initiated compaction is still labeled manual.
  // Recorded BEFORE the attempt, not after success: the receipt is written
  // when the compaction/end event lands, which can precede the attempt's
  // own resolution. Every non-success path below deletes the entry, and
  // receipt reads expire stale ones, so a never-executed intent still
  // cannot mislabel a later host-initiated compaction.
  // The outstanding-request guard keeps one in-flight attempt per session.
  session.compactionInFlight = true;
  try {
    const compaction = deps.compactionForAgent?.(agent) ?? deps.compaction ?? null;
    if (compaction !== null) {
      runtime.pendingCauses.set(sessionId, { cause: pending.cause, at: now });
      const result = await compaction.compactIfNeeded(agent, "pressure", signal);
      if (result === null) runtime.pendingCauses.delete(sessionId);
      session.pendingCompaction = null;
      return result !== null;
    }
    // Last resort: no compaction service is reachable from any scope, so
    // drive `/compact` through the host's own command dispatch — the same
    // handler a manual invocation uses. Idle callers only: the backend
    // refuses mid-loop agents, so a pre-step caller never reaches this.
    const commands = options.allowCommandFallback
      ? (deps.commandsForAgent?.(agent) ?? deps.commands ?? null)
      : null;
    if (commands === null) return false;
    runtime.pendingCauses.set(sessionId, { cause: pending.cause, at: now });
    const execution = await commands.execute(agent, "/compact", [], signal);
    // Unknown command: admission misses log nothing, so drop the cause
    // entry but leave the stash — a later composition with /compact still
    // enforces.
    if (execution === undefined) {
      runtime.pendingCauses.delete(sessionId);
      return false;
    }
    if (execution.result.kind !== "success") {
      // Command-reported failure (busy, cancelled): drop the cause entry,
      // arm the backoff like a dispatch throw so pre-steps don't hot-loop,
      // and drop the intent.
      runtime.pendingCauses.delete(sessionId);
      if (session.lastEstimate !== null) {
        session.lastCompactionFailure = { at: now, estimate: session.lastEstimate };
      }
      session.pendingCompaction = null;
      return false;
    }
    session.pendingCompaction = null;
    return true;
  } catch {
    // A throw produces no compaction/end event, so no backoff would ever
    // arm: record the failure at the stashed estimate so the next trigger
    // re-evaluates under the cooldown instead of hot-looping pre-steps.
    // The cause entry is dropped: nothing executed, so a later host
    // compaction must stay labeled manual.
    runtime.pendingCauses.delete(sessionId);
    if (session.lastEstimate !== null) {
      session.lastCompactionFailure = { at: now, estimate: session.lastEstimate };
    }
    session.pendingCompaction = null;
    return false;
  } finally {
    session.compactionInFlight = false;
  }
}

function readAgent(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return null;
  return (payload as Record<string, unknown>).agent ?? null;
}

// Status payloads are flat `{ agent, status }` (host contract); a single
// envelope level is tolerated for forward compatibility. Unknown shapes
// yield a null agent, which the caller skips.
function readStatusUpdate(payload: unknown): { agent: unknown; status: unknown } {
  if (typeof payload !== "object" || payload === null) return { agent: null, status: null };
  const record = payload as Record<string, unknown>;
  const agent = record.agent;
  const unwrapped =
    typeof agent === "object" && agent !== null && "agent" in agent
      ? (agent as Record<string, unknown>).agent
      : agent;
  return { agent: unwrapped ?? null, status: record.status ?? null };
}

function readSignal(payload: unknown): AbortSignal | null {
  if (typeof payload !== "object" || payload === null) return null;
  const signal = (payload as Record<string, unknown>).signal;
  return signal instanceof AbortSignal ? signal : null;
}

function readSessionId(agent: unknown): string | null {
  if (typeof agent !== "object" || agent === null) return null;
  const session = (agent as Record<string, unknown>).session;
  if (typeof session !== "object" || session === null) return null;
  const id = (session as Record<string, unknown>).id;
  return typeof id === "string" ? id : null;
}
