import { expect, test } from "vitest";

import {
  DEFAULT_PREAMBLE_REFRESH_CONFIG,
  parsePreambleRefreshConfig,
} from "../src/refresh-config.ts";

test("absent options yield the defaults, disabled", () => {
  const result = parsePreambleRefreshConfig(undefined);
  expect(result).toEqual({ ok: true, value: DEFAULT_PREAMBLE_REFRESH_CONFIG });
  expect(result.ok && result.value.enabled).toBe(false);
});

test("parses an enabled block", () => {
  const result = parsePreambleRefreshConfig({
    operator: { preambleRefresh: { enabled: true } },
  });

  expect(result.ok && result.value).toEqual({ enabled: true });
});

test("rejects wrong-typed values instead of falling back", () => {
  const enabled = parsePreambleRefreshConfig({
    operator: { preambleRefresh: { enabled: "yes" } },
  });
  expect(enabled.ok).toBe(false);
});

test("rejects non-object blocks", () => {
  const block = parsePreambleRefreshConfig({ operator: { preambleRefresh: [1, 2] } });
  expect(block.ok).toBe(false);
});
