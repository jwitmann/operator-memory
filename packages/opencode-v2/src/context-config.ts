import { success, type Result } from "./utils.ts";
import { readOptionBlock, readOptionBoolean, readOptionNumber } from "./options.ts";
import type { TriggerConfig } from "@aerovato/operator-core/context/triggers";

// Parses the operator.contextManagement block from ctx.options. Absent means
// the defaults (disabled); a present block with a wrong-typed value is a
// parse failure, not a silent fallback, so misconfiguration surfaces instead
// of quietly running with unintended thresholds.

export type ContextManagementConfig = {
  readonly enabled: boolean;
  readonly ratio: number;
  readonly hardCapTokens: number;
  readonly keepRecentTurns: number;
  readonly compactOnComplete: boolean;
  readonly compactFloorTokens: number;
};

export const DEFAULT_CONTEXT_MANAGEMENT_CONFIG: ContextManagementConfig = {
  enabled: false,
  ratio: 0.8,
  hardCapTokens: 250000,
  keepRecentTurns: 3,
  compactOnComplete: true,
  compactFloorTokens: 32000,
};

// Shared logic takes TriggerConfig; every adapter module converts through
// this single function.
export function toTriggerConfig(config: ContextManagementConfig): TriggerConfig {
  return {
    ratio: config.ratio,
    hardCapTokens: config.hardCapTokens,
    compactOnComplete: config.compactOnComplete,
    compactFloorTokens: config.compactFloorTokens,
  };
}

export type ConfigError = {
  readonly message: string;
};

export function parseContextManagementConfig(
  options: unknown,
): Result<ContextManagementConfig, ConfigError> {
  const block = readOptionBlock(options, "contextManagement");
  if (!block.ok) {
    return block;
  }
  if (block.value === null) {
    return success(DEFAULT_CONTEXT_MANAGEMENT_CONFIG);
  }

  const path = "operator.contextManagement";
  const enabled = readOptionBoolean(
    path,
    block.value,
    "enabled",
    DEFAULT_CONTEXT_MANAGEMENT_CONFIG.enabled,
  );
  const ratio = readOptionNumber(
    path,
    block.value,
    "ratio",
    DEFAULT_CONTEXT_MANAGEMENT_CONFIG.ratio,
  );
  const hardCapTokens = readOptionNumber(
    path,
    block.value,
    "hardCapTokens",
    DEFAULT_CONTEXT_MANAGEMENT_CONFIG.hardCapTokens,
  );
  const keepRecentTurns = readOptionNumber(
    path,
    block.value,
    "keepRecentTurns",
    DEFAULT_CONTEXT_MANAGEMENT_CONFIG.keepRecentTurns,
  );
  const compactOnComplete = readOptionBoolean(
    path,
    block.value,
    "compactOnComplete",
    DEFAULT_CONTEXT_MANAGEMENT_CONFIG.compactOnComplete,
  );
  const compactFloorTokens = readOptionNumber(
    path,
    block.value,
    "compactFloorTokens",
    DEFAULT_CONTEXT_MANAGEMENT_CONFIG.compactFloorTokens,
  );

  if (!enabled.ok) return enabled;
  if (!ratio.ok) return ratio;
  if (!hardCapTokens.ok) return hardCapTokens;
  if (!keepRecentTurns.ok) return keepRecentTurns;
  if (!compactOnComplete.ok) return compactOnComplete;
  if (!compactFloorTokens.ok) return compactFloorTokens;

  return success({
    enabled: enabled.value,
    ratio: ratio.value,
    hardCapTokens: hardCapTokens.value,
    keepRecentTurns: keepRecentTurns.value,
    compactOnComplete: compactOnComplete.value,
    compactFloorTokens: compactFloorTokens.value,
  });
}
