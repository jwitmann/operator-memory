import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { RECALL_CROSS_EXCERPT_HEADER } from "@jwitmann/vcc-brain-core/recall-cross/ranking";
import { Effect, type FileSystem, Layer, type Path } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";

import {
  forgetSession,
  recallIndexPaths,
  syncDshIndex,
} from "../src/commands/recall-cross/index.ts";
import {
  isOpencodeCold,
  opencodeSessionRecords,
  openSourceDb,
  parseAssistantText,
  parseToolPart,
  parseUserText,
  syncOpencodeIndex,
} from "../src/commands/recall-cross/opencode.ts";
import { queryRecall, recallSessionTurns } from "../src/commands/recall-cross/query.ts";

const services = Layer.merge(NodeFileSystem.layer, NodePath.layer);

let directory: string;
let sessions: string;
let sourceDb: string;

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const SOURCE_SCHEMA = `
CREATE TABLE session_v2(id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT NOT NULL);
CREATE TABLE session_message(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
CREATE UNIQUE INDEX session_message_session_seq_idx ON session_message(session_id,seq);
CREATE INDEX session_message_time_created_idx ON session_message(time_created);
CREATE TABLE session_part(message_id TEXT NOT NULL, session_id TEXT NOT NULL, ordinal INTEGER NOT NULL, type TEXT NOT NULL, call_id TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(message_id, ordinal));
CREATE INDEX session_part_session_message_idx ON session_part(session_id,message_id,ordinal);
`;

function seedSource(): DatabaseSync {
  const db = new DatabaseSync(sourceDb);
  db.exec(SOURCE_SCHEMA);
  // One transaction: autocommit-per-row fsyncs stall under suite load.
  db.exec("BEGIN");
  const session = db.prepare("INSERT INTO session_v2 VALUES(?, ?, ?)");
  const message = db.prepare("INSERT INTO session_message VALUES(?, ?, ?, ?, ?, ?, ?)");
  session.run("ses_aaa", "/proj", "atlas work");
  message.run(
    "msg_a1",
    "ses_aaa",
    "user",
    0,
    NOW - DAY,
    NOW - DAY,
    JSON.stringify({ text: JSON.stringify("the atlas decision was hexagonal") }),
  );
  message.run(
    "msg_a2",
    "ses_aaa",
    "assistant",
    1,
    NOW - DAY,
    NOW - DAY,
    JSON.stringify({
      content: [
        { type: "reasoning", text: "considering atlas options" },
        { type: "text", text: "hexagonal layout chosen for atlas" },
      ],
    }),
  );
  message.run(
    "msg_a3",
    "ses_aaa",
    "compaction",
    2,
    NOW - DAY,
    NOW - DAY,
    JSON.stringify({ status: "completed" }),
  );
  const part = db.prepare("INSERT INTO session_part VALUES(?, ?, ?, ?, ?, ?, ?, ?)");
  part.run(
    "msg_a2",
    "ses_aaa",
    0,
    "tool",
    "call_1",
    NOW - DAY,
    NOW - DAY,
    JSON.stringify({ name: "shell", state: { status: "completed", input: { command: "ls" } } }),
  );
  part.run(
    "msg_a2",
    "ses_aaa",
    1,
    "tool",
    "call_2",
    NOW - DAY,
    NOW - DAY,
    JSON.stringify({ name: "read", state: { status: "completed", input: { path: "a.js" } } }),
  );
  session.run("ses_opt", "/proj", "[no-recall]");
  message.run(
    "msg_o1",
    "ses_opt",
    "user",
    0,
    NOW - DAY,
    NOW - DAY,
    JSON.stringify({ text: "opted out decision" }),
  );
  session.run("ses_pol", "/proj", "polluted");
  message.run(
    "msg_p1",
    "ses_pol",
    "user",
    0,
    NOW - DAY,
    NOW - DAY,
    JSON.stringify({ text: `${RECALL_CROSS_EXCERPT_HEADER} old excerpt` }),
  );
  db.prepare("INSERT INTO session_part VALUES(?, ?, ?, ?, ?, ?, ?, ?)").run(
    "msg_p1",
    "ses_pol",
    0,
    "tool",
    "call_9",
    NOW - DAY,
    NOW - DAY,
    JSON.stringify({
      name: "vcc-brain-search-sessions",
      state: { status: "completed", input: { keywords: "x" } },
    }),
  );
  db.exec("COMMIT");
  return db;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vcc-brain-recall-cross-opencode-"));
  sessions = join(directory, "sessions");
  mkdirSync(sessions, { recursive: true });
  sourceDb = join(directory, "opencode.db");
});

// Seeded explicitly by the tests that open the source db: parser tests
// never pay sqlite setup, keeping every beforeEach hook millisecond-class
// even under full-suite parallel load (the 10s hook-timeout flake class).
function seed(): void {
  seedSource().close();
}

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function run<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(services)));
}

function home(): string {
  return join(directory, "home");
}

async function prime() {
  const paths = recallIndexPaths(home());
  await run(syncDshIndex(paths, sessions, NOW));
  return paths;
}

test("user text unwraps one JSON encoding level", () => {
  expect(parseUserText(JSON.stringify({ text: JSON.stringify("plain prompt") }))).toBe(
    "plain prompt",
  );
  expect(parseUserText(JSON.stringify({ text: "already raw" }))).toBe("already raw");
  expect(parseUserText(JSON.stringify({ text: "   " }))).toBeNull();
  expect(parseUserText("not json at all")).toBe("not json at all");
  expect(parseUserText(JSON.stringify({ other: 1 }))).toBeNull();
});

test("assistant text joins text and reasoning items", () => {
  expect(
    parseAssistantText(
      JSON.stringify({
        content: [
          { type: "reasoning", text: "hmm" },
          { type: "text", text: "done" },
        ],
      }),
    ),
  ).toBe("hmm\ndone");
  expect(parseAssistantText(JSON.stringify({ content: [{ type: "tool", text: "x" }] }))).toBeNull();
  expect(parseAssistantText("broken")).toBeNull();
});

test("tool parts name the call, cap input, and skip recall tools", () => {
  const row = parseToolPart(
    JSON.stringify({ name: "shell", state: { status: "done", input: { command: "ls" } } }),
  );
  expect(row?.text).toContain("tool shell");
  expect(row?.text).toContain("ls");
  expect(
    parseToolPart(
      JSON.stringify({
        name: "vcc-brain-search-sessions",
        state: { status: "done", input: {} },
      }),
    ),
  ).toBeNull();
  const big = parseToolPart(
    JSON.stringify({ name: "shell", state: { input: { blob: "x".repeat(5000) } } }),
  );
  expect(big !== null && big.text.length < 5000).toBe(true);
});

test("opt-out titles and header-bearing turns never index", () => {
  const kept = opencodeSessionRecords(
    "s",
    "proj",
    "fine",
    [{ type: "user", seq: 0, time: NOW, data: JSON.stringify({ text: "keep me" }) }],
    [],
  );
  expect(kept.records).toHaveLength(1);
  const opted = opencodeSessionRecords(
    "s",
    "proj",
    "  [no-recall] ",
    [{ type: "user", seq: 0, time: NOW, data: JSON.stringify({ text: "drop me" }) }],
    [],
  );
  expect(opted.records).toHaveLength(0);
});

test("sync indexes sessions, skips opt-out and polluted rows", async () => {
  seed();
  const paths = await prime();
  const summary = await run(syncOpencodeIndex(paths, [sourceDb], NOW));
  expect(summary.filesRead).toBe(3);
  expect(summary.turnsIndexed).toBe(4);
  // ses_pol indexed nothing (every turn skipped) but was read: loud skip.
  expect(summary.filesSkipped).toEqual([
    { file: `${sourceDb}#ses_pol`, reason: "no-indexable-turns" },
  ]);
  const cold = await run(isOpencodeCold(paths.sqlite));
  expect(cold).toBe(false);
  const result = await run(
    queryRecall(
      paths,
      sessions,
      {
        keywords: ["hexagonal"],
        project: "proj",
        peers: [],
        now: NOW,
        opencodeDbPaths: [sourceDb],
      },
      home(),
    ),
  );
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("opencode:ses_aaa");
  expect(result.output).not.toContain("opted out");
  const polluted = await run(
    queryRecall(
      paths,
      sessions,
      {
        keywords: ["polluted"],
        project: "proj",
        peers: [],
        now: NOW,
        opencodeDbPaths: [sourceDb],
      },
      home(),
    ),
  );
  expect(polluted.output).toBe("No matching turns.");
}, 30_000);

test("unchanged db is a no-op; new messages reindex one session", async () => {
  seed();
  const paths = await prime();
  await run(syncOpencodeIndex(paths, [sourceDb], NOW));
  const second = await run(syncOpencodeIndex(paths, [sourceDb], NOW));
  expect(second.filesRead).toBe(0);
  expect(second.turnsIndexed).toBe(0);
  const db = new DatabaseSync(sourceDb);
  const later = NOW - DAY + 1;
  db.prepare("INSERT INTO session_message VALUES(?, ?, ?, ?, ?, ?, ?)").run(
    "msg_a9",
    "ses_aaa",
    "user",
    9,
    later,
    later,
    JSON.stringify({ text: "follow-up quilt decision" }),
  );
  db.close();
  const third = await run(syncOpencodeIndex(paths, [sourceDb], later + DAY));
  expect(third.filesRead).toBe(1);
  const hit = await run(
    queryRecall(
      paths,
      sessions,
      {
        keywords: ["quilt"],
        project: "proj",
        peers: [],
        now: later + DAY,
        opencodeDbPaths: [sourceDb],
      },
      home(),
    ),
  );
  expect(hit.output).toContain("opencode:ses_aaa");
}, 30_000);

test("recall resolves the opaque pointer back to full text", async () => {
  seed();
  const paths = await prime();
  await run(syncOpencodeIndex(paths, [sourceDb], NOW));
  const full = await run(
    recallSessionTurns(paths, sessions, "opencode:ses_aaa", null, NOW, home(), [sourceDb]),
  );
  expect(full.exitCode).toBe(0);
  expect(full.output).toContain("the atlas decision was hexagonal");
  expect(full.output).toContain("hexagonal layout chosen for atlas");
  expect(full.output).toContain("tool shell");
  // Both tool calls on one message survive (ordinal-keyed, CR1).
  expect(full.output).toContain("tool read");
  const single = await run(
    recallSessionTurns(paths, sessions, "opencode:ses_aaa", 1, NOW, home(), [sourceDb]),
  );
  expect(single.output).toContain("hexagonal layout chosen");
  expect(single.output).not.toContain("atlas decision was");
  const missing = await run(
    recallSessionTurns(paths, sessions, "opencode:ses_nope", null, NOW, home(), [sourceDb]),
  );
  expect(missing.output).toBe("not-found");
}, 30_000);

test("cold OpenCode store is a clean error on the query path", async () => {
  seed();
  const paths = await prime();
  const result = await run(
    queryRecall(
      paths,
      sessions,
      {
        keywords: ["hexagonal"],
        project: "proj",
        peers: [],
        harness: "opencode",
        now: NOW,
        opencodeDbPaths: [sourceDb],
      },
      home(),
    ),
  );
  expect(result.exitCode).toBe(2);
  expect(result.output).toContain("recall-cross index");
}, 15_000);

test("forget deletes OpenCode rows, unknown ids stay silent", async () => {
  seed();
  const paths = await prime();
  await run(syncOpencodeIndex(paths, [sourceDb], NOW));
  const deleted = await run(forgetSession(paths, "opencode:ses_aaa", { now: NOW, actor: "test" }));
  expect(deleted.exitCode).toBe(0);
  expect(deleted.output).toBe("deleted 4");
  // Read the index directly: the recall path would re-sync the session from
  // the still-present source db, so absence is asserted without a sync.
  const probe = new DatabaseSync(paths.sqlite);
  const remaining = probe
    .prepare("SELECT COUNT(*) AS n FROM turns WHERE session_id = ?")
    .get("opencode:ses_aaa") as { n: number };
  expect(remaining.n).toBe(0);
  probe.close();
  await run(syncOpencodeIndex(paths, [sourceDb], NOW));
  const stillGone = new DatabaseSync(paths.sqlite);
  const after = stillGone
    .prepare("SELECT COUNT(*) AS n FROM turns WHERE session_id = ?")
    .get("opencode:ses_aaa") as { n: number };
  expect(after.n).toBe(0);
  stillGone.close();
  const unknown = await run(forgetSession(paths, "opencode:ses_nope", { now: NOW }));
  expect(unknown.exitCode).toBe(0);
  expect(unknown.output).toBe("not-found");
}, 30_000);

test("db without a parts table still syncs messages", async () => {
  seed();
  const noParts = join(directory, "noparts.db");
  const db = new DatabaseSync(noParts);
  db.exec(
    "CREATE TABLE session_v2(id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT NOT NULL);",
  );
  db.exec(
    "CREATE TABLE session_message(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);",
  );
  db.exec(
    "CREATE UNIQUE INDEX session_message_session_seq_idx ON session_message(session_id,seq);",
  );
  db.exec("BEGIN");
  db.prepare("INSERT INTO session_v2 VALUES(?, ?, ?)").run("ses_np", "/proj", "plain");
  db.prepare("INSERT INTO session_message VALUES(?, ?, ?, ?, ?, ?, ?)").run(
    "m1",
    "ses_np",
    "user",
    0,
    NOW,
    NOW,
    JSON.stringify({ text: "no parts here" }),
  );
  db.exec("COMMIT");
  db.close();
  const paths = await prime();
  const summary = await run(syncOpencodeIndex(paths, [noParts], NOW));
  expect(summary.turnsIndexed).toBe(1);
  const hit = await run(
    recallSessionTurns(paths, sessions, "opencode:ses_np", null, NOW, home(), [noParts]),
  );
  expect(hit.output).toContain("no parts here");
}, 15_000);

test("source opens read-only: writes throw", async () => {
  seed();
  const source = await run(openSourceDb(sourceDb));
  try {
    expect(() => source.db.exec("CREATE TABLE write_probe(x)")).toThrow();
  } finally {
    source.close();
  }
});

test("db without v2 tables skips loudly, never throws", async () => {
  seed();
  const legacy = join(directory, "legacy.db");
  const db = new DatabaseSync(legacy);
  db.exec("CREATE TABLE session(id TEXT PRIMARY KEY)");
  db.close();
  const paths = await prime();
  const summary = await run(syncOpencodeIndex(paths, [legacy], NOW));
  expect(summary.filesRead).toBe(0);
  expect(summary.filesSkipped).toEqual([{ file: legacy, reason: "missing-table" }]);
  const cold = await run(isOpencodeCold(paths.sqlite));
  expect(cold).toBe(false);
}, 15_000);

test("every sync query plan is index-backed, never a table scan", async () => {
  // Selectivity matters to the planner: one giant session reads as a scan,
  // so the fixture mirrors the live shape (thousands of small sessions).
  const roomy = join(directory, "roomy.db");
  const db = new DatabaseSync(roomy);
  db.exec(SOURCE_SCHEMA);
  const session = db.prepare("INSERT INTO session_v2 VALUES(?, ?, ?)");
  const insert = db.prepare("INSERT INTO session_message VALUES(?, ?, ?, ?, ?, ?, ?)");
  const part = db.prepare("INSERT INTO session_part VALUES(?, ?, ?, ?, ?, ?, ?, ?)");
  // One transaction: autocommit-per-row fsyncs stall for minutes under the
  // agent sandbox, while a single commit is milliseconds.
  db.exec("BEGIN");
  for (let s = 0; s < 300; s += 1) {
    session.run(`ses_${s}`, "/proj", `session ${s}`);
    for (let i = 0; i < 4; i += 1) {
      insert.run(`m${s}_${i}`, `ses_${s}`, i % 2 ? "assistant" : "user", i, NOW + i, NOW + i, "{}");
    }
    part.run(`m${s}_0`, `ses_${s}`, 0, "tool", `c${s}`, NOW, NOW, `{"name":"t${s}"}`);
  }
  db.exec("COMMIT");
  db.exec("ANALYZE");
  const plans: { query: string; params: string[] }[] = [
    { query: "SELECT time_updated FROM session_message WHERE session_id = ?", params: ["ses_7"] },
    {
      query:
        "SELECT type, seq, time_created, data FROM session_message WHERE session_id = ? AND type IN ('user', 'assistant') ORDER BY seq",
      params: ["ses_7"],
    },
    {
      query:
        "SELECT message_id AS mid, data AS data FROM session_part WHERE session_id = ? AND type = 'tool'",
      params: ["ses_7"],
    },
    {
      query: "SELECT id, seq, time_created FROM session_message WHERE id IN (?, ?)",
      params: ["m7_0", "m7_1"],
    },
    { query: "SELECT 1 FROM session_v2 WHERE id = ?", params: ["ses_7"] },
  ];
  for (const { query, params } of plans) {
    const rows = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...params) as {
      detail: string;
    }[];
    const detail = rows.map(row => row.detail).join(" | ");
    expect(detail).not.toMatch(/SCAN/);
  }
  db.close();
}, 15_000);
