import { expect, test } from "vitest";

import {
  cutExcerpt,
  DEFAULT_RECALL_CROSS_TOP_N,
  RECALL_CROSS_EXCERPT_WINDOW,
  rankRecall,
} from "./ranking.ts";
import type { RecallQuery, SessionRecord } from "./types.ts";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function record(overrides: Partial<SessionRecord> & { sessionId: string }): SessionRecord {
  return {
    harness: "dsh",
    project: "home",
    timestamp: NOW - DAY,
    seq: 1,
    kind: "user",
    text: "plain text",
    pointer: `dsh:${overrides.sessionId}:1`,
    howToPull: `session file + seq 1`,
    ...overrides,
  };
}

function query(overrides: Partial<RecallQuery> = {}): RecallQuery {
  return {
    keywords: ["alpha"],
    scope: { project: "home", peers: ["tvmrss"] },
    ...overrides,
  };
}

// ── ordering: keyword hits beat recency ─────────────────────────────────

test("more distinct keyword matches outrank fewer, regardless of age", () => {
  const old = record({ sessionId: "old", timestamp: NOW - 20 * DAY, text: "alpha beta gamma" });
  const fresh = record({ sessionId: "new", timestamp: NOW, text: "alpha nothing else" });
  const hits = rankRecall([fresh, old], query({ keywords: ["alpha", "beta", "gamma"] }), NOW);
  expect(hits.map(hit => hit.record.sessionId)).toEqual(["old", "new"]);
});

test("recency orders records with equal hits", () => {
  const old = record({ sessionId: "old", timestamp: NOW - 10 * DAY, text: "alpha here" });
  const fresh = record({ sessionId: "new", timestamp: NOW, text: "alpha here" });
  const hits = rankRecall([old, fresh], query(), NOW);
  expect(hits.map(hit => hit.record.sessionId)).toEqual(["new", "old"]);
});

test("distinct hits dominate raw occurrence count", () => {
  const spammy = record({ sessionId: "spammy", text: `alpha ${"alpha ".repeat(2000)}` });
  const varied = record({ sessionId: "varied", text: "alpha beta" });
  const hits = rankRecall([spammy, varied], query({ keywords: ["alpha", "beta"] }), NOW);
  expect(hits.map(hit => hit.record.sessionId)).toEqual(["varied", "spammy"]);
});

test("occurrences order records with equal distinct hits", () => {
  const once = record({ sessionId: "once", text: "alpha beta" });
  const twice = record({ sessionId: "twice", text: "alpha alpha beta" });
  const hits = rankRecall([once, twice], query({ keywords: ["alpha", "beta"] }), NOW);
  expect(hits.map(hit => hit.record.sessionId)).toEqual(["twice", "once"]);
});

test("tool rows lose ties at equal score", () => {
  const at = NOW - DAY;
  const tool = record({ sessionId: "a-tool", timestamp: at, kind: "tool", text: "alpha here" });
  const human = record({ sessionId: "z-human", timestamp: at, kind: "user", text: "alpha here" });
  const hits = rankRecall([tool, human], query(), NOW);
  expect(hits.map(hit => hit.record.sessionId)).toEqual(["z-human", "a-tool"]);
});

test("ties break deterministically on session id then seq", () => {
  const at = NOW - DAY;
  const b = record({ sessionId: "b", timestamp: at, text: "alpha here" });
  const a = record({ sessionId: "a", timestamp: at, text: "alpha here" });
  const hits = rankRecall([b, a], query(), NOW);
  expect(hits.map(hit => hit.record.sessionId)).toEqual(["a", "b"]);
});

// ── scope: same-project first, peers next, out-of-scope excluded ──────────

test("same-project outranks peer with more hits", () => {
  const peer = record({
    sessionId: "peer",
    project: "tvmrss",
    timestamp: NOW,
    text: "alpha alpha alpha",
  });
  const home = record({ sessionId: "home", timestamp: NOW - 20 * DAY, text: "alpha" });
  const hits = rankRecall([peer, home], query(), NOW);
  expect(hits.map(hit => hit.record.sessionId)).toEqual(["home", "peer"]);
});

test("out-of-scope rows are excluded, not downranked", () => {
  const outsider = record({
    sessionId: "outsider",
    project: "finnomena",
    timestamp: NOW,
    text: "alpha alpha alpha alpha",
  });
  const home = record({ sessionId: "home", text: "alpha" });
  const hits = rankRecall([outsider, home], query(), NOW);
  expect(hits.map(hit => hit.record.sessionId)).toEqual(["home"]);
});

test("harness filter excludes the other harness", () => {
  const oc = record({ sessionId: "oc", harness: "opencode", text: "alpha alpha" });
  const dsh = record({ sessionId: "dsh", text: "alpha" });
  const hits = rankRecall([oc, dsh], query({ harness: "dsh" }), NOW);
  expect(hits.map(hit => hit.record.sessionId)).toEqual(["dsh"]);
});

// ── topN ──────────────────────────────────────────────────────────────────

test("topN defaults to 5", () => {
  expect(DEFAULT_RECALL_CROSS_TOP_N).toBe(5);
  const records = Array.from({ length: 7 }, (_, i) =>
    record({ sessionId: `s${i}`, timestamp: NOW - i, text: "alpha" }),
  );
  expect(rankRecall(records, query(), NOW)).toHaveLength(5);
});

test("explicit topN overrides the default", () => {
  const records = Array.from({ length: 7 }, (_, i) =>
    record({ sessionId: `s${i}`, timestamp: NOW - i, text: "alpha" }),
  );
  expect(rankRecall(records, query({ topN: 2 }), NOW)).toHaveLength(2);
});

// ── excerpts ──────────────────────────────────────────────────────────────

test("excerpt centers on the best hit with ellipsis at cut edges", () => {
  const pad = "x".repeat(1000);
  const text = `${pad} alpha ${pad}`;
  const excerpt = cutExcerpt(text, ["alpha"]);
  expect(excerpt.length).toBeLessThanOrEqual(RECALL_CROSS_EXCERPT_WINDOW + 2);
  expect(excerpt).toContain("alpha");
  expect(excerpt.startsWith("…")).toBe(true);
  expect(excerpt.endsWith("…")).toBe(true);
});

test("excerpt of short text has no ellipsis", () => {
  expect(cutExcerpt("alpha here", ["alpha"])).toBe("alpha here");
});

test("excerpt without keywords takes the head", () => {
  const text = `y`.repeat(RECALL_CROSS_EXCERPT_WINDOW + 10);
  const excerpt = cutExcerpt(text, ["   "]);
  expect(excerpt.endsWith("…")).toBe(true);
  expect(excerpt.length).toBe(RECALL_CROSS_EXCERPT_WINDOW + 1);
});

test("ranked hits carry excerpts of their own record", () => {
  const hits = rankRecall(
    [record({ sessionId: "s", text: "something alpha something" })],
    query(),
    NOW,
  );
  expect(hits).toHaveLength(1);
  expect(hits[0]?.excerpt).toContain("alpha");
});
