import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";

import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, type FileSystem, Layer, type Path } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";

import {
  forgetSession,
  RECALL_RETENTION_MS,
  recallIndexPaths,
  syncDshIndex,
} from "../src/commands/recall-cross/index.ts";

const services = Layer.merge(NodeFileSystem.layer, NodePath.layer);

let directory: string;
let sessions: string;

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vcc-brain-recall-cross-index-"));
  sessions = join(directory, "sessions");
  mkdirSync(sessions, { recursive: true });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function frame(lines: ReadonlyArray<Record<string, unknown>>): Buffer {
  return zstdCompressSync(Buffer.from(`${lines.map(line => JSON.stringify(line)).join("\n")}\n`));
}

function header(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "session", version: 4, id, cwd: "/proj", createdAt: NOW, ...extra };
}

function userMessage(seq: number, time: number, text: string): Record<string, unknown> {
  return {
    type: "user/message",
    seq,
    time,
    data: { role: "user", content: [{ type: "text", text }] },
  };
}

function writeSession(
  slug: string,
  name: string,
  lines: ReadonlyArray<Record<string, unknown>>,
): string {
  const dir = join(sessions, slug, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "session.v4.jsonl.zstd");
  writeFileSync(file, frame(lines));
  return file;
}

function run<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(services)));
}

test("builds the index and skips unchanged files on resync", async () => {
  writeSession("proj", "11111111-2222-3333-4444-555555555555", [
    header("abc"),
    userMessage(1, NOW - DAY, "recallable decision"),
    userMessage(2, NOW - DAY, "second turn"),
  ]);
  const paths = recallIndexPaths(join(directory, "home"));
  const first = await run(syncDshIndex(paths, sessions, NOW));
  expect(first.filesRead).toBe(1);
  expect(first.turnsIndexed).toBe(2);
  expect(first.filesSkipped).toEqual([]);
  const second = await run(syncDshIndex(paths, sessions, NOW));
  expect(second.filesRead).toBe(0);
  expect(second.turnsIndexed).toBe(0);
}, 15_000);

test("creates 0700/0600 paths and repairs loose perms", async () => {
  writeSession("proj", "11111111-2222-3333-4444-555555555555", [
    header("abc"),
    userMessage(1, NOW - DAY, "hi"),
  ]);
  const home = join(directory, "home");
  const paths = recallIndexPaths(home);
  await run(syncDshIndex(paths, sessions, NOW));
  expect(statSync(paths.dir).mode & 0o777).toBe(0o700);
  expect(statSync(paths.sqlite).mode & 0o777).toBe(0o600);
  chmodSync(paths.dir, 0o755);
  chmodSync(paths.sqlite, 0o644);
  await run(syncDshIndex(paths, sessions, NOW));
  expect(statSync(paths.dir).mode & 0o777).toBe(0o700);
  expect(statSync(paths.sqlite).mode & 0o777).toBe(0o600);
}, 15_000);

test("expires turns past the 30-day backstop and keeps recent rows", async () => {
  writeSession("proj", "11111111-2222-3333-4444-555555555555", [
    header("abc"),
    userMessage(1, NOW - 31 * DAY, "ancient history"),
    userMessage(2, NOW - 29 * DAY, "recent decision"),
  ]);
  const paths = recallIndexPaths(join(directory, "home"));
  const summary = await run(syncDshIndex(paths, sessions, NOW));
  expect(summary.rowsExpired).toBe(1);
  const sqlite = await import("node:sqlite");
  const db = new sqlite.DatabaseSync(paths.sqlite);
  try {
    const rows = db.prepare("SELECT text FROM turns").all() as Array<{ text: string }>;
    expect(rows.map(row => row.text)).toEqual(["recent decision"]);
  } finally {
    db.close();
  }
  expect(RECALL_RETENTION_MS).toBe(30 * DAY);
}, 15_000);

test("forget deletes rows with a log line, unknowns stay silent, mismatches fail", async () => {
  writeSession("proj", "11111111-2222-3333-4444-555555555555", [
    header("abc"),
    userMessage(1, NOW - DAY, "forgettable turn"),
  ]);
  const home = join(directory, "home");
  const paths = recallIndexPaths(home);
  await run(syncDshIndex(paths, sessions, NOW));
  const deleted = await run(forgetSession(paths, "dsh:abc", { now: NOW }));
  expect(deleted.exitCode).toBe(0);
  expect(deleted.output).toBe("deleted 1");
  const sqlite = await import("node:sqlite");
  const db = new sqlite.DatabaseSync(paths.sqlite);
  try {
    const rows = db.prepare("SELECT * FROM turns").all() as unknown[];
    expect(rows).toEqual([]);
  } finally {
    db.close();
  }
  const { readFileSync } = await import("node:fs");
  const log = readFileSync(paths.forgetLog, "utf8");
  expect(log).toContain('"sessionId":"dsh:abc"');
  const unknown = await run(forgetSession(paths, "dsh:nope", { now: NOW }));
  expect(unknown.exitCode).toBe(0);
  expect(unknown.output).toBe("not-found");
  expect(readFileSync(paths.forgetLog, "utf8")).toBe(log);
  const mismatch = await run(forgetSession(paths, "dsh:abc", { harness: "opencode", now: NOW }));
  expect(mismatch.exitCode).toBe(2);
}, 15_000);
