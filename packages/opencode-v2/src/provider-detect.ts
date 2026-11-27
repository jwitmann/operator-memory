import { isRecord } from "@jwitmann/vcc-brain-core/utils";
import type { Context } from "@opencode/plugin/promise/plugin";

// External compaction-engine detection. One compaction/recall provider must
// own a session: when another engine is active, our context management
// stands down (auto-disable at setup, deferred stand-down on first session
// activity) instead of running a second snapshot/recall stack whose
// checkpoint shapes the agent can confuse.
//
// Detection is capability-shaped, not path-shaped where possible: exact
// foreign recall tool names, plus the local path/id of the observed
// external engine (the opencode-vcc-port project). Unknown engines stay
// undetected (fail-closed); the recall-side foreign-header handoff covers
// whatever setup-time detection misses.

// Recall/search tool names registered by the observed external engine.
// Ours are `vcc-brain-*`, so these never collide with our own surface.
const EXTERNAL_RECALL_TOOL_NAMES: ReadonlySet<string> = new Set(["vcc-recall", "vcc-search"]);

// Local directory name (and plugin id) of the observed external engine.
const EXTERNAL_ENGINE_SEGMENT = "opencode-vcc-port";

export type ExternalProviderSignal = {
  readonly kind: "plugin" | "tool";
  readonly detail: string;
};

// Pure detection over plugin and tool listings. Unrecognized shapes resolve
// to null (no engine), never throw.
export function detectExternalCompactionProvider(
  plugins: readonly unknown[],
  tools: readonly unknown[],
): ExternalProviderSignal | null {
  const toolList = Array.isArray(tools) ? tools : [];
  for (const tool of toolList) {
    if (
      isRecord(tool)
      && typeof tool.name === "string"
      && EXTERNAL_RECALL_TOOL_NAMES.has(tool.name)
    ) {
      return { kind: "tool", detail: `external compaction tool "${tool.name}" is registered` };
    }
  }
  const pluginList = Array.isArray(plugins) ? plugins : [];
  for (const plugin of pluginList) {
    if (!isRecord(plugin)) continue;
    if (typeof plugin.id === "string" && plugin.id === EXTERNAL_ENGINE_SEGMENT) {
      return { kind: "plugin", detail: `external compaction plugin "${plugin.id}" is active` };
    }
    const source = plugin.source;
    if (
      isRecord(source)
      && source.type === "local"
      && typeof source.path === "string"
      && source.path.split("/").includes(EXTERNAL_ENGINE_SEGMENT)
    ) {
      return { kind: "plugin", detail: `external compaction plugin at "${source.path}" is active` };
    }
  }
  return null;
}

// Query the host for an external compaction engine. Best-effort: any
// failure (or missing list APIs in older hosts/mocks) resolves to null so
// setup never fails on detection. Note the load-order limit: only plugins
// and tools registered before our setup are visible here; the deferred
// session-activity re-check covers engines that load after us.
export async function findExternalCompactionProvider(
  context: Context,
): Promise<ExternalProviderSignal | null> {
  try {
    const pluginList =
      typeof context.plugin?.list === "function" ? await context.plugin.list() : null;
    const toolList = typeof context.tool?.list === "function" ? await context.tool.list() : null;
    const plugins = isRecord(pluginList) && Array.isArray(pluginList.data) ? pluginList.data : [];
    const tools = Array.isArray(toolList) ? toolList : [];
    return detectExternalCompactionProvider(plugins, tools);
  } catch {
    return null;
  }
}
