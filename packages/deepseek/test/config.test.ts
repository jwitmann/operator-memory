import { describe, expect, test } from "vitest";

import { DEFAULT_OPERATOR_DEEPSEEK_CONFIG, parseOperatorConfig } from "../src/config.ts";

describe("operator-deepseek config", () => {
  test("absent config yields all-disabled defaults", () => {
    const parsed = parseOperatorConfig(null);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(DEFAULT_OPERATOR_DEEPSEEK_CONFIG);
    expect(parsed.value.contextManagement.enabled).toBe(false);
    expect(parsed.value.brainUpdates.enabled).toBe(false);
    expect(parsed.value.preambleRefresh.enabled).toBe(false);
  });

  test("partial blocks fill defaults", () => {
    const parsed = parseOperatorConfig({ contextManagement: { enabled: true } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.contextManagement.enabled).toBe(true);
    expect(parsed.value.contextManagement.ratio).toBe(
      DEFAULT_OPERATOR_DEEPSEEK_CONFIG.contextManagement.ratio,
    );
    expect(parsed.value.brainUpdates.enabled).toBe(false);
  });

  test("wrong-typed values fail loudly", () => {
    expect(parseOperatorConfig({ contextManagement: { enabled: "yes" } }).ok).toBe(false);
    expect(parseOperatorConfig({ brainUpdates: { enabled: true, toolCallThreshold: 0 } }).ok).toBe(
      false,
    );
    expect(parseOperatorConfig({ brainUpdates: { toolCallThreshold: 2.5 } }).ok).toBe(false);
    expect(parseOperatorConfig({ contextManagement: [] }).ok).toBe(false);
  });

  test("out-of-range knobs fail loudly instead of inverting semantics", () => {
    expect(parseOperatorConfig({ contextManagement: { ratio: 0 } }).ok).toBe(false);
    expect(parseOperatorConfig({ contextManagement: { ratio: -1 } }).ok).toBe(false);
    expect(parseOperatorConfig({ contextManagement: { ratio: 1.5 } }).ok).toBe(false);
    expect(parseOperatorConfig({ contextManagement: { hardCapTokens: -5 } }).ok).toBe(false);
    expect(parseOperatorConfig({ contextManagement: { keepRecentTurns: 1.5 } }).ok).toBe(false);
    expect(parseOperatorConfig({ contextManagement: { ratio: 1 } }).ok).toBe(true);
  });
});
