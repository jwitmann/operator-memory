import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";

import { RECALL_CROSS_EXCERPT_HEADER } from "@jwitmann/vcc-brain-core/recall-cross/ranking";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, type FileSystem, Layer, type Path } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";

import {
  decodeZstdFrames,
  DshSessionError,
  ingestDshFile,
  ingestDshSessions,
} from "../src/commands/recall-cross/dsh.ts";

const services = Layer.merge(NodeFileSystem.layer, NodePath.layer);

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vcc-brain-recall-cross-dsh-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function run<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(services)));
}

function frame(lines: ReadonlyArray<Record<string, unknown>>): Buffer {
  return zstdCompressSync(Buffer.from(`${lines.map(line => JSON.stringify(line)).join("\n")}\n`));
}

function sessionFile(lines: ReadonlyArray<Record<string, unknown>>): Buffer {
  return frame(lines);
}

function header(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "session", version: 4, id, cwd: "/proj", createdAt: 1700000000000, ...extra };
}

test("decodes multi-frame zstd and flags a bad tail frame as corrupt", () => {
  const good = frame([
    { type: "user/message", seq: 1, time: 10, data: { role: "user", content: [] } },
  ]);
  const combined = Buffer.concat([good, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01, 0x02])]);
  const result = decodeZstdFrames(combined);
  expect(result.frames).toBe(2);
  expect(result.decoded).toBe(1);
  expect(result.corrupt).toBe(true);
  expect(result.text).toContain('"user/message"');
  expect(decodeZstdFrames(Buffer.from("not zstd at all"))).toEqual({
    text: "",
    frames: 0,
    decoded: 0,
    corrupt: false,
  });
});

test("ingests both user envelopes, assistant text, and skips control records", async () => {
  const file = join(directory, "session.v4.jsonl.zstd");
  writeFileSync(
    file,
    sessionFile([
      header("abc"),
      { type: "turn/start", seq: 0, time: 1, data: {} },
      { type: "compaction/mark", seq: 1, time: 2, data: {} },
      {
        type: "user/message",
        seq: 2,
        time: 100,
        data: { role: "user", content: [{ type: "text", text: "shape A decision" }] },
      },
      {
        type: "user/message",
        seq: 3,
        time: 101,
        data: {
          content: [{ type: "text", text: "shape B followup" }],
          source: { kind: "user" },
          id: "x1",
        },
      },
      {
        type: "assistant/message",
        seq: 4,
        time: 102,
        data: {
          message: {
            role: "assistant",
            content: [
              { type: "reasoning", text: "hidden thought" },
              { type: "text", text: "visible answer" },
              { type: "tool-call", name: "read", arguments: "{}" },
            ],
          },
        },
      },
      { type: "mystery/future", seq: 5, time: 103, data: {} },
    ]),
  );
  const result = await run(ingestDshFile(file, "someslug"));
  expect(result.corruptLines).toBe(0);
  expect(result.partial).toBe(false);
  expect(result.records.map(record => record.text)).toEqual([
    "shape A decision",
    "shape B followup",
    "visible answer",
  ]);
  expect(result.records.map(record => record.kind)).toEqual(["user", "user", "assistant"]);
  expect(result.records[0]).toMatchObject({
    harness: "dsh",
    sessionId: "dsh:abc",
    project: "proj",
    timestamp: 100,
    seq: 2,
    pointer: `${file}#seq=2`,
  });
});

test("excludes recall tool traffic and header-carrying turns, keeps other tool results", async () => {
  const file = join(directory, "session.v4.jsonl.zstd");
  writeFileSync(
    file,
    sessionFile([
      header("tooly"),
      {
        type: "tool/call",
        seq: 1,
        time: 10,
        data: { callId: "c1", name: "vcc-brain-search-sessions", arguments: "{}" },
      },
      {
        type: "tool/result",
        seq: 2,
        time: 11,
        data: {
          message: {
            role: "tool",
            toolCallId: "c1",
            source: { kind: "tool", callId: "c1" },
            content: [{ type: "text", text: "recall output" }],
          },
        },
      },
      {
        type: "tool/call",
        seq: 3,
        time: 12,
        data: { callId: "c2", name: "read", arguments: "{}" },
      },
      {
        type: "tool/result",
        seq: 4,
        time: 13,
        data: {
          message: {
            role: "tool",
            toolCallId: "c2",
            source: { kind: "tool", callId: "c2" },
            content: [{ type: "text", text: "file bytes" }],
          },
        },
      },
      {
        type: "tool/result",
        seq: 5,
        time: 14,
        data: {
          message: {
            role: "tool",
            source: { kind: "tool", callId: "orphan-recall" },
            content: [{ type: "text", text: `orphan ${RECALL_CROSS_EXCERPT_HEADER} output` }],
          },
        },
      },
      {
        type: "tool/call",
        seq: 6,
        time: 15,
        data: { callId: "c3", name: "vcc-brain-recall-session", arguments: "{}" },
      },
      {
        type: "tool/result",
        seq: 7,
        time: 16,
        data: {
          message: {
            role: "tool",
            source: { kind: "tool", callId: "c3" },
            content: [{ type: "text", text: "fallback-linked recall output" }],
          },
        },
      },
      {
        type: "tool/call",
        seq: 8,
        time: 17,
        data: { callId: "c4", name: "vcc-brain-search-sessions", arguments: "{}" },
      },
      {
        type: "tool/result",
        seq: 9,
        time: 18,
        data: {
          toolCallId: "c4",
          message: { content: [{ type: "text", text: "top-level recall output" }] },
        },
      },
      {
        type: "user/message",
        seq: 10,
        time: 19,
        data: {
          role: "user",
          content: [{ type: "text", text: `pasted ${RECALL_CROSS_EXCERPT_HEADER} output` }],
        },
      },
    ]),
  );
  const result = await run(ingestDshFile(file, "someslug"));
  expect(result.records.map(record => record.text)).toEqual(["file bytes"]);
  expect(result.records.map(record => record.kind)).toEqual(["tool"]);
  // c1 result (call-linked), orphan header-carrying result (header backstop),
  // c3 result (source.callId fallback linkage, no header), c4 result
  // (top-level body fallback), pasted header turn: all five excluded.
  expect(result.turnsSkipped).toBe(5);
});

test("applies latest-wins titles and the opt-out tag", async () => {
  const kept = join(directory, "kept.v4.jsonl.zstd");
  writeFileSync(
    kept,
    sessionFile([
      header("kept"),
      { type: "session/title", seq: 1, time: 1, data: { title: "first" } },
      { type: "title", seq: 2, time: 2, data: { title: "second" } },
      {
        type: "user/message",
        seq: 3,
        time: 3,
        data: { role: "user", content: [{ type: "text", text: "hello" }] },
      },
    ]),
  );
  const keptResult = await run(ingestDshFile(kept, "someslug"));
  expect(keptResult.records).toHaveLength(1);

  const dropped = join(directory, "dropped.v4.jsonl.zstd");
  writeFileSync(
    dropped,
    sessionFile([
      header("dropped"),
      { type: "session/title", seq: 1, time: 1, data: { title: "  [no-recall]  " } },
      {
        type: "user/message",
        seq: 2,
        time: 2,
        data: { role: "user", content: [{ type: "text", text: "secret" }] },
      },
    ]),
  );
  const droppedResult = await run(ingestDshFile(dropped, "someslug"));
  expect(droppedResult.records).toEqual([]);
  expect(droppedResult.turnsSkipped).toBe(1);

  const untitled = join(directory, "untitled.v4.jsonl.zstd");
  writeFileSync(
    untitled,
    sessionFile([
      header("untitled"),
      {
        type: "user/message",
        seq: 1,
        time: 1,
        data: { role: "user", content: [{ type: "text", text: "no title, still indexed" }] },
      },
    ]),
  );
  expect((await run(ingestDshFile(untitled, "someslug"))).records).toHaveLength(1);
});

test("skips corrupt lines with a count and fails files without a usable header", async () => {
  const file = join(directory, "ragged.v4.jsonl.zstd");
  // Corrupt lines ride inside the compressed frame: a truncated object and a
  // valid-JSON non-record. Trailing bytes outside any zstd frame are
  // invisible by construction (no magic, no frame).
  const lines = [
    JSON.stringify(header("ragged")),
    JSON.stringify({
      type: "user/message",
      seq: 1,
      time: 1,
      data: { role: "user", content: [{ type: "text", text: "survivor" }] },
    }),
    "uh-oh",
    '{"truncated": ',
    "[]",
  ];
  writeFileSync(file, zstdCompressSync(Buffer.from(`${lines.join("\n")}\n`)));
  const result = await run(ingestDshFile(file, "someslug"));
  expect(result.corruptLines).toBe(3);
  expect(result.records.map(record => record.text)).toEqual(["survivor"]);

  const noHeader = join(directory, "noheader.v4.jsonl.zstd");
  writeFileSync(noHeader, sessionFile([{ type: "user/message", seq: 1, time: 1, data: {} }]));
  const headerFailure = await run(Effect.result(ingestDshFile(noHeader, "someslug")));
  expect(headerFailure._tag).toBe("Failure");
  if (headerFailure._tag === "Failure" && headerFailure.failure instanceof DshSessionError) {
    expect(headerFailure.failure.reason).toBe("no-header");
  }

  const wrongVersion = join(directory, "v5.v4.jsonl.zstd");
  writeFileSync(wrongVersion, sessionFile([{ type: "session", version: 5, id: "v5" }]));
  const versionFailure = await run(Effect.result(ingestDshFile(wrongVersion, "someslug")));
  expect(versionFailure._tag).toBe("Failure");
  if (versionFailure._tag === "Failure" && versionFailure.failure instanceof DshSessionError) {
    expect(versionFailure.failure.reason).toBe("unsupported-version");
  }

  const notZstd = join(directory, "plain.v4.jsonl.zstd");
  writeFileSync(notZstd, "plain text, no frames");
  const zstdFailure = await run(Effect.result(ingestDshFile(notZstd, "someslug")));
  expect(zstdFailure._tag).toBe("Failure");
  if (zstdFailure._tag === "Failure" && zstdFailure.failure instanceof DshSessionError) {
    expect(zstdFailure.failure.reason).toBe("no-zstd-frames");
  }

  const tampered = Buffer.from(sessionFile([header("tampered")]));
  tampered.fill(0, 20, 40);
  const undecodableFile = join(directory, "tampered.v4.jsonl.zstd");
  writeFileSync(undecodableFile, tampered);
  const undecodableFailure = await run(Effect.result(ingestDshFile(undecodableFile, "someslug")));
  expect(undecodableFailure._tag).toBe("Failure");
  if (
    undecodableFailure._tag === "Failure"
    && undecodableFailure.failure instanceof DshSessionError
  ) {
    expect(undecodableFailure.failure.reason).toBe("undecodable");
  }
});

test("walks both directory layouts and falls back to the slug for project", async () => {
  const bare = join(directory, "rootslug", "11111111-2222-3333-4444-555555555555");
  mkdirSync(bare, { recursive: true });
  writeFileSync(
    join(bare, "session.v4.jsonl.zstd"),
    sessionFile([
      header("uuid-one", { cwd: "/real/project" }),
      {
        type: "user/message",
        seq: 1,
        time: 1,
        data: { role: "user", content: [{ type: "text", text: "bare layout" }] },
      },
    ]),
  );
  const nested = join(directory, "otherslug", "session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(nested, "session.v4.jsonl.zstd"),
    sessionFile([
      { type: "session", version: 4, id: "uuid-two" },
      {
        type: "user/message",
        seq: 7,
        time: 9,
        data: { role: "user", content: [{ type: "text", text: "nested layout" }] },
      },
    ]),
  );
  const summary = await run(ingestDshSessions(directory));
  expect(summary.filesRead).toBe(2);
  expect(summary.filesSkipped).toEqual([]);
  expect(summary.records.map(record => record.text).sort()).toEqual([
    "bare layout",
    "nested layout",
  ]);
  expect(summary.records.map(record => record.project).sort()).toEqual(["otherslug", "project"]);
});

test("a corrupt frame excludes the whole file as undecodable", async () => {
  const good = frame([
    header("half-good"),
    {
      type: "user/message",
      seq: 1,
      time: 1,
      data: { role: "user", content: [{ type: "text", text: "good half" }] },
    },
  ]);
  const badTail = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01, 0x02]);
  const file = join(directory, "gapped.v4.jsonl.zstd");
  writeFileSync(file, Buffer.concat([good, badTail]));
  const failure = await run(Effect.result(ingestDshFile(file, "someslug")));
  expect(failure._tag).toBe("Failure");
  if (failure._tag === "Failure" && failure.failure instanceof DshSessionError) {
    expect(failure.failure.reason).toBe("undecodable");
  }
});

test("project identity is the cwd basename, never the raw path", async () => {
  const file = join(directory, "session.v4.jsonl.zstd");
  writeFileSync(
    file,
    sessionFile([
      header("based", { cwd: "/home/jerome/checkouts/operator-memory" }),
      {
        type: "user/message",
        seq: 1,
        time: 1,
        data: { role: "user", content: [{ type: "text", text: "based" }] },
      },
    ]),
  );
  const result = await run(ingestDshFile(file, "fallback-slug"));
  expect(result.records[0]?.project).toBe("operator-memory");
});
