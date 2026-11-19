import { expect, test } from "vitest";

import { isCheckpointSource, projectToolResultText } from "./compiler.ts";
import {
  DEFAULT_MAX_RECALL_TOKENS,
  expandSelections,
  findCheckpointSeqs,
  MAX_RECALL_SPAN,
  parseSeqSpec,
  projectMessageText,
  recallSession,
  resolveRecallReference,
} from "./recall.ts";
import { hasSessionEventAccess, sessionEventAt, sessionEvents } from "./session-compat.ts";

// ── stage 3: recall core ─────────────────────────────────────────────────
// Oracle vectors captured from the original dsh-compaction-vcc@0.7.4
// `src/recall.js` (port selftest run 2026-11-19).

const EVENTS3 = [
  { seq: 1, type: "user/message", data: { source: { kind: "user" } } },
  { seq: 2, type: "assistant/message", data: {} },
  { seq: 3, type: "assistant/message", data: {} },
  { seq: 4, type: "tool/result", data: { result: "file contents line one two three" } },
  {
    seq: 5,
    type: "user/message",
    data: { source: { kind: "compact-checkpoint", compactionId: "c1" } },
  },
  { seq: 6, type: "session/marker", data: { note: "log only event" } },
  { seq: 7, type: "assistant/message", data: {} },
];

const MESSAGES3: Record<
  number,
  {
    role: string;
    toolCallId?: string;
    content: { type: string; text?: string; id?: string; name?: string; arguments?: string }[];
  }
> = {
  1: { role: "user", content: [{ type: "text", text: "hello world this is the first question" }] },
  2: {
    role: "assistant",
    content: [{ type: "text", text: "Here is the answer with many details inside" }],
  },
  3: {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        id: "t1",
        name: "read",
        arguments: JSON.stringify({ file_path: "a.js" }),
      },
    ],
  },
  4: {
    role: "tool",
    toolCallId: "t1",
    content: [{ type: "text", text: "file contents here line1 line2 line3 line4" }],
  },
  5: {
    role: "user",
    content: [{ type: "text", text: "prior checkpoint body that was compiled earlier and framed" }],
  },
  7: {
    role: "assistant",
    content: [
      { type: "reasoning", text: "private chain of thought" },
      { type: "text", text: "final visible answer" },
    ],
  },
};

// The derive function returns untyped records (as a host would); the recall
// core guards them with isRecord before projecting.
const SESSION3 = {
  events: EVENTS3,
  deriveEventMessage(event: { seq: number }): unknown {
    return (MESSAGES3[event.seq] ?? null) as unknown;
  },
};

test("stage-3 vectors match the original", () => {
  const out = {
    spec12: parseSeqSpec("12"),
    specRange: parseSeqSpec("3-7,15"),
    specSeqWord: parseSeqSpec("seq 12"),
    specParen: parseSeqSpec("(seqs 3-7)"),
    specEmpty: parseSeqSpec(""),
    specBad: parseSeqSpec("abc"),
    specReversed: parseSeqSpec("7-3"),
    specZero: parseSeqSpec("0"),
    specWide: parseSeqSpec("1-2000"),
    specUnsafe: parseSeqSpec("9007199254740993"),
    expand: expandSelections([
      { start: 1, end: 3 },
      { start: 2, end: 5 },
    ]),
    project: projectMessageText({
      role: "assistant",
      content: [
        { type: "text", text: "hi" },
        { type: "reasoning", text: "think" },
        { type: "tool-call", name: "edit", arguments: "{}" },
        { type: "tool-result", content: [{ type: "text", text: "done" }] },
        { type: "image" },
        { type: "document" },
        { type: "weird" },
      ],
    }),
    checkpoints: findCheckpointSeqs(SESSION3),
    refSeq: resolveRecallReference(SESSION3, "seq", "1-2,5"),
    refResult: resolveRecallReference(SESSION3, "result", "result 4"),
    refResultBare: resolveRecallReference(SESSION3, "result", "4"),
    refResultMissing: resolveRecallReference(SESSION3, "result", "result 99"),
    refResultWrongKind: resolveRecallReference(SESSION3, "result", "2"),
    refCheckpoint: resolveRecallReference(SESSION3, "checkpoint", "1"),
    refCheckpointMissing: resolveRecallReference(SESSION3, "checkpoint", "checkpoint 2"),
    refCheckpointSeq: resolveRecallReference(SESSION3, "checkpoint", "seq 5"),
    refCheckpointNotNode: resolveRecallReference(SESSION3, "checkpoint", "seq 2"),
    refBogus: resolveRecallReference(SESSION3, "bogus", "1"),
    full: recallSession(SESSION3, [{ start: 1, end: 2 }], { maxRecallTokens: 16000 }),
    missing: recallSession(SESSION3, [{ start: 99, end: 99 }], { maxRecallTokens: 16000 }),
    logOnly: recallSession(SESSION3, [{ start: 6, end: 6 }], { maxRecallTokens: 16000 }),
    tight: recallSession(SESSION3, [{ start: 1, end: 7 }], { maxRecallTokens: 30 }),
    consts: [DEFAULT_MAX_RECALL_TOKENS, MAX_RECALL_SPAN],
    access: [
      hasSessionEventAccess(SESSION3),
      hasSessionEventAccess(null),
      hasSessionEventAccess({}),
      hasSessionEventAccess({ events: [] }),
    ],
  };
  expect(JSON.parse(JSON.stringify(out))).toEqual({
    spec12: { selections: [{ start: 12, end: 12 }], errors: [] },
    specRange: {
      selections: [
        { start: 3, end: 7 },
        { start: 15, end: 15 },
      ],
      errors: [],
    },
    specSeqWord: { selections: [{ start: 12, end: 12 }], errors: [] },
    specParen: { selections: [{ start: 3, end: 7 }], errors: [] },
    specEmpty: { selections: [], errors: ["missing seq selection"] },
    specBad: { selections: [], errors: ['invalid seq selection "abc"'] },
    specReversed: { selections: [], errors: ['invalid seq range "7-3" (end before start)'] },
    specZero: { selections: [], errors: ['invalid seq selection "0" (seq starts at 1)'] },
    specWide: { selections: [], errors: ['seq range "1-2000" is wider than the 1000-seq limit'] },
    specUnsafe: {
      selections: [],
      errors: ['seq selection "9007199254740993" is outside the safe integer range'],
    },
    expand: [1, 2, 3, 4, 5],
    project:
      "hi\n[reasoning]\nthink\n[tool-call edit]\n{}\n[tool-result]\ndone\n[image]\n[document]\n[weird]",
    checkpoints: [5],
    refSeq: {
      selections: [
        { start: 1, end: 2 },
        { start: 5, end: 5 },
      ],
      errors: [],
    },
    refResult: { selections: [{ start: 4, end: 4 }], errors: [] },
    refResultBare: { selections: [{ start: 4, end: 4 }], errors: [] },
    refResultMissing: { selections: [], errors: ["result seq 99 not found in this session"] },
    refResultWrongKind: {
      selections: [],
      errors: ["seq 2 is not a tool result (it is assistant/message)"],
    },
    refCheckpoint: { selections: [{ start: 5, end: 5 }], errors: [] },
    refCheckpointMissing: {
      selections: [],
      errors: ["checkpoint 2 not found (this session has 1 checkpoint(s))"],
    },
    refCheckpointSeq: { selections: [{ start: 5, end: 5 }], errors: [] },
    refCheckpointNotNode: { selections: [], errors: ["seq 2 is not a checkpoint node"] },
    refBogus: {
      selections: [],
      errors: ['invalid recall type "bogus" (expected "seq", "result", or "checkpoint")'],
    },
    full: {
      text: "[seq 1: user]\nhello world this is the first question\n\n[seq 2: assistant]\nHere is the answer with many details inside",
      entries: [
        { seq: 1, text: "[seq 1: user]\nhello world this is the first question", truncated: false },
        {
          seq: 2,
          text: "[seq 2: assistant]\nHere is the answer with many details inside",
          truncated: false,
        },
      ],
      seqs: [1, 2],
      recalled: 2,
      missing: 0,
      skipped: 0,
      truncated: false,
      tokens: 35,
    },
    missing: {
      text: "[seq 99: not found in this session]",
      entries: [{ seq: 99, text: "[seq 99: not found in this session]" }],
      seqs: [],
      recalled: 0,
      missing: 1,
      skipped: 0,
      truncated: false,
      tokens: 11,
    },
    logOnly: {
      text: '[seq 6: session/marker]\n{"note":"log only event"}',
      entries: [
        {
          seq: 6,
          text: '[seq 6: session/marker]\n{"note":"log only event"}',
          truncated: false,
        },
      ],
      seqs: [6],
      recalled: 1,
      missing: 0,
      skipped: 0,
      truncated: false,
      tokens: 19,
    },
    tight: {
      text: "[seq 1: user]\nhello world this is the first question\n\n[seq 2: assistant]\nHere is the answer with many details...(truncated from recall budget)\n\n[recall budget exhausted: 5 further requested seq(s) not included]",
      entries: [
        { seq: 1, text: "[seq 1: user]\nhello world this is the first question", truncated: false },
        {
          seq: 2,
          text: "[seq 2: assistant]\nHere is the answer with many details...(truncated from recall budget)",
          truncated: true,
        },
        { seq: 3, text: "[recall budget exhausted: 5 further requested seq(s) not included]" },
      ],
      seqs: [1, 2],
      recalled: 2,
      missing: 0,
      skipped: 5,
      truncated: true,
      tokens: 63,
    },
    consts: [16000, 1000],
    access: [true, false, false, true],
  });
});

test("recall core is deterministic across runs", () => {
  const first = JSON.stringify(
    recallSession(SESSION3, [{ start: 1, end: 7 }], { maxRecallTokens: 16000 }),
  );
  expect(
    JSON.stringify(recallSession(SESSION3, [{ start: 1, end: 7 }], { maxRecallTokens: 16000 })),
  ).toBe(first);
  expect(sessionEventAt(SESSION3, 1)?.seq).toBe(1);
  expect(sessionEvents(SESSION3)).toHaveLength(7);
  expect(isCheckpointSource({ kind: "compact-checkpoint" })).toBe(true);
  expect(projectToolResultText([{ type: "text", text: "x" }])).toBe("x");
});
