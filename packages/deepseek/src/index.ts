import { homedir } from "node:os";
import { join } from "node:path";
import { loadMemorySnapshot } from "@aerovato/operator-core/memory/load";
import { renderPreamble } from "@aerovato/operator-core/preamble";
import { fingerprintPreamble } from "@aerovato/operator-core/preamble-refresh";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { maybeAppendBrainUpdateReminder } from "./brain-updates.ts";
import { registerCommands } from "./commands.ts";
import { DEFAULT_OPERATOR_DEEPSEEK_CONFIG, parseOperatorConfig } from "./config.ts";
import { registerSessionObservers, type TokenMeterLike } from "./events.ts";
import {
  registerLoopEnforcement,
  type CommandsService,
  type CompactionService,
} from "./pre-step.ts";
import { cachedProjectConfig, resolveProjectConfig } from "./project-config.ts";
import { maybeRefreshPreamble } from "./refresh.ts";
import {
  sessionRuntime,
  sharedDshRuntime,
  type DshRuntime,
  type ReceiptFailureKind,
} from "./runtime.ts";
import { DEFAULT_BRAIN_PATHS, registerCompactionShaping } from "./shaping.ts";

/** Cordis plugin name used by DeepSeek Harness diagnostics. */
export const name = "operator-memory";

/** Service required for asynchronous system-prompt contribution. */
export const inject = ["systemPrompt"];

/**
 * Start the Operator Host plugin for this DeepSeek Harness runtime.
 *
 * @param context - plugin context; `tokenMeter` and `compaction` are read
 * defensively (optional services) so the preamble-only baseline works on
 * profiles without them.
 * @param rawConfig - validated plugin config from the profile patch layer.
 * Every feature defaults OFF; absent config behaves exactly like the
 * preamble-only adapter.
 */
export function apply(context: Context, rawConfig?: unknown): void {
  const parsed = parseOperatorConfig(rawConfig ?? null);
  if (!parsed.ok) {
    try {
      context.logger?.warn?.(`operator-memory: ignoring invalid config: ${parsed.error.message}`);
    } catch {
      // Logging must never break plugin startup.
    }
  }
  const config = parsed.ok ? parsed.value : DEFAULT_OPERATOR_DEEPSEEK_CONFIG;

  // Service handles captured from whatever layer exposes them (the joint
  // `["tokenMeter", "compaction"]` inject never fires in the TUI
  // composition — proven live). Declared before any inject registration:
  // inject callbacks can run synchronously when the service already exists.
  const rootServices: {
    meter: TokenMeterLike | null;
    compaction: CompactionService | null;
    commands: CommandsService | null;
  } = { meter: null, compaction: null, commands: null };
  context.inject(["commands"], (scoped: Context) => {
    // The `/compact` backend lives in command scope (proven live: manual
    // `/compact` works while agent-scope reads miss everywhere). Capture
    // both the backend and the command dispatch from this same layer: the
    // dispatch is the last-resort enforcement path when the backend stays
    // unreachable from every plugin-visible scope.
    try {
      const service = (scoped as unknown as { compaction?: unknown }).compaction;
      if (isCompactionServiceLike(service)) rootServices.compaction = service;
    } catch {
      // Absent here; per-agent resolution still applies.
    }
    try {
      const commands = (scoped as unknown as { commands?: unknown }).commands;
      if (isCommandsLike(commands)) rootServices.commands = commands;
    } catch {
      // Absent here; the agent-scope read below still applies.
    }
    registerCommands(scoped);
  });

  const stateDirectory = join(homedir(), ".operator", "state");
  const runtime: DshRuntime = sharedDshRuntime();
  const brainAvailable = new Map<string, boolean>();
  const isBrainAvailable = (sessionId: string): boolean => brainAvailable.get(sessionId) === true;

  const reportReceiptFailure = (sessionId: string | null, kind: ReceiptFailureKind): void => {
    try {
      context.logger?.warn?.(
        `operator-memory: context log write failed (${kind}) for session ${sessionId}.`,
      );
    } catch {
      // Never break the hot path for observability.
    }
  };
  const baseDeps = { stateDirectory, isBrainAvailable, reportReceiptFailure };

  const warn = (message: string): void => {
    try {
      context.logger?.warn?.(message);
    } catch {
      // Logging must never break the hot path.
    }
  };
  // Per-project override: `<project>/.operator/config.json` merges over the
  // profile config (absent file = profile). Total: IO failures fall back
  // silently, parse failures warn once per content inside the resolver.
  const resolveEffectiveConfig = (projectDirectory: string) =>
    resolveProjectConfig(projectDirectory, config, warn).catch(() => config);
  // Session cwd map for the synchronous shaping hook, which cannot do IO and
  // reads the mtime cache warmed by the async sites.
  const sessionCwds = new Map<string, string>();

  // Preamble injection with refresh + brain-update nudge. One Brain load per
  // agent render: availability is derived from the same snapshot, never a
  // second load. The per-agent render cache preserves the existing baseline;
  // refresh bypasses it with a genuinely fresh render only when the
  // fingerprint moved under its gates. Brain availability is tracked per
  // session from these loads and gates every other feature (fail closed).
  //
  // A rejected render is never cached: the entry is evicted and the section
  // is skipped with a diagnostic warn, so one transient IO failure cannot
  // permanently kill the section for the agent's lifetime.
  const renders = new WeakMap<Agent, Promise<{ text: string; available: boolean }>>();
  context.on("system-prompt/assemble", async (assembly, { agent }, next) => {
    if (agent === undefined) return next();

    let rendered: { text: string; available: boolean };
    try {
      const pending = renders.get(agent) ?? renderAgentPreamble(agent);
      renders.set(agent, pending);
      rendered = await pending;
    } catch (error) {
      renders.delete(agent);
      try {
        context.logger?.warn?.(
          `operator-memory: preamble render failed, skipping section: ${String(error).slice(0, 200)}`,
        );
      } catch {
        // Logging must never break prompt assembly.
      }
      return next();
    }
    let text = rendered.text;
    const sessionId = readAgentSessionId(agent);
    const projectDirectory = readAgentCwd(agent);

    if (sessionId !== null) {
      brainAvailable.set(sessionId, rendered.available);
      sessionCwds.set(sessionId, projectDirectory);
    }

    // Effective config for this session's project: the profile config with
    // the project's `.operator/config.json` merged over it. One stat when
    // unchanged, re-parse only on content moves.
    const effective = await resolveEffectiveConfig(projectDirectory);

    // One fingerprint per assemble, shared by the refresh seed below plus
    // both consumers. Without this the cycle pays up to three full
    // fingerprint passes (≈60–80 sequential stats each). `null` means the
    // shared computation failed — both consumers stay idle on it without
    // re-statting. Computed whenever either consumer is enabled (even when
    // the Brain is unavailable) so the refresh baseline seeds exactly as
    // before; the consumers still gate on availability themselves.
    let sharedFingerprint: string | null | undefined;
    if (
      sessionId !== null
      && (effective.preambleRefresh.enabled || effective.brainUpdates.enabled)
    ) {
      const fingerprinted = await fingerprintPreamble(projectDirectory, homedir()).catch(
        () => null,
      );
      if (fingerprinted?.ok) {
        sharedFingerprint = fingerprinted.value;
        const entry = sessionRuntime(runtime, sessionId);
        if (entry.preambleFingerprint === null) {
          entry.preambleFingerprint = fingerprinted.value;
        }
      } else {
        sharedFingerprint = null;
      }
    }

    if (effective.preambleRefresh.enabled && sessionId !== null) {
      const outcome = await maybeRefreshPreamble(
        {
          config: effective.preambleRefresh,
          stateDirectory,
          isBrainAvailable,
          reportReceiptFailure,
        },
        runtime,
        sessionId,
        projectDirectory,
        homedir(),
        async () => {
          renders.delete(agent);
          try {
            const fresh = await renderAgentPreamble(agent);
            renders.set(agent, Promise.resolve(fresh));
            if (sessionId !== null) brainAvailable.set(sessionId, fresh.available);
            return { ok: true, content: fresh.text };
          } catch {
            return { ok: false, content: "" };
          }
        },
        sharedFingerprint,
      ).catch((): { refreshed: false; failed: true } => ({ refreshed: false, failed: true }));
      if (outcome.refreshed) text = outcome.content;
    }

    if (effective.brainUpdates.enabled && sessionId !== null) {
      text = await maybeAppendBrainUpdateReminder(
        {
          config: effective.brainUpdates,
          projectDirectory,
          homeDirectory: homedir(),
          isBrainAvailable,
        },
        runtime,
        sessionId,
        text,
        sharedFingerprint,
      ).catch(() => text);
    }

    assembly.sections.unshift({
      name: "operator:memory",
      text,
      interpolate: false,
    });
    return next();
  });

  // Host-metered features (trigger evaluation, loop-timed enforcement)
  // register unconditionally on the root context: the joint scoped inject
  // `["tokenMeter", "compaction"]` never fires in the TUI composition (proven
  // live — the callback is dead there), while per-agent resolution reaches
  // the meter. Services resolve per session/agent below, so minimal profiles
  // without them keep the preamble-only baseline instead of failing to
  // activate. Direct property access would throw without inject (proven
  // live); the agent-scope `get` is the host-blessed read.
  //
  // Proven live in dsh-tui: `agent.ctx.get("tokenMeter")` is present per
  // agent, `agent.ctx.get("compaction")` is absent everywhere reachable
  // (agent ctx, scope, loopCtx), `/compact` works (the backend is alive in
  // command scope). So the meter caches per agent and both enforcement
  // paths resolve per attempt: cached agent service, live agent-scope read,
  // then the command-scope capture — with the `/compact` command dispatch
  // as the last resort. Misses leave the stash intact for the next step
  // (self-healing once the backend starts).
  const agentMeters = new Map<string, TokenMeterLike>();
  const agentCompactions = new Map<string, CompactionService>();
  // Agent scopes for live-read recovery: an agent created before plugin
  // registration (reload, resumed session) never fires `agent/created`
  // under us, so its ctx must be readable at evaluation time, not only at
  // creation time. Never holds the agent itself — just the scope.
  const agentContexts = new Map<string, { get: (name: string) => unknown }>();
  // Single-service captures at whatever layer exposes them; each fires
  // independently (unlike the dead joint inject). Callback bodies guard
  // their reads: a host scope may invoke without the service present.
  try {
    context.inject(["tokenMeter"], (scoped: Context) => {
      try {
        const meter = (scoped as unknown as { tokenMeter: unknown }).tokenMeter;
        if (isTokenMeterLike(meter)) rootServices.meter = meter;
      } catch {
        // Miss stays null; per-agent resolution still applies.
      }
    });
  } catch {
    // Logging must never break plugin startup.
  }
  try {
    context.inject(["compaction"], (scoped: Context) => {
      try {
        const service = (scoped as unknown as { compaction: unknown }).compaction;
        if (isCompactionServiceLike(service)) rootServices.compaction = service;
      } catch {
        // Miss stays null; per-agent resolution still applies.
      }
    });
  } catch {
    // Logging must never break plugin startup.
  }
  // Per-agent service cache. The payload is the `{ agent, source, signal }`
  // envelope; a bare agent is accepted for forward tolerance. Never throws
  // into the host; a miss simply leaves the session uncached for live-read
  // fallback at evaluation time.
  try {
    context.on("agent/created", (payload: unknown) => {
      try {
        const envelope = (payload ?? {}) as Record<string, unknown>;
        const raw = envelope.agent ?? payload;
        if (typeof raw !== "object" || raw === null) return;
        const record = raw as Record<string, unknown>;
        const id = readRecordSessionId(record);
        if (id === null) return;
        const ctx = record.ctx as { get?: (name: string) => unknown } | null;
        if (ctx === null || typeof ctx !== "object" || typeof ctx.get !== "function") return;
        boundedSet(agentContexts, id, ctx as { get: (name: string) => unknown });
        try {
          const meter = ctx.get("tokenMeter");
          if (isTokenMeterLike(meter)) boundedSet(agentMeters, id, meter);
        } catch {
          // One unreadable scope must not block the other.
        }
        try {
          const service = ctx.get("compaction");
          if (isCompactionServiceLike(service)) boundedSet(agentCompactions, id, service);
        } catch {
          // Absent backend here; the command-scope capture may still cover it.
        }
      } catch {
        // Never break the host for a cache miss.
      }
    });
  } catch {
    // The cache is an optimization; live reads below still apply.
  }
  // Session teardown eviction: a long-lived TUI creates one cache entry per
  // session, so drops keep the maps bounded alongside the FIFO cap below.
  try {
    context.on("agent/disposed", (payload: unknown) => {
      try {
        const envelope = (payload ?? {}) as Record<string, unknown>;
        const raw = envelope.agent ?? payload;
        if (typeof raw !== "object" || raw === null) return;
        const id = readRecordSessionId(raw as Record<string, unknown>);
        if (id === null) return;
        agentMeters.delete(id);
        agentCompactions.delete(id);
        agentContexts.delete(id);
      } catch {
        // Never break the host for cache hygiene.
      }
    });
  } catch {
    // The FIFO cap still bounds growth without disposal events.
  }
  const compactionForAgent = (agent: unknown): CompactionService | null => {
    if (typeof agent === "object" && agent !== null) {
      const record = agent as Record<string, unknown>;
      const id = readRecordSessionId(record);
      if (id !== null) {
        const cached = agentCompactions.get(id);
        if (cached !== undefined) return cached;
      }
      // Live read: the backend starts on first use, so an agent created
      // before startup must not pin a miss into the cache.
      const ctx = record.ctx as { get?: (name: string) => unknown } | null;
      if (ctx !== null && typeof ctx === "object" && typeof ctx.get === "function") {
        try {
          const service = ctx.get("compaction");
          if (isCompactionServiceLike(service)) {
            if (id !== null) boundedSet(agentCompactions, id, service);
            return service;
          }
        } catch {
          // Fall through to the root capture.
        }
      }
    }
    return rootServices.compaction;
  };
  // Command dispatch resolves the same way: live agent-scope read, then the
  // command-scope capture. No per-session cache — the dispatch object is
  // composition-wide, so a fresh read each attempt is cheapest.
  const commandsForAgent = (agent: unknown): CommandsService | null => {
    if (typeof agent === "object" && agent !== null) {
      const ctx = (agent as Record<string, unknown>).ctx as {
        get?: (name: string) => unknown;
      } | null;
      if (ctx !== null && typeof ctx === "object" && typeof ctx.get === "function") {
        try {
          const service = ctx.get("commands");
          if (isCommandsLike(service)) return service;
        } catch {
          // Fall through to the command-scope capture.
        }
      }
    }
    return rootServices.commands;
  };
  // The meter resolves per evaluation and is never pinned: cached service,
  // live agent-scope read (self-healing when `agent/created` was missed),
  // then the root capture. Absent everywhere skips evaluation with the
  // stash untouched.
  const meterForSession = (sessionId: string): TokenMeterLike | null => {
    const cached = agentMeters.get(sessionId);
    if (cached !== undefined) return cached;
    const ctx = agentContexts.get(sessionId);
    if (ctx !== undefined) {
      try {
        const meter = ctx.get("tokenMeter");
        if (isTokenMeterLike(meter)) {
          boundedSet(agentMeters, sessionId, meter);
          return meter;
        }
      } catch {
        // Fall through to the root capture.
      }
    }
    return rootServices.meter;
  };
  // Session observers (tool counter, usage, trigger evaluation, compaction
  // receipts). Pure observer: never calls next(), never throws into host.
  // The context-management block resolves per session project; the profile
  // block is the fallback.
  registerSessionObservers(
    context,
    {
      ...baseDeps,
      config: config.contextManagement,
      meterForSession,
      resolveConfig: projectDirectory =>
        resolveEffectiveConfig(projectDirectory).then(c => c.contextManagement),
    },
    runtime,
  );
  // Loop-timed enforcement of stashed compaction intent: pre-step for the
  // host pressure path, agent-idle for the `/compact` command fallback
  // (the backend refuses mid-loop agents).
  registerLoopEnforcement(
    context,
    {
      ...baseDeps,
      config: config.contextManagement,
      compactionForAgent,
      commandsForAgent,
      resolveConfig: projectDirectory =>
        resolveEffectiveConfig(projectDirectory).then(c => c.contextManagement),
    },
    runtime,
  );

  // Compaction shaping: extends the trailing summarization instruction.
  // Registered unconditionally (like the preamble hook): it needs no host
  // service, and gates itself on config + Brain availability per request.
  // The sync hook cannot do IO, so per-project enablement reads the mtime
  // cache warmed by the async sites; unknown sessions use the profile value.
  registerCompactionShaping(context, {
    enabled: config.contextManagement.enabled,
    brainPaths: [...DEFAULT_BRAIN_PATHS],
    isBrainAvailable,
    configForSession: sessionId => {
      const cwd = sessionCwds.get(sessionId);
      if (cwd === undefined) return undefined;
      return cachedProjectConfig(cwd, config).contextManagement;
    },
  });
}

// Narrowing guards for host services read through untyped scopes. Shape
// checks only: a structurally valid service is adopted, anything else is
// treated as absent (a miss, never a throw).
function isTokenMeterLike(value: unknown): value is TokenMeterLike {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.measure === "function" && typeof record.contextPressure === "function";
}

function isCompactionServiceLike(value: unknown): value is CompactionService {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as Record<string, unknown>).compactIfNeeded === "function";
}

// Session identity off an untyped agent record. Fail closed: null callers
// skip per-session tracking rather than keying under a substitute.
function isCommandsLike(value: unknown): value is CommandsService {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as Record<string, unknown>).execute === "function";
}

function readRecordSessionId(record: Record<string, unknown>): string | null {
  const session = record.session;
  if (typeof session !== "object" || session === null) return null;
  const id = (session as Record<string, unknown>).id;
  return typeof id === "string" ? id : null;
}

// Per-session service caches stay bounded: a long-lived TUI creates one
// entry per session, so FIFO-evict past the cap (disposal eviction above
// handles the common path; this bounds the rest). Maps preserve insertion
// order, so the first key is the oldest.
const MAX_CACHED_SESSIONS = 100;

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  if (map.size > MAX_CACHED_SESSIONS) {
    const oldest = map.keys().next();
    if (!oldest.done) map.delete(oldest.value);
  }
}

function readAgentSessionId(agent: Agent): string | null {
  // Fail closed without a session identity: callers skip per-session
  // tracking rather than keying state under a substituted namespace.
  const session = (agent as unknown as Record<string, unknown>).session;
  if (typeof session !== "object" || session === null) return null;
  const id = (session as Record<string, unknown>).id;
  return typeof id === "string" ? id : null;
}

function readAgentCwd(agent: Agent): string {
  const session = (agent as unknown as Record<string, unknown>).session;
  if (typeof session === "object" && session !== null) {
    const header = (session as Record<string, unknown>).header;
    if (typeof header === "object" && header !== null) {
      const cwd = (header as Record<string, unknown>).cwd;
      if (typeof cwd === "string") return cwd;
    }
  }
  return process.cwd();
}

async function renderAgentPreamble(agent: Agent): Promise<{ text: string; available: boolean }> {
  const projectDirectory = readAgentCwd(agent);
  const rendered = renderPreamble(await loadMemorySnapshot(projectDirectory, homedir(), true));
  return { text: rendered.content, available: rendered.loaded && rendered.initialized };
}
