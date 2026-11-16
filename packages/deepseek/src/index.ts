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
import { registerPreStepEnforcement } from "./pre-step.ts";
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

  context.inject(["commands"], registerCommands);

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
      // Seed the refresh fingerprint baseline from the first render so a
      // later move is meaningful. Only when a consumer needs it.
      if (config.preambleRefresh.enabled || config.brainUpdates.enabled) {
        const entry = sessionRuntime(runtime, sessionId);
        if (entry.preambleFingerprint === null) {
          const fingerprinted = await fingerprintPreamble(projectDirectory, homedir()).catch(
            () => null,
          );
          if (fingerprinted?.ok) {
            entry.preambleFingerprint = fingerprinted.value;
          }
        }
      }
    }

    if (config.preambleRefresh.enabled && sessionId !== null) {
      const outcome = await maybeRefreshPreamble(
        { config: config.preambleRefresh, stateDirectory, isBrainAvailable, reportReceiptFailure },
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
      ).catch((): { refreshed: false; failed: true } => ({ refreshed: false, failed: true }));
      if (outcome.refreshed) text = outcome.content;
    }

    if (config.brainUpdates.enabled && sessionId !== null) {
      text = await maybeAppendBrainUpdateReminder(
        {
          config: config.brainUpdates,
          projectDirectory,
          homeDirectory: homedir(),
          isBrainAvailable,
        },
        runtime,
        sessionId,
        text,
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
  // resolve their services through a scoped injection: the callback runs
  // only where `tokenMeter` and `compaction` exist, so minimal profiles
  // without them keep the preamble-only baseline instead of failing to
  // activate. Direct property access would throw without inject (proven
  // live) and `reflect.get` cannot see cross-layer services from this
  // fiber (proven live); scoped inject is the host-blessed read.
  try {
    context.inject(["tokenMeter", "compaction"], (scoped: Context) => {
      const meter = (scoped as unknown as { tokenMeter: TokenMeterLike }).tokenMeter;
      const compactionService = (
        scoped as unknown as {
          compaction: {
            compactIfNeeded(
              agent: unknown,
              trigger: "pressure",
              signal: AbortSignal,
            ): Promise<unknown>;
          };
        }
      ).compaction;
      // Session observers (tool counter, usage, trigger evaluation,
      // compaction receipts). Pure observer: never calls next(), never
      // throws into host.
      registerSessionObservers(
        scoped,
        { ...baseDeps, config: config.contextManagement, tokenMeter: meter },
        runtime,
      );
      // Loop-timed enforcement of stashed compaction intent.
      registerPreStepEnforcement(
        scoped,
        { ...baseDeps, config: config.contextManagement, compaction: compactionService },
        runtime,
      );
    });
  } catch (error) {
    try {
      context.logger?.warn?.(
        `operator-memory: context management stays off (missing host services): ${String(error).slice(0, 200)}`,
      );
    } catch {
      // Logging must never break plugin startup.
    }
  }

  // Compaction shaping: extends the trailing summarization instruction.
  // Registered unconditionally (like the preamble hook): it needs no host
  // service, and gates itself on config + Brain availability per request.
  registerCompactionShaping(context, {
    enabled: config.contextManagement.enabled,
    brainPaths: [...DEFAULT_BRAIN_PATHS],
    isBrainAvailable,
  });
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
