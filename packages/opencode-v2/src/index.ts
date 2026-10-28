import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadMemorySnapshot, type MemoryStatusSnapshot } from "@aerovato/operator-core/memory/load";
import type { TriggerKind } from "@aerovato/operator-core/context/triggers";
import { Plugin } from "@opencode/plugin";
import { pluginId } from "./id.ts";

import packageJson from "../package.json" with { type: "json" };
import { registerCommands } from "./commands.ts";
import { DEFAULT_BRAIN_PATHS, registerCompactionHook } from "./compaction.ts";
import { registerContextHook } from "./context.ts";
import { parseContextManagementConfig } from "./context-config.ts";
import { registerCompletionTrigger, requestSessionCompaction } from "./events.ts";
import { loadPreamble } from "./preamble.ts";
import { maybeRefreshPreamble } from "./refresh.ts";
import { DEFAULT_PREAMBLE_REFRESH_CONFIG, parsePreambleRefreshConfig } from "./refresh-config.ts";
import { sharedContextRuntime } from "./runtime.ts";
import { registerPruneTool, registerReadOmittedTool } from "./tool.ts";
import {
  OperatorNotifications,
  type OperatorStatus,
  type OperatorToast,
  type PartitionStatus,
} from "./notifications.ts";

// Live setup generation. A teardown/reload without disposal leaves the old
// event loop and old hook closures alive; they capture their own generation
// and no-op once superseded, so only the current setup enforces. The runtime
// itself is shared across generations (see sharedContextRuntime) so dedup
// survives reloads.
let setupGeneration = 0;

const OperatorPlugin = Plugin.define({
  id: pluginId,
  async setup(context) {
    const generation = ++setupGeneration;
    const isCurrent = () => generation === setupGeneration;
    const cache = new Map<string, ReturnType<typeof loadPreamble>>();
    const recoveryNotices = new Set<string>();
    const refreshNotices = new Set<string>();
    let status: Promise<OperatorStatus> | null = null;
    const notifications = await context.rpc.register(OperatorNotifications, {
      status: async input => {
        const refresh =
          input !== null
          && typeof input === "object"
          && "refresh" in input
          && input.refresh === true;
        if (status === null || refresh) {
          status = loadStatus(context.location.directory);
        }
        return status;
      },
    });
    const showToast = (toast: OperatorToast) => notifications.events.emit("toast", toast);
    // Preamble refresh is opt-in and off by default, like context
    // management. Parsed up front so the preamble hook below can use it.
    const refreshParsed = parsePreambleRefreshConfig(context.options);
    if (!refreshParsed.ok) {
      await showToast({
        title: "Operator Error",
        message: refreshParsed.error.message,
        variant: "error",
      }).catch(() => undefined);
    }
    const refreshConfig = refreshParsed.ok ? refreshParsed.value : DEFAULT_PREAMBLE_REFRESH_CONFIG;
    await registerCommands(context);
    // Brain availability per session, from preamble loads. Context management
    // gates on it: the feature stays off without the Brain.
    const brainAvailable = new Map<string, boolean>();
    await context.session.hook("context", async event => {
      if (!isCurrent()) {
        return;
      }
      const result = await loadPreamble({
        sessionID: event.sessionID,
        projectDirectory: context.location.directory,
        homeDirectory: homedir(),
        cache,
      });
      brainAvailable.set(
        event.sessionID,
        result.ok ? result.value.loaded && result.value.initialized : false,
      );
      if (!result.ok) {
        const cause = result.error.cause instanceof Error ? ` ${result.error.cause.message}` : "";
        await showToast({
          title: "Operator Error",
          message: `${result.error.message}${cause}`,
          variant: "error",
        }).catch(() => undefined);
        throw new Error(result.error.message, { cause: result.error.cause });
      }
      if (!result.value.loaded && !recoveryNotices.has(event.sessionID)) {
        recoveryNotices.add(event.sessionID);
        await showToast({
          title: "Operator Error",
          message: "Operator memory failed to load. The agent is attempting to recover.",
          variant: "error",
        }).catch(() => undefined);
      }
      let content = result.value.content;
      if (refreshConfig.enabled) {
        const refresh = await maybeRefreshPreamble(
          {
            config: refreshConfig,
            stateDirectory: join(homedir(), ".operator", "state"),
            isBrainAvailable: sessionID => brainAvailable.get(sessionID) === true,
            isCurrent,
          },
          sharedContextRuntime(),
          event.sessionID,
          context.location.directory,
          homedir(),
          cache,
        );
        if (refresh.refreshed) {
          content = refresh.content;
        } else if (refresh.failed && !refreshNotices.has(event.sessionID)) {
          refreshNotices.add(event.sessionID);
          await showToast({
            title: "Operator Error",
            message: "Operator preamble refresh failed. Continuing with the session preamble.",
            variant: "error",
          }).catch(() => undefined);
        }
      }
      event.system.push({ type: "text", text: content });
    });

    // Context management is opt-in and off by default; vanilla Operator
    // behavior is unchanged when disabled.
    const parsed = parseContextManagementConfig(context.options);
    if (!parsed.ok) {
      await showToast({
        title: "Operator Error",
        message: parsed.error.message,
        variant: "error",
      }).catch(() => undefined);
    } else if (parsed.value.enabled) {
      const config = parsed.value;
      const stateDirectory = join(homedir(), ".operator", "state");
      // Shared across reloads so trigger dedup survives a teardown/setup
      // cycle; a requested-but-not-yet-executed compaction must still
      // suppress the next terminal signal after reload.
      const runtime = sharedContextRuntime();
      // The preamble hook above must stay registered first: it populates
      // brainAvailable, which these hooks read through isBrainAvailable.
      // Unknown sessions default to unavailable (fail closed).
      const isBrainAvailable = (sessionID: string) => brainAvailable.get(sessionID) === true;
      const requestCompaction = (sessionID: string, cause: TriggerKind) => {
        if (!isCurrent()) {
          return;
        }
        requestSessionCompaction(context, runtime, sessionID, cause);
      };
      const reportReceiptFailure = async (
        sessionID: string | null,
        kind: "trim" | "compact" | "refusal" | "event-stream",
      ) => {
        if (!isCurrent()) {
          return;
        }
        await showToast({
          title: "Operator Error",
          message:
            kind === "event-stream"
              ? "Operator event stream failed twice; completion triggering stopped for this process."
              : `Operator context log write failed (${kind}) for session ${sessionID}. Reductions continue but are unaudited for this session.`,
          variant: "error",
        }).catch(() => undefined);
      };
      const deps = {
        config,
        stateDirectory,
        requestCompaction,
        isBrainAvailable,
        reportReceiptFailure,
        isCurrent,
      };
      registerContextHook(context, deps, runtime);
      registerCompactionHook(
        context,
        {
          config,
          stateDirectory,
          brainPaths: DEFAULT_BRAIN_PATHS,
          isBrainAvailable,
          reportReceiptFailure,
          refreshEnabled: refreshConfig.enabled,
          isCurrent,
        },
        runtime,
      );
      const controller = new AbortController();
      registerCompletionTrigger(context, deps, runtime, { signal: controller.signal });
      await registerReadOmittedTool(context, { stateDirectory });
      await registerPruneTool(context, { stateDirectory });
      // Tearing down stops the event loop and marks this generation stale so
      // surviving closures no-op. Only bump the generation when still
      // current: a newer setup may already have superseded this one.
      return () => {
        controller.abort();
        if (isCurrent()) {
          setupGeneration++;
        }
      };
    }
  },
});

export default OperatorPlugin;

async function loadStatus(projectDirectory: string): Promise<OperatorStatus> {
  const snapshot = await loadMemorySnapshot(projectDirectory, homedir(), false);
  return {
    detail: installationDetail(import.meta.url),
    user: partitionStatus(snapshot.user),
    private: partitionStatus(snapshot.private),
    shared: partitionStatus(snapshot.shared),
  };
}

function partitionStatus(
  partition: MemoryStatusSnapshot[keyof MemoryStatusSnapshot],
): PartitionStatus {
  if (!partition.ok) return "error";
  return partition.value.exists ? "loaded" : "uninitialized";
}

function installationDetail(moduleUrl: string): string {
  const packageDirectory = dirname(dirname(fileURLToPath(moduleUrl)));
  return packageDirectory.includes(
    `${process.platform === "win32" ? "\\" : "/"}node_modules${process.platform === "win32" ? "\\" : "/"}`,
  )
    ? `v${packageJson.version}`
    : "Local Build";
}
