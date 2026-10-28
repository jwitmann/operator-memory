import { expect, test } from "vitest";

import {
  DEFAULT_BRAIN_UPDATES_CONFIG,
  parseBrainUpdatesConfig,
} from "../src/brain-updates-config.ts";

test("absent options yield the defaults, disabled", () => {
  const result = parseBrainUpdatesConfig(undefined);

  expect(result).toEqual({ ok: true, value: DEFAULT_BRAIN_UPDATES_CONFIG });
  expect(result.ok && result.value).toMatchObject({ enabled: false, toolCallThreshold: 25 });
});

test("parses an enabled block with a custom threshold", () => {
  const result = parseBrainUpdatesConfig({
    operator: { brainUpdates: { enabled: true, toolCallThreshold: 40 } },
  });

  expect(result.ok && result.value).toEqual({ enabled: true, toolCallThreshold: 40 });
});

test("rejects wrong-typed values instead of falling back", () => {
  expect(parseBrainUpdatesConfig({ operator: { brainUpdates: { enabled: "yes" } } }).ok).toBe(
    false,
  );
  expect(
    parseBrainUpdatesConfig({ operator: { brainUpdates: { toolCallThreshold: "many" } } }).ok,
  ).toBe(false);
});

test("rejects non-positive-integer thresholds", () => {
  for (const toolCallThreshold of [0, -10, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(parseBrainUpdatesConfig({ operator: { brainUpdates: { toolCallThreshold } } }).ok).toBe(
      false,
    );
  }
});

test("rejects non-object blocks", () => {
  const result = parseBrainUpdatesConfig({ operator: { brainUpdates: [1, 2] } });

  expect(result.ok).toBe(false);
});
