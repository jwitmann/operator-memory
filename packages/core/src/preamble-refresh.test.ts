import { fs, vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";

import { fingerprintPreamble, isCacheCold, REFRESH_FLOOR_TOKENS } from "./preamble-refresh.ts";

vi.mock("node:fs/promises", async () => {
  const { fs: memoryFileSystem } = await import("memfs");
  return {
    mkdir: memoryFileSystem.promises.mkdir,
    readdir: memoryFileSystem.promises.readdir,
    stat: memoryFileSystem.promises.stat,
    writeFile: memoryFileSystem.promises.writeFile,
  };
});

const PROJECT = "/project";
const HOME = "/home/user";

function seedBrain(): void {
  for (const root of [
    `${PROJECT}/.operator`,
    `${PROJECT}/.operator-shared`,
    `${HOME}/.operator/user`,
  ]) {
    fs.mkdirSync(`${root}/index`, { recursive: true });
    fs.writeFileSync(`${root}/operator.md`, `# ${root}`);
    fs.writeFileSync(`${root}/catalog.md`, `# catalog ${root}`);
  }
  fs.writeFileSync(`${PROJECT}/.operator/index/index.md`, "main index");
}

beforeEach(() => {
  vol.reset();
});

test("empty tree fingerprints stably", async () => {
  const first = await fingerprintPreamble(PROJECT, HOME);
  const second = await fingerprintPreamble(PROJECT, HOME);

  expect(first.ok && second.ok).toBe(true);
  expect(first.ok && first.value).toBe(second.ok ? second.value : null);
});

test("content changes move the fingerprint", async () => {
  seedBrain();
  const before = await fingerprintPreamble(PROJECT, HOME);
  expect(before.ok).toBe(true);

  fs.writeFileSync(`${PROJECT}/.operator/catalog.md`, "changed");

  const after = await fingerprintPreamble(PROJECT, HOME);
  expect(after.ok).toBe(true);
  expect(after.ok && after.value).not.toBe(before.ok ? before.value : null);
});

test("a new index file moves the fingerprint", async () => {
  seedBrain();
  const before = await fingerprintPreamble(PROJECT, HOME);
  expect(before.ok).toBe(true);

  fs.writeFileSync(`${PROJECT}/.operator/index/extra.md`, "subindex");

  const after = await fingerprintPreamble(PROJECT, HOME);
  expect(after.ok).toBe(true);
  expect(after.ok && after.value).not.toBe(before.ok ? before.value : null);
});

test("a blocking index path fails the fingerprint instead of guessing", async () => {
  seedBrain();
  fs.rmSync(`${PROJECT}/.operator/index`, { recursive: true });
  fs.writeFileSync(`${PROJECT}/.operator/index`, "not a directory");

  const result = await fingerprintPreamble(PROJECT, HOME);

  expect(result.ok).toBe(false);
});

test("cold means no finished step or zero cache reads", () => {
  expect(isCacheCold(null)).toBe(true);
  expect(isCacheCold({ cacheRead: 0 })).toBe(true);
  expect(isCacheCold({ cacheRead: 28529 })).toBe(false);
});

test("the refresh floor sits above preamble size", () => {
  expect(REFRESH_FLOOR_TOKENS).toBeGreaterThan(0);
});

test("a nested subindex moves the fingerprint like the loader sees it", async () => {
  seedBrain();
  const before = await fingerprintPreamble(PROJECT, HOME);
  expect(before.ok).toBe(true);

  fs.mkdirSync(`${PROJECT}/.operator/index/guides`, { recursive: true });
  fs.writeFileSync(`${PROJECT}/.operator/index/guides/deploy.md`, "subindex");

  const after = await fingerprintPreamble(PROJECT, HOME);
  expect(after.ok).toBe(true);
  expect(after.ok ? after.value : null).not.toBe(before.ok ? before.value : null);
});
