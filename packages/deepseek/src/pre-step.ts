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
// backoff consulted before every attempt.

export type PreStepDeps = DshDeps & {
  readonly config: ContextManagementConfig;
  readonly compaction: {
    compactIfNeeded(agent: unknown, trigger: "pressure", signal: AbortSignal): Promise<unknown>;
  };
  // Optional per-project override: resolves the effective block for an
  // agent project. Absent = profile block (pre-override behavior).
  readonly resolveConfig?: (projectDirectory: string) => Promise<ContextManagementConfig>;
};

export function registerPreStepEnforcement(
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
      await maybeEnforceCompaction(
        payload,
        { ...deps, config: effective },
        runtime,
        Date.now(),
      ).catch(() => undefined);
      return next();
    },
  );
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
export async function maybeEnforceCompaction(
  payload: unknown,
  deps: PreStepDeps,
  runtime: DshRuntime,
  now: number,
): Promise<boolean> {
  if (isDshStale(deps)) return false;
  const agent = readAgent(payload);
  const signal = readSignal(payload);
  if (agent === null || signal === null || signal.aborted) return false;
  const sessionId = readSessionId(agent);
  if (sessionId === null) return false;

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
  // The outstanding-request guard keeps one in-flight attempt per session.
  session.compactionInFlight = true;
  try {
    const result = await deps.compaction.compactIfNeeded(agent, "pressure", signal);
    if (result !== null) {
      runtime.pendingCauses.set(sessionId, { cause: pending.cause, at: now });
    }
    session.pendingCompaction = null;
    return result !== null;
  } catch {
    // A throw produces no compaction/end event, so no backoff would ever
    // arm: record the failure at the stashed estimate so the next trigger
    // re-evaluates under the cooldown instead of hot-looping pre-steps.
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
