import { homedir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { TriggerKind } from "@jwitmann/vcc-brain-core/context/triggers";
import {
  loadMemorySnapshot,
  type MemoryStatusSnapshot,
} from "@jwitmann/vcc-brain-core/memory/load";
import { resolveStateDirectory } from "@jwitmann/vcc-brain-core/memory/roots";
import { Plugin } from "@opencode/plugin";
import packageJson from "../package.json" with { type: "json" };
import { maybeAppendBrainUpdateReminder } from "./brain-updates.ts";
import { DEFAULT_BRAIN_UPDATES_CONFIG, parseBrainUpdatesConfig } from "./brain-updates-config.ts";
import { registerCommands } from "./commands.ts";
import { DEFAULT_BRAIN_PATHS, registerCompactionHook } from "./compaction.ts";
import { registerContextHook } from "./context.ts";
import {
  DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
  parseContextManagementConfig,
} from "./context-config.ts";
import {
  registerCompletionTrigger,
  registerStepTracking,
  requestSessionCompaction,
} from "./events.ts";
import { pluginId } from "./id.ts";
import {
  type PartitionStatus,
  VccBrainNotifications,
  type VccBrainStatus,
  type VccBrainToast,
} from "./notifications.ts";
import { loadPreamble } from "./preamble.ts";
import { resolveProjectConfig } from "./project-config.ts";
import { findExternalCompactionProvider } from "./provider-detect.ts";
import { refreshPreambleContent } from "./refresh.ts";
import { DEFAULT_PREAMBLE_REFRESH_CONFIG, parsePreambleRefreshConfig } from "./refresh-config.ts";
import { sharedContextRuntime } from "./runtime.ts";
import {
  CONTEXT_MANAGEMENT_TOOL_NAMES,
  registerPruneTool,
  registerReadOmittedTool,
  registerRecallSessionTool,
  registerRecallTool,
  registerSearchSessionsTool,
  registerSearchTool,
} from "./tool.ts";

// Live setup generation. A teardown/reload without disposal leaves the old
// event loop and old hook closures alive; they capture their own generation
// and no-op once superseded, so only the current setup enforces. The runtime
// itself is shared across generations (see sharedContextRuntime) so dedup
// survives reloads.
let setupGeneration = 0;

const VccBrainPlugin = Plugin.define({
  id: pluginId,
  async setup(context) {
    const generation = ++setupGeneration;
    const isCurrent = () => generation === setupGeneration;
    const cache = new Map<string, ReturnType<typeof loadPreamble>>();
    const recoveryNotices = new Set<string>();
    const refreshNotices = new Set<string>();
    let status: Promise<VccBrainStatus> | null = null;
    const notifications = await context.rpc.register(VccBrainNotifications, {
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
    const showToast = (toast: VccBrainToast) => notifications.events.emit("toast", toast);
    // Preamble refresh is opt-in and off by default, like context
    // management. Parsed up front so the preamble hook below can use it.
    const refreshParsed = parsePreambleRefreshConfig(context.options);
    if (!refreshParsed.ok) {
      await showToast({
        title: "VCC Brain Error",
        message: refreshParsed.error.message,
        variant: "error",
      }).catch(() => undefined);
    }
    const refreshConfig = refreshParsed.ok ? refreshParsed.value : DEFAULT_PREAMBLE_REFRESH_CONFIG;
    // Brain updates are opt-in and off by default, like the other operator
    // features. Parsed up front so the preamble hook below can use it.
    const brainUpdatesParsed = parseBrainUpdatesConfig(context.options);
    if (!brainUpdatesParsed.ok) {
      await showToast({
        title: "VCC Brain Error",
        message: brainUpdatesParsed.error.message,
        variant: "error",
      }).catch(() => undefined);
    }
    const brainUpdatesConfig = brainUpdatesParsed.ok
      ? brainUpdatesParsed.value
      : DEFAULT_BRAIN_UPDATES_CONFIG;
    // Context management is opt-in and off by default; vanilla VCC Brain
    // behavior is unchanged when disabled. Parsed up front so the hook
    // and event registration below can split enforcement from
    // refresh-only tracking.
    const parsed = parseContextManagementConfig(context.options);
    if (!parsed.ok) {
      await showToast({
        title: "VCC Brain Error",
        message: parsed.error.message,
        variant: "error",
      }).catch(() => undefined);
    }
    const contextManagementBase = parsed.ok ? parsed.value : DEFAULT_CONTEXT_MANAGEMENT_CONFIG;
    // Per-project override: `<project>/.vcc-brain/config.json` (legacy
    // `.operator/config.json` also checked) merges over
    // the opencode.json config (setup-time: one setup per project
    // directory). Same block and key names without the `operator` wrapper;
    // present fields win, absent file or blocks inherit opencode.json.
    const projectOverride = await resolveProjectConfig(context.location.directory, {
      contextManagement: contextManagementBase,
      brainUpdates: brainUpdatesConfig,
      preambleRefresh: refreshConfig,
    });
    for (const warning of projectOverride.warnings) {
      await showToast({
        title: "VCC Brain Error",
        message: `VCC Brain project config (.vcc-brain/config.json): ${warning}`,
        variant: "error",
      }).catch(() => undefined);
    }
    const effectiveRefreshConfig = projectOverride.config.preambleRefresh;
    const effectiveBrainUpdatesConfig = projectOverride.config.brainUpdates;
    const effectiveContextManagement = projectOverride.config.contextManagement;
    let contextManagementEnabled = parsed.ok && effectiveContextManagement.enabled;
    // One compaction/recall provider per session: an already-loaded
    // external engine turns our context management off at setup (preamble,
    // refresh, and brain updates stay on). Engines that load after us are
    // caught by the deferred re-check on first session activity below.
    if (contextManagementEnabled) {
      const external = await findExternalCompactionProvider(context);
      if (external !== null) {
        contextManagementEnabled = false;
        await showToast({
          title: "VCC Brain",
          message:
            `External compaction engine detected (${external.detail}); VCC Brain context management is off — `
            + "one compaction/recall provider per session. Preamble, refresh, and brain updates stay on.",
          variant: "warning",
        }).catch(() => undefined);
      }
    }
    // Deferred stand-down cell: flipped when a late-loading external
    // engine is found on first session activity. Enforcement hooks gate on
    // isActive (generation-staleness AND stand-down); preamble, refresh,
    // and brain updates keep gating on generation-staleness only.
    const standDown = { stoodDown: false };
    const isActive = () => isCurrent() && !standDown.stoodDown;
    let providerRecheckDone = false;
    const maybeStandDownForExternalProvider = async (): Promise<void> => {
      if (!contextManagementEnabled || providerRecheckDone || !isCurrent()) return;
      providerRecheckDone = true;
      const hit = await findExternalCompactionProvider(context);
      if (hit === null || !isCurrent()) return;
      standDown.stoodDown = true;
      try {
        await context.tool.transform(editor => {
          for (const name of CONTEXT_MANAGEMENT_TOOL_NAMES) editor.remove(name);
        });
      } catch {
        // Best-effort: enforcement below already stopped; leftover tool
        // registrations are a cosmetic remainder, never fatal.
      }
      await showToast({
        title: "VCC Brain",
        message:
          `External compaction engine detected (${hit.detail}); VCC Brain context management stood down — `
          + "use the owning engine's recall/search tools.",
        variant: "warning",
      }).catch(() => undefined);
    };
    await registerCommands(context);
    // Brain availability per session, from preamble loads. Context management
    // gates on it: the feature stays off without the Brain.
    const brainAvailable = new Map<string, boolean>();
    await context.session.hook("context", async event => {
      if (!isCurrent()) {
        return;
      }
      await maybeStandDownForExternalProvider();
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
          title: "VCC Brain Error",
          message: `${result.error.message}${cause}`,
          variant: "error",
        }).catch(() => undefined);
        throw new Error(result.error.message, { cause: result.error.cause });
      }
      if (!result.value.loaded && !recoveryNotices.has(event.sessionID)) {
        recoveryNotices.add(event.sessionID);
        await showToast({
          title: "VCC Brain Error",
          message: "VCC Brain memory failed to load. The agent is attempting to recover.",
          variant: "error",
        }).catch(() => undefined);
      }
      let content = result.value.content;
      if (effectiveRefreshConfig.enabled) {
        content = await refreshPreambleContent(
          {
            config: effectiveRefreshConfig,
            stateDirectory: resolveStateDirectory(homedir()),
            isBrainAvailable: sessionID => brainAvailable.get(sessionID) === true,
            isCurrent,
            reportFailure: () => {
              void showToast({
                title: "VCC Brain Error",
                message: "VCC Brain preamble refresh failed. Continuing with the session preamble.",
                variant: "error",
              }).catch(() => undefined);
            },
            failureNotices: refreshNotices,
          },
          sharedContextRuntime(),
          event.sessionID,
          context.location.directory,
          homedir(),
          cache,
          event.messages,
          content,
        );
      }
      if (effectiveBrainUpdatesConfig.enabled) {
        content = await maybeAppendBrainUpdateReminder(
          {
            config: effectiveBrainUpdatesConfig,
            projectDirectory: context.location.directory,
            homeDirectory: homedir(),
            stateDirectory: resolveStateDirectory(homedir()),
            isBrainAvailable: sessionID => brainAvailable.get(sessionID) === true,
            isCurrent,
          },
          sharedContextRuntime(),
          event.sessionID,
          event.messages,
          content,
        );
      }
      event.system.push({ type: "text", text: content });
    });

    // Step anchoring runs whenever either feature is on; the refresh
    // floor measures its own estimate on demand inside the refresh path.
    // Enforcement (trim, compaction requests, tool registration) stays
    // behind the context-management switch.
    if (parsed.ok && (contextManagementEnabled || effectiveRefreshConfig.enabled)) {
      const config = effectiveContextManagement;
      const stateDirectory = resolveStateDirectory(homedir());
      // Shared across reloads so trigger dedup survives a teardown/setup
      // cycle; a requested-but-not-yet-executed compaction must still
      // suppress the next terminal signal after reload.
      const runtime = sharedContextRuntime();
      // The preamble hook above must stay registered first: it populates
      // brainAvailable, which these hooks read through isBrainAvailable.
      // Unknown sessions default to unavailable (fail closed).
      const isBrainAvailable = (sessionID: string) => brainAvailable.get(sessionID) === true;
      const reportReceiptFailure = async (
        sessionID: string | null,
        kind: "trim" | "compact" | "refusal" | "event-stream",
      ) => {
        if (!isCurrent()) {
          return;
        }
        await showToast({
          title: "VCC Brain Error",
          message:
            kind === "event-stream"
              ? "VCC Brain event stream failed twice; completion triggering stopped for this process."
              : `VCC Brain context log write failed (${kind}) for session ${sessionID}. Reductions continue but are unaudited for this session.`,
          variant: "error",
        }).catch(() => undefined);
      };
      const controller = new AbortController();
      if (contextManagementEnabled) {
        const requestCompaction = (sessionID: string, cause: TriggerKind) => {
          if (!isActive()) {
            return;
          }
          requestSessionCompaction(context, runtime, sessionID, cause);
        };
        const deps = {
          config,
          stateDirectory,
          requestCompaction,
          isBrainAvailable,
          reportReceiptFailure,
          isCurrent: isActive,
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
            isCurrent: isActive,
          },
          runtime,
        );
        registerCompletionTrigger(context, deps, runtime, { signal: controller.signal });
        await registerReadOmittedTool(context, { stateDirectory });
        await registerPruneTool(context, { stateDirectory });
        await registerRecallTool(context, { stateDirectory });
        await registerSearchTool(context, { stateDirectory });
        await registerSearchSessionsTool(context, {
          projectDirectory: context.location.directory,
        });
        await registerRecallSessionTool(context);
      } else {
        // Refresh-only telemetry: step anchoring without triggers.
        registerStepTracking(
          context,
          { isBrainAvailable, isCurrent, reportReceiptFailure },
          runtime,
          {
            signal: controller.signal,
          },
        );
      }
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

export default VccBrainPlugin;

async function loadStatus(projectDirectory: string): Promise<VccBrainStatus> {
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
