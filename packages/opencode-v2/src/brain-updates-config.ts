import { success, type Result } from "./utils.ts";
import { readOptionBlock, readOptionBoolean, readOptionNumber } from "./options.ts";
import type { ConfigError } from "./context-config.ts";

// Parses the operator.brainUpdates block from ctx.options. Absent means the
// defaults (disabled); a present block with a wrong-typed value is a parse
// failure, not a silent fallback, matching the other operator blocks. The
// threshold is a positive integer because the counter advances one completed
// tool call at a time.
export type BrainUpdatesConfig = {
  readonly enabled: boolean;
  readonly toolCallThreshold: number;
};

export const DEFAULT_BRAIN_UPDATES_CONFIG: BrainUpdatesConfig = {
  enabled: false,
  toolCallThreshold: 25,
};

const BRAIN_UPDATES_PATH = "operator.brainUpdates";

export function parseBrainUpdatesConfig(options: unknown): Result<BrainUpdatesConfig, ConfigError> {
  const block = readOptionBlock(options, "brainUpdates");
  if (!block.ok) {
    return block;
  }
  if (block.value === null) {
    return success(DEFAULT_BRAIN_UPDATES_CONFIG);
  }

  const enabled = readOptionBoolean(
    BRAIN_UPDATES_PATH,
    block.value,
    "enabled",
    DEFAULT_BRAIN_UPDATES_CONFIG.enabled,
  );
  if (!enabled.ok) {
    return enabled;
  }

  const toolCallThreshold = readOptionNumber(
    BRAIN_UPDATES_PATH,
    block.value,
    "toolCallThreshold",
    DEFAULT_BRAIN_UPDATES_CONFIG.toolCallThreshold,
  );
  if (!toolCallThreshold.ok) {
    return toolCallThreshold;
  }
  if (!Number.isInteger(toolCallThreshold.value) || toolCallThreshold.value <= 0) {
    return {
      ok: false,
      error: {
        message: `The "${BRAIN_UPDATES_PATH}.toolCallThreshold" option must be a positive integer.`,
      },
    };
  }

  return success({ enabled: enabled.value, toolCallThreshold: toolCallThreshold.value });
}
