import type { TriggerConfig } from "@jwitmann/operator-core/context/triggers";

import { failure, type Result, success } from "./utils.ts";

// DSH-native plugin configuration. Unlike the opencode adapters (which parse
// `ctx.options`), a Cordis Host plugin receives validated config as the
// second `apply` argument, declared through an exported schemastery `Config`
// schema (see dsh-repeat-tool-reminder for the precedent). To avoid a new
// dependency before the port proves out, this module defines the config
// shape, defaults, and fail-loud normalization in plain TypeScript; the
// exported `Config` schema binding follows once `@deepseek-ai/schemastery`
// is added to peer dependencies.
//
// Every feature defaults OFF: a plugin with no config behaves exactly like
// the current preamble-only adapter.

export type ContextManagementConfig = {
  readonly enabled: boolean;
  readonly ratio: number;
  readonly hardCapTokens: number;
  // Reserved: parsed for config compatibility with the opencode adapters, but
  // no trim path exists in this adapter yet (DSH owns tool-result reduction
  // via its own pruner services). Enforcement lands with the trim port.
  readonly keepRecentTurns: number;
  readonly compactOnComplete: boolean;
  readonly compactFloorTokens: number;
};

export type BrainUpdatesConfig = {
  readonly enabled: boolean;
  readonly toolCallThreshold: number;
};

export type PreambleRefreshConfig = {
  readonly enabled: boolean;
};

export type OperatorDeepseekConfig = {
  readonly contextManagement: ContextManagementConfig;
  readonly brainUpdates: BrainUpdatesConfig;
  readonly preambleRefresh: PreambleRefreshConfig;
};

export const DEFAULT_CONTEXT_MANAGEMENT_CONFIG: ContextManagementConfig = {
  enabled: false,
  ratio: 0.8,
  hardCapTokens: 250000,
  keepRecentTurns: 3,
  compactOnComplete: true,
  compactFloorTokens: 32000,
};

export const DEFAULT_BRAIN_UPDATES_CONFIG: BrainUpdatesConfig = {
  enabled: false,
  toolCallThreshold: 25,
};

export const DEFAULT_PREAMBLE_REFRESH_CONFIG: PreambleRefreshConfig = {
  enabled: false,
};

export const DEFAULT_OPERATOR_DEEPSEEK_CONFIG: OperatorDeepseekConfig = {
  contextManagement: DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
  brainUpdates: DEFAULT_BRAIN_UPDATES_CONFIG,
  preambleRefresh: DEFAULT_PREAMBLE_REFRESH_CONFIG,
};

export type ConfigError = {
  readonly message: string;
};

function readBoolean(
  path: string,
  block: Record<string, unknown>,
  key: string,
  fallback: boolean,
): Result<boolean, ConfigError> {
  const value = block[key];
  if (value === undefined) return success(fallback);
  if (typeof value !== "boolean") {
    return failure({ message: `The "${path}.${key}" option must be a boolean.` });
  }
  return success(value);
}

function readNumber(
  path: string,
  block: Record<string, unknown>,
  key: string,
  fallback: number,
): Result<number, ConfigError> {
  const value = block[key];
  if (value === undefined) return success(fallback);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return failure({ message: `The "${path}.${key}" option must be a number.` });
  }
  return success(value);
}

function readBlock(
  input: unknown,
  key: string,
): Result<Record<string, unknown> | null, ConfigError> {
  if (typeof input !== "object" || input === null) return success(null);
  const section = (input as Record<string, unknown>)[key];
  if (section === null || section === undefined) return success(null);
  if (typeof section !== "object" || Array.isArray(section)) {
    return failure({ message: `The "${key}" option must be an object.` });
  }
  return success(section as Record<string, unknown>);
}

// Normalizes raw plugin config (the second `apply` argument) with defaults.
// Absent blocks fall back to disabled defaults; wrong-typed values fail
// loudly instead of running with unintended thresholds.
export function parseOperatorConfig(input: unknown): Result<OperatorDeepseekConfig, ConfigError> {
  const contextBlock = readBlock(input, "contextManagement");
  if (!contextBlock.ok) return contextBlock;
  const brainBlock = readBlock(input, "brainUpdates");
  if (!brainBlock.ok) return brainBlock;
  const refreshBlock = readBlock(input, "preambleRefresh");
  if (!refreshBlock.ok) return refreshBlock;

  const contextManagement = parseContextManagementBlock(contextBlock.value);
  if (!contextManagement.ok) return contextManagement;
  const brainUpdates = parseBrainUpdatesBlock(brainBlock.value);
  if (!brainUpdates.ok) return brainUpdates;
  const preambleRefresh = parsePreambleRefreshBlock(refreshBlock.value);
  if (!preambleRefresh.ok) return preambleRefresh;

  return success({
    contextManagement: contextManagement.value,
    brainUpdates: brainUpdates.value,
    preambleRefresh: preambleRefresh.value,
  });
}

function parseContextManagementBlock(
  block: Record<string, unknown> | null,
  base: ContextManagementConfig = DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
): Result<ContextManagementConfig, ConfigError> {
  if (block === null) return success(base);
  const path = "contextManagement";
  const enabled = readBoolean(path, block, "enabled", base.enabled);
  const ratio = readNumber(path, block, "ratio", base.ratio);
  const hardCapTokens = readNumber(path, block, "hardCapTokens", base.hardCapTokens);
  const keepRecentTurns = readNumber(path, block, "keepRecentTurns", base.keepRecentTurns);
  const compactOnComplete = readBoolean(path, block, "compactOnComplete", base.compactOnComplete);
  const compactFloorTokens = readNumber(path, block, "compactFloorTokens", base.compactFloorTokens);
  if (!enabled.ok) return enabled;
  if (!ratio.ok) return ratio;
  if (!hardCapTokens.ok) return hardCapTokens;
  if (!keepRecentTurns.ok) return keepRecentTurns;
  if (!compactOnComplete.ok) return compactOnComplete;
  if (!compactFloorTokens.ok) return compactFloorTokens;
  if (ratio.value <= 0 || ratio.value > 1) {
    return failure({ message: `The "${path}.ratio" option must be in (0, 1].` });
  }
  for (const [key, value] of [
    ["hardCapTokens", hardCapTokens.value],
    ["keepRecentTurns", keepRecentTurns.value],
    ["compactFloorTokens", compactFloorTokens.value],
  ] as const) {
    if (value < 0) {
      return failure({ message: `The "${path}.${key}" option must be non-negative.` });
    }
  }
  if (!Number.isInteger(keepRecentTurns.value)) {
    return failure({ message: `The "${path}.keepRecentTurns" option must be an integer.` });
  }
  return success({
    enabled: enabled.value,
    ratio: ratio.value,
    hardCapTokens: hardCapTokens.value,
    keepRecentTurns: keepRecentTurns.value,
    compactOnComplete: compactOnComplete.value,
    compactFloorTokens: compactFloorTokens.value,
  });
}

function parseBrainUpdatesBlock(
  block: Record<string, unknown> | null,
  base: BrainUpdatesConfig = DEFAULT_BRAIN_UPDATES_CONFIG,
): Result<BrainUpdatesConfig, ConfigError> {
  if (block === null) return success(base);
  const path = "brainUpdates";
  const enabled = readBoolean(path, block, "enabled", base.enabled);
  if (!enabled.ok) return enabled;
  const threshold = readNumber(path, block, "toolCallThreshold", base.toolCallThreshold);
  if (!threshold.ok) return threshold;
  if (!Number.isInteger(threshold.value) || threshold.value <= 0) {
    return failure({
      message: `The "${path}.toolCallThreshold" option must be a positive integer.`,
    });
  }
  return success({ enabled: enabled.value, toolCallThreshold: threshold.value });
}

function parsePreambleRefreshBlock(
  block: Record<string, unknown> | null,
  base: PreambleRefreshConfig = DEFAULT_PREAMBLE_REFRESH_CONFIG,
): Result<PreambleRefreshConfig, ConfigError> {
  if (block === null) return success(base);
  const enabled = readBoolean("preambleRefresh", block, "enabled", base.enabled);
  if (!enabled.ok) return enabled;
  return success({ enabled: enabled.value });
}

// Project-local override: `.vcc-brain/config.json` (legacy `.operator/config.json`
// also checked) parsed over a base
// (normally the profile config) so absent fields inherit the base.
// Per-block fallback: an invalid block warns and keeps the base block
// while valid sibling blocks still merge. A non-object root discards the
// whole file. Unknown keys are ignored, as in the profile parser.
export type ProjectConfigOutcome = {
  readonly config: OperatorDeepseekConfig;
  readonly warnings: readonly string[];
};

export function parseProjectConfig(
  raw: unknown,
  base: OperatorDeepseekConfig,
): ProjectConfigOutcome {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { config: base, warnings: ["The project config must be an object."] };
  }
  const input = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const contextBlock = readBlock(input, "contextManagement");
  const brainBlock = readBlock(input, "brainUpdates");
  const refreshBlock = readBlock(input, "preambleRefresh");
  for (const block of [contextBlock, brainBlock, refreshBlock]) {
    if (!block.ok) warnings.push(block.error.message);
  }
  const contextManagement = contextBlock.ok
    ? parseContextManagementBlock(contextBlock.value, base.contextManagement)
    : null;
  const brainUpdates = brainBlock.ok
    ? parseBrainUpdatesBlock(brainBlock.value, base.brainUpdates)
    : null;
  const preambleRefresh = refreshBlock.ok
    ? parsePreambleRefreshBlock(refreshBlock.value, base.preambleRefresh)
    : null;
  if (contextManagement !== null && !contextManagement.ok) {
    warnings.push(contextManagement.error.message);
  }
  if (brainUpdates !== null && !brainUpdates.ok) {
    warnings.push(brainUpdates.error.message);
  }
  if (preambleRefresh !== null && !preambleRefresh.ok) {
    warnings.push(preambleRefresh.error.message);
  }
  return {
    config: {
      contextManagement: contextManagement?.ok ? contextManagement.value : base.contextManagement,
      brainUpdates: brainUpdates?.ok ? brainUpdates.value : base.brainUpdates,
      preambleRefresh: preambleRefresh?.ok ? preambleRefresh.value : base.preambleRefresh,
    },
    warnings,
  };
}

// Shared trigger-config view for core's evaluateTrigger: the DSH port keeps
// the same knob semantics as the opencode adapters so behavior transfers,
// while the values originate from Cordis plugin config above.
export function toTriggerConfig(config: ContextManagementConfig): TriggerConfig {
  return {
    ratio: config.ratio,
    hardCapTokens: config.hardCapTokens,
    compactOnComplete: config.compactOnComplete,
    compactFloorTokens: config.compactFloorTokens,
  };
}
