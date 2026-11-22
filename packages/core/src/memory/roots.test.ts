import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  DEFAULT_BRAIN_PATHS,
  pickPrimary,
  projectConfigPaths,
  resolveBrainRoots,
  resolveInstructionsPath,
  resolveStateDirectory,
} from "./roots.ts";

vi.mock("node:fs/promises", async () => {
  const { fs: memoryFileSystem } = await import("memfs");
  return {
    stat: memoryFileSystem.promises.stat,
  };
});

const PROJECT = "/project";
const HOME = "/home";

beforeEach(() => {
  vol.reset();
  fs.mkdirSync(PROJECT, { recursive: true });
  fs.mkdirSync(HOME, { recursive: true });
});

test("pickPrimary prefers primary, falls back to legacy, defaults to primary", () => {
  expect(pickPrimary(true, true)).toBe(true);
  expect(pickPrimary(true, false)).toBe(true);
  expect(pickPrimary(false, true)).toBe(false);
  expect(pickPrimary(false, false)).toBe(true);
});

test("resolves primary roots when nothing exists", async () => {
  const roots = await resolveBrainRoots(PROJECT, HOME);
  expect(roots.privateRoot).toBe(join(PROJECT, ".vcc-brain"));
  expect(roots.sharedRoot).toBe(join(PROJECT, ".vcc-brain-shared"));
  expect(roots.userRoot).toBe(join(HOME, ".vcc-brain", "user"));
  expect(roots.privateDisplay).toBe(".vcc-brain");
  expect(roots.sharedDisplay).toBe(".vcc-brain-shared");
  expect(roots.userDisplay).toBe("~/.vcc-brain/user");
  expect(roots.privateLegacyAlsoExists).toBe(false);
  expect(roots.sharedLegacyAlsoExists).toBe(false);
  expect(roots.userLegacyAlsoExists).toBe(false);
});

test("falls back to legacy roots when only legacy exists", async () => {
  fs.mkdirSync(join(PROJECT, ".operator"), { recursive: true });
  fs.mkdirSync(join(PROJECT, ".operator-shared"), { recursive: true });
  fs.mkdirSync(join(HOME, ".operator", "user"), { recursive: true });

  const roots = await resolveBrainRoots(PROJECT, HOME);
  expect(roots.privateRoot).toBe(join(PROJECT, ".operator"));
  expect(roots.sharedRoot).toBe(join(PROJECT, ".operator-shared"));
  expect(roots.userRoot).toBe(join(HOME, ".operator", "user"));
  expect(roots.privateDisplay).toBe(".operator");
  expect(roots.sharedDisplay).toBe(".operator-shared");
  expect(roots.userDisplay).toBe("~/.operator/user");
  expect(roots.privateLegacyAlsoExists).toBe(false);
  expect(roots.sharedLegacyAlsoExists).toBe(false);
  expect(roots.userLegacyAlsoExists).toBe(false);
});

test("prefers primary and flags shadowed legacy when both exist", async () => {
  fs.mkdirSync(join(PROJECT, ".vcc-brain"), { recursive: true });
  fs.mkdirSync(join(PROJECT, ".operator"), { recursive: true });
  fs.mkdirSync(join(PROJECT, ".vcc-brain-shared"), { recursive: true });
  fs.mkdirSync(join(PROJECT, ".operator-shared"), { recursive: true });
  fs.mkdirSync(join(HOME, ".vcc-brain", "user"), { recursive: true });
  fs.mkdirSync(join(HOME, ".operator", "user"), { recursive: true });

  const roots = await resolveBrainRoots(PROJECT, HOME);
  expect(roots.privateRoot).toBe(join(PROJECT, ".vcc-brain"));
  expect(roots.sharedRoot).toBe(join(PROJECT, ".vcc-brain-shared"));
  expect(roots.userRoot).toBe(join(HOME, ".vcc-brain", "user"));
  expect(roots.privateLegacyAlsoExists).toBe(true);
  expect(roots.sharedLegacyAlsoExists).toBe(true);
  expect(roots.userLegacyAlsoExists).toBe(true);
});

test("lists project config candidates primary first", () => {
  expect(projectConfigPaths(PROJECT)).toEqual([
    join(PROJECT, ".vcc-brain", "config.json"),
    join(PROJECT, ".operator", "config.json"),
  ]);
});

test("exposes the primary brain paths as the default", () => {
  expect([...DEFAULT_BRAIN_PATHS]).toEqual([
    "~/.vcc-brain/user",
    ".vcc-brain",
    ".vcc-brain-shared",
  ]);
});

const stateDirs: string[] = [];
afterEach(() => {
  for (const dir of stateDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "vcc-brain-roots-"));
  stateDirs.push(dir);
  return dir;
}

test("resolveStateDirectory prefers primary and falls back to legacy", () => {
  const home = makeHome();
  expect(resolveStateDirectory(home)).toBe(join(home, ".vcc-brain", "state"));

  mkdirSync(join(home, ".operator", "state"), { recursive: true });
  expect(resolveStateDirectory(home)).toBe(join(home, ".operator", "state"));

  mkdirSync(join(home, ".vcc-brain", "state"), { recursive: true });
  expect(resolveStateDirectory(home)).toBe(join(home, ".vcc-brain", "state"));
});

test("resolveInstructionsPath prefers vcc-brain.md and falls back to operator.md", async () => {
  const root = join(PROJECT, ".vcc-brain");
  fs.mkdirSync(root, { recursive: true });

  expect(await resolveInstructionsPath(root)).toBe(join(root, "operator.md"));

  fs.writeFileSync(join(root, "vcc-brain.md"), "# instructions");
  expect(await resolveInstructionsPath(root)).toBe(join(root, "vcc-brain.md"));
});
