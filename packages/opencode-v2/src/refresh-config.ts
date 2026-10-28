import { success, type Result } from "./utils.ts";
import { readOptionBlock, readOptionBoolean } from "./options.ts";
import type { ConfigError } from "./context-config.ts";

// Parses the operator.preambleRefresh block from ctx.options. Absent means
// the defaults (disabled); a present block with a wrong-typed value is a
// parse failure, not a silent fallback, matching the contextManagement
// block contract. Separate switch because preamble rendering is Brain
// behavior, not context reduction.

export type PreambleRefreshConfig = {
  readonly enabled: boolean;
};

export const DEFAULT_PREAMBLE_REFRESH_CONFIG: PreambleRefreshConfig = {
  enabled: false,
};

export function parsePreambleRefreshConfig(
  options: unknown,
): Result<PreambleRefreshConfig, ConfigError> {
  const block = readOptionBlock(options, "preambleRefresh");
  if (!block.ok) {
    return block;
  }
  if (block.value === null) {
    return success(DEFAULT_PREAMBLE_REFRESH_CONFIG);
  }

  const enabled = readOptionBoolean(
    "operator.preambleRefresh",
    block.value,
    "enabled",
    DEFAULT_PREAMBLE_REFRESH_CONFIG.enabled,
  );
  if (!enabled.ok) {
    return enabled;
  }

  return success({ enabled: enabled.value });
}
