import { describe, expect, test } from "vitest";

import { DEFAULT_VCC_BRAIN_DEEPSEEK_CONFIG, parseVccBrainConfig } from "../src/config.ts";

describe("vcc-brain-deepseek config", () => {
  test("absent config yields all-disabled defaults", () => {
    const parsed = parseVccBrainConfig(null);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(DEFAULT_VCC_BRAIN_DEEPSEEK_CONFIG);
    expect(parsed.value.contextManagement.enabled).toBe(false);
    expect(parsed.value.brainUpdates.enabled).toBe(false);
    expect(parsed.value.preambleRefresh.enabled).toBe(false);
  });

  test("partial blocks fill defaults", () => {
    const parsed = parseVccBrainConfig({ contextManagement: { enabled: true } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.contextManagement.enabled).toBe(true);
    expect(parsed.value.contextManagement.ratio).toBe(
      DEFAULT_VCC_BRAIN_DEEPSEEK_CONFIG.contextManagement.ratio,
    );
    expect(parsed.value.brainUpdates.enabled).toBe(false);
  });

  test("wrong-typed values fail loudly", () => {
    expect(parseVccBrainConfig({ contextManagement: { enabled: "yes" } }).ok).toBe(false);
    expect(parseVccBrainConfig({ brainUpdates: { enabled: true, toolCallThreshold: 0 } }).ok).toBe(
      false,
    );
    expect(parseVccBrainConfig({ brainUpdates: { toolCallThreshold: 2.5 } }).ok).toBe(false);
    expect(parseVccBrainConfig({ contextManagement: [] }).ok).toBe(false);
  });

  test("out-of-range knobs fail loudly instead of inverting semantics", () => {
    expect(parseVccBrainConfig({ contextManagement: { ratio: 0 } }).ok).toBe(false);
    expect(parseVccBrainConfig({ contextManagement: { ratio: -1 } }).ok).toBe(false);
    expect(parseVccBrainConfig({ contextManagement: { ratio: 1.5 } }).ok).toBe(false);
    expect(parseVccBrainConfig({ contextManagement: { hardCapTokens: -5 } }).ok).toBe(false);
    expect(parseVccBrainConfig({ contextManagement: { keepRecentTurns: 1.5 } }).ok).toBe(false);
    expect(parseVccBrainConfig({ contextManagement: { ratio: 1 } }).ok).toBe(true);
  });
});
