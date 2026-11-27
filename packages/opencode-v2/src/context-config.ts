import { failure, success, type Result } from "./utils.ts";
import {
  readOptionBlock,
  readOptionBoolean,
  readOptionNumber,
  readOptionString,
} from "./options.ts";
import type { TriggerConfig } from "@jwitmann/vcc-brain-core/context/triggers";

// Parses the vcc-brain.contextManagement block from ctx.options. Absent means
// the defaults (disabled); a present block with a wrong-typed value is a
// parse failure, not a silent fallback, so misconfiguration surfaces instead
// of quietly running with unintended thresholds.

export type ContextManagementMode = "full" | "trim-only";

// True when context management runs the full stack (trim handling plus
// compaction handling and per-session recall). Trim-only mode partitions
// ownership with an external engine instead. Single predicate for every
// mode branch so a future mode value changes behavior in one place.
export function isFullContextMode(config: { readonly mode: ContextManagementMode }): boolean {
  return config.mode === "full";
}

export type ContextManagementConfig = {
  readonly enabled: boolean;
  readonly mode: ContextManagementMode;
  readonly ratio: number;
  readonly hardCapTokens: number;
  readonly keepRecentTurns: number;
  readonly compactOnComplete: boolean;
  readonly compactFloorTokens: number;
};

export const DEFAULT_CONTEXT_MANAGEMENT_CONFIG: ContextManagementConfig = {
  enabled: false,
  mode: "full",
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
  base: ContextManagementConfig = DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
): Result<ContextManagementConfig, ConfigError> {
  const block = readOptionBlock(options, "contextManagement");
  if (!block.ok) {
    return block;
  }
  return parseContextManagementBlock(block.value, base);
}

// Block-level parser so a project-local file can merge over an already
// parsed base (absent fields inherit the base). The options wrapper above
// preserves the opencode.json contract unchanged.
export function parseContextManagementBlock(
  block: Record<string, unknown> | null,
  base: ContextManagementConfig = DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
): Result<ContextManagementConfig, ConfigError> {
  if (block === null) {
    return success(base);
  }

  const path = "vcc-brain.contextManagement";
  const enabled = readOptionBoolean(path, block, "enabled", base.enabled);
  const mode = readOptionString(path, block, "mode", base.mode);
  const ratio = readOptionNumber(path, block, "ratio", base.ratio);
  const hardCapTokens = readOptionNumber(path, block, "hardCapTokens", base.hardCapTokens);
  const keepRecentTurns = readOptionNumber(path, block, "keepRecentTurns", base.keepRecentTurns);
  const compactOnComplete = readOptionBoolean(
    path,
    block,
    "compactOnComplete",
    base.compactOnComplete,
  );
  const compactFloorTokens = readOptionNumber(
    path,
    block,
    "compactFloorTokens",
    base.compactFloorTokens,
  );

  if (!enabled.ok) return enabled;
  if (!mode.ok) return mode;
  if (mode.value !== "full" && mode.value !== "trim-only") {
    return failure({
      message: `The "${path}.mode" option must be "full" or "trim-only".`,
    });
  }
  if (!ratio.ok) return ratio;
  if (!hardCapTokens.ok) return hardCapTokens;
  if (!keepRecentTurns.ok) return keepRecentTurns;
  if (!compactOnComplete.ok) return compactOnComplete;
  if (!compactFloorTokens.ok) return compactFloorTokens;

  return success({
    enabled: enabled.value,
    mode: mode.value,
    ratio: ratio.value,
    hardCapTokens: hardCapTokens.value,
    keepRecentTurns: keepRecentTurns.value,
    compactOnComplete: compactOnComplete.value,
    compactFloorTokens: compactFloorTokens.value,
  });
}
