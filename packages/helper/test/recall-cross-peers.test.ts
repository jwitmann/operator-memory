import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, type FileSystem, Layer, type Path } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";

import { readPeerDirs, resolveMutualPeers } from "../src/commands/recall-cross/peers.ts";

const services = Layer.merge(NodeFileSystem.layer, NodePath.layer);

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vcc-brain-recall-cross-peers-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(services)));
}

function projectDir(name: string): string {
  const dir = join(root, name);
  mkdirSync(join(dir, ".vcc-brain"), { recursive: true });
  return dir;
}

function writeConfig(dir: string, config: unknown, legacy = false): void {
  const file = legacy
    ? join(dir, ".operator", "config.json")
    : join(dir, ".vcc-brain", "config.json");
  if (legacy) {
    mkdirSync(join(dir, ".operator"), { recursive: true });
  }
  writeFileSync(file, typeof config === "string" ? config : JSON.stringify(config));
}

test("mutual declarations resolve both project names", async () => {
  const alpha = projectDir("alpha");
  const beta = projectDir("beta");
  writeConfig(alpha, { peers: [beta] });
  writeConfig(beta, { peers: [`${alpha}/`] });
  expect(await run(resolveMutualPeers(alpha, []))).toEqual(["beta"]);
  expect(await run(resolveMutualPeers(beta, []))).toEqual(["alpha"]);
});

test("one-sided declarations resolve nothing", async () => {
  const alpha = projectDir("alpha");
  const beta = projectDir("beta");
  writeConfig(alpha, { peers: [beta] });
  writeConfig(beta, { peers: [] });
  expect(await run(resolveMutualPeers(alpha, []))).toEqual([]);
});

test("missing files, bad JSON, and non-array peers fall back silently", async () => {
  const alpha = projectDir("alpha");
  const beta = projectDir("beta");
  writeConfig(alpha, { peers: [beta] });
  expect(await run(resolveMutualPeers(alpha, []))).toEqual([]);
  expect(await run(readPeerDirs(beta))).toEqual([]);

  writeConfig(beta, "{not json");
  expect(await run(resolveMutualPeers(alpha, []))).toEqual([]);

  writeConfig(beta, { peers: "beta" });
  expect(await run(resolveMutualPeers(alpha, []))).toEqual([]);
  expect(await run(readPeerDirs(beta))).toEqual([]);

  writeConfig(beta, { peers: [alpha, 42, "", null] });
  expect(await run(resolveMutualPeers(alpha, []))).toEqual(["beta"]);
});

test("self-listing, missing, and null project dirs are skipped", async () => {
  const alpha = projectDir("alpha");
  writeConfig(alpha, { peers: [alpha, join(root, "ghost")] });
  expect(await run(resolveMutualPeers(alpha, []))).toEqual([]);
  expect(await run(resolveMutualPeers(null, ["manual"]))).toEqual(["manual"]);
  expect(await run(resolveMutualPeers("  ", ["manual"]))).toEqual(["manual"]);
  expect(await run(resolveMutualPeers(join(root, "ghost"), []))).toEqual([]);
});

test("explicit peers union in as-is and dedupe", async () => {
  const alpha = projectDir("alpha");
  const beta = projectDir("beta");
  writeConfig(alpha, { peers: [beta] });
  writeConfig(beta, { peers: [alpha] });
  expect(await run(resolveMutualPeers(alpha, ["manual", "beta"]))).toEqual(["manual", "beta"]);
});

test("relative peer paths resolve against the declaring project", async () => {
  const alpha = projectDir("alpha");
  const beta = projectDir("beta");
  writeConfig(alpha, { peers: ["../beta"] });
  writeConfig(beta, { peers: ["../alpha"] });
  expect(await run(resolveMutualPeers(alpha, []))).toEqual(["beta"]);
});

test("legacy config location is checked when primary is absent", async () => {
  const alpha = projectDir("alpha");
  const beta = projectDir("beta");
  writeConfig(alpha, { peers: [beta] }, true);
  writeConfig(beta, { peers: [alpha] });
  expect(await run(resolveMutualPeers(alpha, []))).toEqual(["beta"]);
});
