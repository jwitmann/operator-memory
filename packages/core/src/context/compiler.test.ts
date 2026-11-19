import { expect, test } from "vitest";

import {
  countTokens,
  estimateEntryTokens,
  isCjkChar,
  sanitize,
  tailTokens,
  tokenize,
  truncateTokens,
} from "./compiler.ts";

// Oracle vectors captured from the original dsh-compaction-vcc@0.7.4
// `src/compiler.js` (port selftest run 2026-11-19): the port must reproduce
// them exactly. Emoji split into surrogate halves by design (single
// punctuation-class chars under the word-class tokenizer).
test("tokenizer oracle vectors match the original", () => {
  expect(tokenize("Hello, world 123")).toEqual(["Hello", ",", " ", "world", " ", "123"]);
  expect(tokenize("a😀b")).toEqual(["a", "\ud83d", "\ude00", "b"]);
  expect(countTokens("สวัสดีครับ")).toBe(10);
  expect(isCjkChar("ส")).toBe(true);
  expect(isCjkChar("a")).toBe(false);
  expect(estimateEntryTokens("1".repeat(100))).toBe(30);
  expect(sanitize("a\r\n\x1b[31mhi\x00!")).toBe("a\nhi!");
  expect(truncateTokens("one two three four", 2, null)).toEqual({
    text: "one two...(truncated)",
    truncated: true,
  });
  expect(truncateTokens("one two three four", 2, "seq 5")).toEqual({
    text: "one two...(truncated from seq 5)",
    truncated: true,
  });
  expect(truncateTokens(`${"x".repeat(40)}😀${"y".repeat(40)}`, 10, null)).toEqual({
    text: `${"x".repeat(40)}...(truncated)`,
    truncated: true,
  });
  expect(tailTokens("one two three four", 2, null)).toEqual({
    text: "...(elided before) three four",
    truncated: true,
  });
});

test("untruncated inputs round-trip byte-identical", () => {
  expect(truncateTokens("one two", 5, null)).toEqual({ text: "one two", truncated: false });
  expect(tailTokens("one two", 5, "seq 1")).toEqual({ text: "one two", truncated: false });
});
