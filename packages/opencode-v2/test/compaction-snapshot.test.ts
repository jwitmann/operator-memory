import { vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";

import { sessionEvents } from "@jwitmann/operator-core/context/session-compat";

import {
  buildSnapshot,
  classifySnapshotStore,
  cleanMessage,
  cleanPart,
  formatRecallReply,
  formatSearchReply,
  makeSnapshotSession,
  MAX_SNAPSHOT_WRITE_BYTES,
  readCompactionSnapshot,
  recallFromSnapshot,
  rememberSnapshot,
  resolveRecallSelections,
  searchSnapshot,
  snapshotMessageToRecall,
  snapshotNeedsWrite,
  snapshotWriteBytes,
  toSnapshotEvents,
  writeCompactionSnapshot,
} from "../src/compaction-snapshot.ts";
import { toCompactionNodes } from "../src/compaction-compiler.ts";

vi.mock("node:fs/promises", async () => {
  const { fs: memoryFileSystem } = await import("memfs");
  return {
    access: memoryFileSystem.promises.access,
    appendFile: memoryFileSystem.promises.appendFile,
    mkdir: memoryFileSystem.promises.mkdir,
    readFile: memoryFileSystem.promises.readFile,
    readdir: memoryFileSystem.promises.readdir,
    rename: memoryFileSystem.promises.rename,
    stat: memoryFileSystem.promises.stat,
    unlink: memoryFileSystem.promises.unlink,
    writeFile: memoryFileSystem.promises.writeFile,
  };
});

const SESSION = "ses_test";
const STATE = "/home/.operator/state";
const ROOT = `${STATE}/context-snapshot`;

const SNAP_MSGS = [
  { id: "m1", role: "system", content: [{ type: "text", text: "rules" }] },
  { id: "m2", role: "user", content: [{ type: "text", text: "please fix login" }] },
  {
    id: "m3",
    role: "assistant",
    content: [{ type: "tool-call", id: "t1", name: "read", input: { file_path: "auth.js" } }],
  },
  {
    id: "m4",
    role: "tool",
    content: [
      {
        type: "tool-result",
        id: "t1",
        name: "read",
        result: { type: "json", value: { lines: 42 } },
      },
    ],
  },
  { id: "m5", role: "user", content: [{ type: "media", media: { mediaType: "image/png" } }] },
  { id: "m6", role: "assistant", content: [{ type: "compaction", text: "prior summary" }] },
];

beforeEach(() => {
  vol.reset();
});

test("snapshot drops system and keeps seq alignment", () => {
  const snap = buildSnapshot(SNAP_MSGS);
  expect(snap.version).toBe(1);
  expect(snap.messages.some(message => message.role === "system")).toBe(false);
  expect(snap.count).toBe(5);
  expect(snap.lastID).toBe("m6");
  expect(snap.messages[3]).toEqual({
    id: "m5",
    role: "user",
    content: [{ type: "media", mediaType: "image/png" }],
  });
});

test("snapshot growth guard", () => {
  const snap = buildSnapshot(SNAP_MSGS);
  expect(
    snapshotNeedsWrite({ version: snap.version, count: snap.count, lastID: snap.lastID }, snap),
  ).toBe(false);
  expect(snapshotNeedsWrite({ version: snap.version, count: 4, lastID: "m5" }, snap)).toBe(true);
  expect(snapshotNeedsWrite(null, snap)).toBe(true);
  expect(snapshotNeedsWrite({ version: 0, count: snap.count, lastID: snap.lastID }, snap)).toBe(
    true,
  );
});

test("snapshot write budget", () => {
  const snap = buildSnapshot(SNAP_MSGS);
  expect(MAX_SNAPSHOT_WRITE_BYTES).toBe(1000000);
  expect(snapshotWriteBytes(snap) > MAX_SNAPSHOT_WRITE_BYTES).toBe(false);
  expect(
    snapshotWriteBytes({
      version: 1,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "x".repeat(MAX_SNAPSHOT_WRITE_BYTES + 1) }],
        },
      ],
      count: 1,
    }) > MAX_SNAPSHOT_WRITE_BYTES,
  ).toBe(true);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  expect(snapshotWriteBytes(circular)).toBe(0);
});

test("snapshot events are 1-based contiguous with result/checkpoint types", () => {
  const snap = buildSnapshot(SNAP_MSGS);
  const session = makeSnapshotSession(snap.messages);
  const events = sessionEvents(session);
  expect(events).toHaveLength(5);
  expect(events.map(event => event.seq)).toEqual([1, 2, 3, 4, 5]);
  expect(events[2]?.type).toBe("tool/result");
  expect(events[4]?.type).toBe("user/message");
  expect(session.eventAt(2)?.seq).toBe(2);
});

test("snapshot recall restores tool call and result", () => {
  const snap = buildSnapshot(SNAP_MSGS);
  const session = makeSnapshotSession(snap.messages);
  const recalled = recallFromSnapshot(
    snap.messages,
    resolveRecallSelections(snap.messages, "seq", "2-3").selections,
  );
  expect(recalled.text.includes("[tool-call read]") && recalled.text.includes("42")).toBe(true);
  expect(resolveRecallSelections(snap.messages, "result", "3").selections).toEqual([
    { start: 3, end: 3 },
  ]);
  expect(sessionEvents(session)).toHaveLength(5);
});

test("snapshot search finds content with recall pointers", () => {
  const snap = buildSnapshot(SNAP_MSGS);
  const searched = searchSnapshot(snap.messages, "login", {
    maxSearchHits: 50,
    maxRecallTokens: 16000,
  });
  expect(searched.totalMatches >= 1 && searched.text.includes("[seq 1")).toBe(true);
  expect(searchSnapshot(snap.messages, "login").totalMatches >= 1).toBe(true);
  expect(
    searchSnapshot(snap.messages, "e", { maxSearchHits: 50, maxRecallTokens: 16000 }).hits.every(
      hit => hit.seq !== 0,
    ),
  ).toBe(true);
});

test("snapshot keeps empty shells and drops typeless parts", () => {
  expect(buildSnapshot([{ role: "user", content: [] }]).count).toBe(1);
  expect(buildSnapshot([{ role: "tool", content: [] }]).count).toBe(1);
  expect(buildSnapshot([{ id: "x", role: "user", content: [{ foo: 1 }] }]).messages).toEqual([
    { id: "x", role: "user", content: [] },
  ]);
  expect(
    snapshotMessageToRecall({
      role: "user",
      content: [null, { type: "text", text: "hi" }, { noType: true }],
    }).content,
  ).toEqual([{ type: "text", text: "hi" }]);
  expect(
    snapshotMessageToRecall(buildSnapshot(SNAP_MSGS).messages[0] ?? { role: "user", content: [] })
      .role,
  ).toBe("user");
});

test("snapshot recall tolerates missing input and default budgets", () => {
  const recalled = recallFromSnapshot(
    [{ role: "assistant", content: [{ type: "tool-call", id: "c", name: "bash" }] }],
    [{ start: 1, end: 1 }],
  );
  expect(recalled.text.includes("null")).toBe(false);
  expect(
    recallFromSnapshot(buildSnapshot(SNAP_MSGS).messages, [{ start: 1, end: 1 }], undefined)
      .recalled,
  ).toBe(1);
});

test("rememberSnapshot writes once, then skips until growth", async () => {
  const first = await rememberSnapshot(ROOT, SESSION, SNAP_MSGS, "2026-11-20T00:00:00Z", null);
  expect(first.wrote).toBe(true);
  expect(first.seen).toEqual({ version: 1, count: 5, lastID: "m6" });

  const same = await rememberSnapshot(ROOT, SESSION, SNAP_MSGS, "2026-11-20T00:00:01Z", first.seen);
  expect(same.wrote).toBe(false);
  expect(same.seen).toBe(first.seen);

  const grown = await rememberSnapshot(
    ROOT,
    SESSION,
    [...SNAP_MSGS, { id: "m7", role: "user", content: [{ type: "text", text: "more" }] }],
    "2026-11-20T00:00:02Z",
    same.seen,
  );
  expect(grown.wrote).toBe(true);
  expect(grown.seen?.count).toBe(6);
});

test("rememberSnapshot is best-effort on unsafe segments", async () => {
  expect(await rememberSnapshot(ROOT, "../evil", SNAP_MSGS, "t", null)).toEqual({
    wrote: false,
    seen: null,
  });
});

test("snapshot replies label provenance", () => {
  expect(
    formatRecallReply("seq", "1", {
      seqs: [1],
      tokens: 10,
      missing: 0,
      truncated: false,
      text: "hi",
    } as never),
  ).toBe("**operator-recall seq 1** (1 event(s), 10 tokens)\n\nhi");
  expect(formatSearchReply("login", { totalMatches: 1, text: "hit" } as never)).toBe(
    "**operator-search login** (1 matching event(s))\n\nhit",
  );
});

test("snapshot store classifies read-failure, empty, and ready", async () => {
  expect(classifySnapshotStore({ ok: false, error: { path: "p", cause: null } } as never)).toEqual({
    status: "failed",
  });
  expect(classifySnapshotStore({ ok: true, value: null } as never)).toEqual({ status: "empty" });
  const snap = buildSnapshot(SNAP_MSGS);
  expect(classifySnapshotStore({ ok: true, value: { ...snap, writtenAt: "t" } } as never)).toEqual({
    status: "ready",
    messages: snap.messages,
  });
});

test("snapshot round-trips through the state directory", async () => {
  const missing = await readCompactionSnapshot(ROOT, SESSION);
  expect(missing.ok && missing.value).toBeNull();

  const written = await writeCompactionSnapshot(ROOT, SESSION, SNAP_MSGS, "2026-11-20T00:00:00Z");
  expect(written.ok).toBe(true);

  const read = await readCompactionSnapshot(ROOT, SESSION);
  expect(read.ok && read.value?.count).toBe(5);
  expect(read.ok && read.value?.lastID).toBe("m6");
  expect(read.ok && read.value?.writtenAt).toBe("2026-11-20T00:00:00Z");

  const recalled = recallFromSnapshot(read.ok && read.value !== null ? read.value.messages : [], [
    { start: 1, end: 1 },
  ]);
  expect(recalled.text).toContain("please fix login");
});

test("snapshot rejects unsafe session segments", async () => {
  const written = await writeCompactionSnapshot(ROOT, "../evil", SNAP_MSGS, "t");
  expect(written.ok).toBe(false);
  const read = await readCompactionSnapshot(ROOT, "../evil");
  expect(read.ok).toBe(false);
});

test("checkpoint and snapshot seqs agree when the request has skippable messages", () => {
  const nodes = toCompactionNodes(SNAP_MSGS);
  const snap = buildSnapshot(SNAP_MSGS);
  const events = toSnapshotEvents(snap.messages);
  expect(nodes.map(node => node.seq)).toEqual(events.map(event => event.seq));
  expect(nodes).toHaveLength(5);
  const recalled = recallFromSnapshot(snap.messages, [{ start: 1, end: 1 }]);
  expect(recalled.text).toContain("please fix login");
  const searched = searchSnapshot(snap.messages, "login");
  expect(searched.hits.some(hit => hit.seq === 1)).toBe(true);
});

test("corrupt snapshot file reads as failure, not empty", async () => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(ROOT, { recursive: true });
  await writeFile(`${ROOT}/${SESSION}.json`, "{ torn", "utf8");
  const read = await readCompactionSnapshot(ROOT, SESSION);
  expect(read.ok).toBe(false);
  expect(classifySnapshotStore(read as never)).toEqual({ status: "failed" });
});

test("unknown roles are dropped on both seq paths", () => {
  const msgs = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
    { role: "weird", content: [{ type: "text", text: "???" }] },
  ];
  expect(toCompactionNodes(msgs)).toHaveLength(1);
  expect(buildSnapshot(msgs).count).toBe(1);
});

test("cleaners drop control and transport shapes", () => {
  expect(cleanPart({ type: "effort", text: "x" })).toBeNull();
  expect(cleanPart({ type: "compaction", text: "" })).toBeNull();
  expect(cleanPart(null)).toBeNull();
  expect(cleanPart({ noType: true })).toBeNull();
  expect(cleanMessage({ role: "system", content: [] })).toBeNull();
  expect(cleanMessage({ role: "user" })).toBeNull();
  const events = toSnapshotEvents(buildSnapshot(SNAP_MSGS).messages);
  expect(events.map(event => event.seq)).toEqual([1, 2, 3, 4, 5]);
});
