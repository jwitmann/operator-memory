import { expect, test } from "vitest";

import {
  compileSearchPattern,
  DEFAULT_MAX_SEARCH_HITS,
  InvalidSearchPatternError,
  MAX_LINES_PER_HIT,
  searchSession,
} from "./search.ts";

// ── stage 4: search core ─────────────────────────────────────────────────
// Oracle vectors captured from the original dsh-compaction-vcc@0.7.4
// `src/search.js` (port selftest run 2026-11-19). The fixture is 0-based
// positional (index i holds seq i), matching the upstream positional scan
// (`events[seq]`, `event.seq === seq`) carried verbatim.

const NEEDLE_LINES4 = Array.from({ length: 15 }, (_, index) => `needle line number ${index}`).join(
  "\n",
);

const EVENTS4 = [
  { seq: 0, type: "session/start", data: { v: 1 } },
  { seq: 1, type: "user/message", data: {} },
  { seq: 2, type: "assistant/message", data: {} },
  { seq: 3, type: "assistant/message", data: {} },
  { seq: 4, type: "tool/result", data: { trace: "stack trace line one\nstack trace line two" } },
  { seq: 5, type: "user/message", data: {} },
  { seq: 6, type: "assistant/message", data: {} },
];

const MESSAGES4: Record<
  number,
  {
    role: string;
    content: { type: string; text?: string; id?: string; name?: string; arguments?: string }[];
  }
> = {
  1: { role: "user", content: [{ type: "text", text: "please fix the login bug urgently" }] },
  2: { role: "assistant", content: [{ type: "text", text: "the bug is in auth.js, fixing now" }] },
  3: {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        id: "t9",
        name: "read",
        arguments: JSON.stringify({ file_path: "auth.js" }),
      },
    ],
  },
  5: { role: "user", content: [{ type: "text", text: "thanks, also check the logout flow" }] },
  6: { role: "assistant", content: [{ type: "text", text: NEEDLE_LINES4 }] },
};

const SESSION4 = {
  events: EVENTS4,
  deriveEventMessage(event: { seq: number }): unknown {
    return (MESSAGES4[event.seq] ?? null) as unknown;
  },
};

// Error text ends in the regex engine's own message, which varies by runtime
// version — the helper returns the full string; call sites pin a stable
// prefix with a single slice (one idiom: slice at use, never inside).
function patternError(source: unknown): string {
  try {
    compileSearchPattern(source);
    return "NO-THROW";
  } catch (error) {
    return `${(error as Error).constructor.name}: ${String((error as Error).message)}`;
  }
}

test("stage-4 vectors match the original", () => {
  const out = {
    patternSource: compileSearchPattern("bug").source,
    patternFlags: compileSearchPattern("bug").flags,
    errEmpty: patternError("   "),
    errBadPrefix: patternError("([").slice(0, 44),
    hitsBug: searchSession(SESSION4, "bug", { maxSearchHits: 50, maxRecallTokens: 16000 }),
    hitsRead: searchSession(SESSION4, "read", {
      maxSearchHits: 50,
      maxRecallTokens: 16000,
    }).hits.map(hit => hit.seq),
    hitsTrace: searchSession(SESSION4, "trace", {
      maxSearchHits: 50,
      maxRecallTokens: 16000,
    }).hits.map(hit => [hit.seq, hit.kind]),
    hitsNone: searchSession(SESSION4, "zzz-no-such-token", {
      maxSearchHits: 50,
      maxRecallTokens: 16000,
    }),
    capHits: searchSession(SESSION4, "e", { maxSearchHits: 1, maxRecallTokens: 16000 }),
    capBudget: searchSession(SESSION4, "e", { maxSearchHits: 50, maxRecallTokens: 20 }),
    manyLines: searchSession(SESSION4, "needle", { maxSearchHits: 50, maxRecallTokens: 16000 })
      .hits[0]?.text,
    consts: [DEFAULT_MAX_SEARCH_HITS, MAX_LINES_PER_HIT],
  };
  expect(JSON.parse(JSON.stringify(out))).toEqual({
    patternSource: "bug",
    patternFlags: "iu",
    errEmpty: 'InvalidSearchPatternError: invalid search pattern "   ": pattern is empty',
    errBadPrefix: "InvalidSearchPatternError: invalid search pa",
    hitsBug: {
      pattern: "bug",
      totalMatches: 2,
      hits: [
        { seq: 1, kind: "user", text: "[seq 1: user]\n  1: please fix the login bug urgently" },
        {
          seq: 2,
          kind: "assistant",
          text: "[seq 2: assistant]\n  1: the bug is in auth.js, fixing now",
        },
      ],
      omitted: 0,
      truncated: false,
      tokens: 34,
      text: '[search "bug": 2 matching event(s)]\n\n[seq 1: user]\n  1: please fix the login bug urgently\n\n[seq 2: assistant]\n  1: the bug is in auth.js, fixing now\n\n[use recall with a (seq N) pointer to restore any hit\'s full original content]',
    },
    hitsRead: [3],
    hitsTrace: [[4, "tool/result"]],
    hitsNone: {
      pattern: "zzz-no-such-token",
      totalMatches: 0,
      hits: [],
      omitted: 0,
      truncated: false,
      tokens: 0,
      text: '[search "zzz-no-such-token": 0 matching event(s)]',
    },
    capHits: {
      pattern: "e",
      totalMatches: 7,
      hits: [
        { seq: 0, kind: "session/start", text: "[seq 0: session/start]\n  1: [session/start]" },
      ],
      omitted: 6,
      truncated: true,
      tokens: 15,
      text: '[search "e": 7 matching event(s)]\n\n[seq 0: session/start]\n  1: [session/start]\n\n[6 more matching event(s) omitted — narrow the pattern or use recall]\n\n[search budget exhausted; some hits were cut]\n\n[use recall with a (seq N) pointer to restore any hit\'s full original content]',
    },
    capBudget: {
      pattern: "e",
      totalMatches: 7,
      hits: [
        { seq: 0, kind: "session/start", text: "[seq 0: session/start]\n  1: [session/start]" },
        { seq: 1, kind: "user", text: "[seq 1: user...(truncated from search budget)" },
      ],
      omitted: 5,
      truncated: true,
      tokens: 29,
      text: '[search "e": 7 matching event(s)]\n\n[seq 0: session/start]\n  1: [session/start]\n\n[seq 1: user...(truncated from search budget)\n\n[5 more matching event(s) omitted — narrow the pattern or use recall]\n\n[search budget exhausted; some hits were cut]\n\n[use recall with a (seq N) pointer to restore any hit\'s full original content]',
    },
    manyLines:
      "[seq 6: assistant]\n  1: needle line number 0\n  2: needle line number 1\n  3: needle line number 2\n  4: needle line number 3\n  5: needle line number 4\n  6: needle line number 5\n  7: needle line number 6\n  8: needle line number 7\n  9: needle line number 8\n  10: needle line number 9\n  ...(5 more matching lines in this event)",
    consts: [50, 10],
  });
});

test("search core is deterministic across runs", () => {
  const first = JSON.stringify(
    searchSession(SESSION4, "bug", { maxSearchHits: 50, maxRecallTokens: 16000 }),
  );
  expect(
    JSON.stringify(searchSession(SESSION4, "bug", { maxSearchHits: 50, maxRecallTokens: 16000 })),
  ).toBe(first);
  expect(patternError("   ")).toContain("pattern is empty");
  expect(new InvalidSearchPatternError("x", "y").source).toBe("x");
});
