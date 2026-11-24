import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";

import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { RECALL_CROSS_EXCERPT_HEADER } from "@jwitmann/vcc-brain-core/recall-cross/ranking";
import { Effect, type FileSystem, Layer, type Path } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";

import { recallIndexPaths, syncDshIndex } from "../src/commands/recall-cross/index.ts";
import {
  queryRecall,
  recallCrossQuery,
  recallSessionTurns,
} from "../src/commands/recall-cross/query.ts";

const services = Layer.merge(NodeFileSystem.layer, NodePath.layer);

let directory: string;
let sessions: string;

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vcc-brain-recall-cross-query-"));
  sessions = join(directory, "sessions");
  mkdirSync(sessions, { recursive: true });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function frame(lines: ReadonlyArray<Record<string, unknown>>): Buffer {
  return zstdCompressSync(Buffer.from(`${lines.map(line => JSON.stringify(line)).join("\n")}\n`));
}

function header(id: string, cwd = "/proj"): Record<string, unknown> {
  return { type: "session", version: 4, id, cwd, createdAt: NOW };
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
): void {
  const dir = join(sessions, slug, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.v4.jsonl.zstd"), frame(lines));
}

function run<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(services)));
}

test("MATCH hits return ranked excerpts with the header", async () => {
  writeSession("s", "11111111-2222-3333-4444-555555555555", [
    header("abc", "/proj"),
    userMessage(1, NOW - DAY, "the deploy decision was blue-green"),
  ]);
  const paths = recallIndexPaths(join(directory, "home"));
  await run(syncDshIndex(paths, sessions, NOW));
  const result = await run(
    queryRecall(
      paths,
      sessions,
      {
        keywords: ["deploy", "blue-green"],
        project: "proj",
        peers: [],
        now: NOW,
      },
      join(directory, "home"),
    ),
  );
  expect(result.exitCode).toBe(0);
  expect(result.hits).toHaveLength(1);
  expect(result.output).toContain(RECALL_CROSS_EXCERPT_HEADER);
  expect(result.output).toContain("dsh:abc");
}, 15_000);

test("punctuation queries fall back to instr and still hit", async () => {
  writeSession("s", "11111111-2222-3333-4444-555555555555", [
    header("abc", "/proj"),
    userMessage(1, NOW - DAY, "config value (debug=true) shipped"),
  ]);
  const paths = recallIndexPaths(join(directory, "home"));
  await run(syncDshIndex(paths, sessions, NOW));
  const result = await run(
    queryRecall(
      paths,
      sessions,
      {
        keywords: ["(debug=true)"],
        project: "proj",
        peers: [],
        now: NOW,
      },
      join(directory, "home"),
    ),
  );
  expect(result.exitCode).toBe(0);
  expect(result.hits).toHaveLength(1);
}, 15_000);

test("out-of-scope projects report cleanly", async () => {
  writeSession("s", "11111111-2222-3333-4444-555555555555", [
    header("abc", "/proj"),
    userMessage(1, NOW - DAY, "lonely decision here"),
  ]);
  const paths = recallIndexPaths(join(directory, "home"));
  await run(syncDshIndex(paths, sessions, NOW));
  const result = await run(
    queryRecall(
      paths,
      sessions,
      {
        keywords: ["lonely"],
        project: "elsewhere",
        peers: [],
        now: NOW,
      },
      join(directory, "home"),
    ),
  );
  expect(result.exitCode).toBe(0);
  expect(result.output).toBe("No matching turns in scope.");
}, 15_000);

test("missing index is a clean error, not a stack trace", async () => {
  const paths = recallIndexPaths(join(directory, "home"));
  const result = await run(
    queryRecall(
      paths,
      sessions,
      {
        keywords: ["anything"],
        project: "proj",
        peers: [],
        now: NOW,
      },
      join(directory, "home"),
    ),
  );
  expect(result.exitCode).toBe(2);
  expect(result.output).toContain("recall-cross index");
});

test("mutual peers widen scope across projects via projectDir", async () => {
  const alphaDir = join(directory, "alpha");
  const betaDir = join(directory, "beta");
  for (const dir of [alphaDir, betaDir]) {
    mkdirSync(join(dir, ".vcc-brain"), { recursive: true });
  }
  const link = (from: string, to: string): void => {
    writeFileSync(join(from, ".vcc-brain", "config.json"), JSON.stringify({ peers: [to] }));
  };
  link(alphaDir, betaDir);
  link(betaDir, alphaDir);
  writeSession("s", "aaaaaaaa-1111-2222-3333-444444444444", [
    header("aaa", alphaDir),
    userMessage(1, NOW - DAY, "quasarfalcon migration plan"),
  ]);
  writeSession("s", "bbbbbbbb-1111-2222-3333-444444444444", [
    header("bbb", betaDir),
    userMessage(1, NOW - DAY, "quasarfalcon rollback plan"),
  ]);
  const paths = recallIndexPaths(join(directory, "home"));
  await run(syncDshIndex(paths, sessions, NOW));
  const context = {
    cwd: alphaDir,
    home: join(directory, "home"),
    xdgConfigHome: null,
    version: "test",
  };
  const mutual = await run(
    recallCrossQuery(context, ["quasarfalcon"], {
      project: "alpha",
      projectDir: alphaDir,
      root: sessions,
      now: NOW,
    }),
  );
  expect(mutual.exitCode).toBe(0);
  expect(mutual.output).toContain("dsh:aaa");
  expect(mutual.output).toContain("dsh:bbb");

  writeFileSync(join(betaDir, ".vcc-brain", "config.json"), JSON.stringify({ peers: [] }));
  const oneSided = await run(
    recallCrossQuery(context, ["quasarfalcon"], {
      project: "alpha",
      projectDir: alphaDir,
      root: sessions,
      now: NOW,
    }),
  );
  expect(oneSided.exitCode).toBe(0);
  expect(oneSided.output).toContain("dsh:aaa");
  expect(oneSided.output).not.toContain("dsh:bbb");
}, 15_000);

test("recall restores a session's turns and filters by seq", async () => {
  writeSession("s", "11111111-2222-3333-4444-555555555555", [
    header("abc", "/proj"),
    userMessage(1, NOW - DAY, "first decision"),
    userMessage(2, NOW - DAY, "second decision"),
  ]);
  const paths = recallIndexPaths(join(directory, "home"));
  await run(syncDshIndex(paths, sessions, NOW));
  const full = await run(
    recallSessionTurns(paths, sessions, "dsh:abc", null, NOW, join(directory, "home")),
  );
  expect(full.exitCode).toBe(0);
  expect(full.output).toContain("first decision");
  expect(full.output).toContain("second decision");
  const single = await run(
    recallSessionTurns(paths, sessions, "dsh:abc", 2, NOW, join(directory, "home")),
  );
  expect(single.exitCode).toBe(0);
  expect(single.output).not.toContain("first decision");
  expect(single.output).toContain("second decision");
  const missing = await run(
    recallSessionTurns(paths, sessions, "dsh:nope", null, NOW, join(directory, "home")),
  );
  expect(missing.exitCode).toBe(0);
  expect(missing.output).toBe("not-found");
}, 15_000);
