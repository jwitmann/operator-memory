import { expect, test } from "vitest";

import {
  compileNodes,
  compileNoisePatterns,
  compileRegion,
  countTokens,
  DEFAULT_CHECKPOINT_FRAMING,
  DEFAULT_ELIDABLE_SOURCE_LABELS,
  DEFAULT_ELIDED_BODY_NOTE,
  DEFAULT_ELIDED_SOURCE_NOTE,
  DEFAULT_MEMORY_BLOCK_JOINER,
  DEFAULT_MEMORY_FILE_CLOSE,
  DEFAULT_MEMORY_MARKER_WINDOW,
  DEFAULT_MEMORY_ROLE_HEAD,
  DEFAULT_MEMORY_SNAPSHOT_MARKERS,
  DEFAULT_NOISE_PATTERNS,
  DEFAULT_SYSTEM_REMINDER_BODY_MARKERS,
  DEFAULT_SYSTEM_REMINDER_PROOF_WINDOW,
  entryText,
  estimateEntryTokens,
  excerptToolResult,
  frameCheckpoint,
  isCjkChar,
  joinCompiledEntries,
  sanitize,
  stripNoiseXml,
  tailTokens,
  tokenize,
  truncateTokens,
  type CompileNode,
  type CompilerConfig,
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

// ── stage 2: region compiler ─────────────────────────────────────────────
// Oracle vectors captured from the original dsh-compaction-vcc@0.7.4
// `src/compiler.js` (port selftest run 2026-11-19).
function stage2Config(): CompilerConfig {
  return {
    textTokens: 8,
    userTextTokens: 8,
    toolCallTokens: 8,
    toolResultExcerptTokens: 16,
    maxTokens: 120,
    includeReasoning: false,
    stripNoiseXml: true,
    noisePatterns: compileNoisePatterns(DEFAULT_NOISE_PATTERNS),
    toolKeyFields: {},
    toolArgTools: [],
    hideTools: ["job_output"],
    elideCheckpointInjectedBodies: false,
    elideSourceKinds: [],
    elideSourceLabels: DEFAULT_ELIDABLE_SOURCE_LABELS,
    memorySnapshotMarkers: DEFAULT_MEMORY_SNAPSHOT_MARKERS,
    memoryFileClose: DEFAULT_MEMORY_FILE_CLOSE,
    memoryBlockJoiner: DEFAULT_MEMORY_BLOCK_JOINER,
    memoryRoleHead: DEFAULT_MEMORY_ROLE_HEAD,
    memoryMarkerWindow: DEFAULT_MEMORY_MARKER_WINDOW,
    systemReminderBodyMarkers: DEFAULT_SYSTEM_REMINDER_BODY_MARKERS,
    systemReminderProofWindow: DEFAULT_SYSTEM_REMINDER_PROOF_WINDOW,
    elidedSourceNote: DEFAULT_ELIDED_SOURCE_NOTE,
    elidedBodyNote: DEFAULT_ELIDED_BODY_NOTE,
    framing: DEFAULT_CHECKPOINT_FRAMING,
    checkpointOrdinals: null,
    debug: false,
    debugSink: null,
  };
}

const STAGE2_NODES: CompileNode[] = [
  {
    seq: 1,
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: "Please read a.js <ide_opened_file>a.js</ide_opened_file> and fix the bug",
        },
      ],
    },
  },
  {
    seq: 2,
    message: {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          id: "c1",
          name: "read",
          arguments: JSON.stringify({ file_path: "a.js" }),
        },
      ],
    },
  },
  {
    seq: 3,
    message: {
      role: "tool",
      toolCallId: "c1",
      content: [
        {
          type: "text",
          text: "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10",
        },
      ],
    },
  },
  {
    seq: 4,
    message: {
      role: "assistant",
      content: [{ type: "tool-call", id: "c2", name: "job_output", arguments: "{}" }],
    },
  },
  {
    seq: 5,
    message: {
      role: "assistant",
      content: [{ type: "reasoning", text: "hidden chain of thought here" }],
    },
  },
  {
    seq: 6,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "The bug is fixed now and everything passes" }],
    },
  },
  { seq: 7, message: null },
  { seq: 8, message: { role: "user", content: null } },
  { seq: 9, message: { role: "user", content: [null, { type: "text", text: "ok" }] } },
  {
    seq: 10,
    message: {
      role: "assistant",
      content: [{ type: "tool-call", id: "c3", name: "bash", arguments: "not-json{{{ " }],
    },
  },
  {
    seq: 11,
    message: {
      role: "user",
      content: [{ type: "text", text: "<system-reminder>noise</system-reminder>" }],
    },
  },
];

function bigRegionNodes(): CompileNode[] {
  const nodes: CompileNode[] = [];
  for (let index = 0; index < 30; index += 1) {
    nodes.push({
      seq: 100 + index * 2,
      message: {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: `k${index}`,
            name: "read",
            arguments: JSON.stringify({ file_path: `f${index}.js` }),
          },
        ],
      },
    });
    nodes.push({
      seq: 101 + index * 2,
      message: {
        role: "tool",
        toolCallId: `k${index}`,
        content: [{ type: "text", text: `output of f${index} `.repeat(40) }],
      },
    });
  }
  nodes.push({
    seq: 200,
    message: { role: "user", content: [{ type: "text", text: "final question here" }] },
  });
  return nodes;
}

test("stage-2 vectors match the original", () => {
  const config = stage2Config();
  const nodes = compileNodes(STAGE2_NODES, config, null);
  const region = compileRegion(bigRegionNodes(), { ...config, maxTokens: 200 });
  const bySeq = (seq: number): string | undefined =>
    nodes.entries.find(entry => entry.seq === seq)?.text;
  expect(nodes.entries.filter(entry => entry.kind === "tool").map(entryText)).toEqual([
    '[assistant]\n* read "a.js" (seq 2 -> result 3)',
    "[assistant]\n* bash (seq 10)",
  ]);
  expect(nodes.entries.map(entry => entry.kind)).toEqual([
    "text",
    "tool",
    "result",
    "text",
    "text",
    "tool",
    "note",
  ]);
  expect(nodes.entries.map(entry => entry.seq)).toEqual([1, 2, 3, 6, 9, 10, 11]);
  expect(bySeq(1)).toBe("[user]\nPlease read a.js  and fix the...(truncated from seq 1)");
  expect(bySeq(10)).toBe("[assistant]\n* bash (seq 10)");
  expect(bySeq(11)).toBe("[user]\n* [user message elided: noise-only] (seq 11)");
  expect(nodes.entries.some(entry => entry.seq === 4)).toBe(false);
  expect(nodes.entries.some(entry => entry.seq === 5)).toBe(false);
  expect(excerptToolResult("aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll", 6, "seq 3")).toBe(
    "aaa bbb ccc ddd eee fff ggg hhh...(truncated from seq 3)\n...(elided from seq 3)\n...(elided before seq 3) eee fff ggg hhh iii jjj kkk lll",
  );
  expect(stripNoiseXml("a <ide_selection>x</ide_selection> b", config.noisePatterns)).toBe("a  b");
  expect(
    joinCompiledEntries([
      { seq: 1, text: "* read (seq 1)", kind: "tool" },
      { seq: 2, text: "* edit (seq 2)", kind: "tool" },
      { seq: 3, text: "[user]\nhi", kind: "text" },
    ]),
  ).toBe("* read (seq 1)\n* edit (seq 2)\n\n[user]\nhi");
  expect(
    frameCheckpoint(["body line"], "H", "I", "F", DEFAULT_CHECKPOINT_FRAMING).map(
      block => block.text,
    ),
  ).toEqual([
    "This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.\n\n<compacted-checkpoint>",
    'RECALL: append-only log — nothing is lost. `recall` restores original content: type "seq", id "3-7"; "result", id "3"; "checkpoint", id "1" (`[checkpoint N]` = dropped). `search` finds by keyword.\n\nI\n\nH\n\nbody line\n\nF',
    "</compacted-checkpoint>",
  ]);
  expect(region.stats.tokens).toBe(198);
  expect(region.capped).toBe(true);
  expect(region.entries[0]?.kind).toBe("note");
  expect(region.entries[0]?.text).toBe("[55 tool/result entries elided: seqs 100-154]");
  expect(region.entries.length).toBe(7);
  expect(region.entries.every(entry => typeof entry.seq === "number")).toBe(true);
  expect(region.stats.tokens <= 200).toBe(true);
});

test("single-entry hard cap reports the truncated size", () => {
  const config = { ...stage2Config(), maxTokens: 8 };
  const nodes: CompileNode[] = [
    {
      seq: 1,
      message: {
        role: "user",
        content: [{ type: "text", text: "word ".repeat(200) }],
      },
    },
  ];
  const region = compileRegion(nodes, config);
  // One entry survives every elision pass, so the hard-cap branch fires.
  expect(region.entries.length).toBe(1);
  expect(region.capped).toBe(true);
  // The reported total must describe the stored entry, not its pre-cut text.
  expect(region.stats.tokens).toBe(estimateEntryTokens(region.entries[0]?.text ?? ""));
});
