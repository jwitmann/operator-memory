import { readReceipts } from "@aerovato/operator-core/context/receipts";
import { fs, vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";

import { createContextRuntime, sessionRuntime } from "../src/runtime.ts";
import { maybeRefreshPreamble } from "../src/refresh.ts";

vi.mock("node:fs/promises", async () => {
  const { fs: memoryFileSystem } = await import("memfs");
  return {
    access: memoryFileSystem.promises.access,
    appendFile: memoryFileSystem.promises.appendFile,
    mkdir: memoryFileSystem.promises.mkdir,
    readdir: memoryFileSystem.promises.readdir,
    readFile: memoryFileSystem.promises.readFile,
    stat: memoryFileSystem.promises.stat,
    writeFile: memoryFileSystem.promises.writeFile,
  };
});

const SESSION = "ses_test";
const STATE = "/home/.operator/state";
const PROJECT = "/project";
const HOME = "/home/user";

function seedBrain(): void {
  for (const root of [`${PROJECT}/.operator`, `${PROJECT}/.operator-shared`]) {
    fs.mkdirSync(`${root}/index`, { recursive: true });
    fs.writeFileSync(`${root}/operator.md`, `# ops ${root}`);
    fs.writeFileSync(`${root}/catalog.md`, `# catalog ${root}`);
    fs.writeFileSync(`${root}/index/index.md`, `# index ${root}`);
  }
  fs.mkdirSync(`${HOME}/.operator/user`, { recursive: true });
  fs.writeFileSync(`${HOME}/.operator/user/operator.md`, "# user ops");
  fs.writeFileSync(`${HOME}/.operator/user/catalog.md`, "# user catalog");
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    config: { enabled: true },
    stateDirectory: STATE,
    isBrainAvailable: () => true,
    ...overrides,
  };
}

beforeEach(() => {
  vol.reset();
});

test("stays inert when disabled", async () => {
  seedBrain();
  const runtime = createContextRuntime();
  const cache = new Map();

  const outcome = await maybeRefreshPreamble(
    { ...deps(), config: { enabled: false } },
    runtime,
    SESSION,
    PROJECT,
    HOME,
    cache as never,
  );

  expect(outcome).toEqual({ refreshed: false, failed: false });
  expect(sessionRuntime(runtime, SESSION).preambleFingerprint).toBeNull();
});

test("first touch seeds the baseline without refreshing", async () => {
  seedBrain();
  const runtime = createContextRuntime();

  const outcome = await maybeRefreshPreamble(deps(), runtime, SESSION, PROJECT, HOME, new Map());

  expect(outcome).toEqual({ refreshed: false, failed: false });
  expect(sessionRuntime(runtime, SESSION).preambleFingerprint).not.toBeNull();
  const receipts = await readReceipts(`${STATE}/context-log`, SESSION);
  expect(receipts.ok && receipts.value).toEqual([]);
});

test("refreshes on Brain change with a cold cache and records a receipt", async () => {
  seedBrain();
  const runtime = createContextRuntime();
  const cache = new Map();
  await maybeRefreshPreamble(deps(), runtime, SESSION, PROJECT, HOME, cache);

  fs.writeFileSync(`${PROJECT}/.operator/catalog.md`, "# catalog with FRESHMARKER");

  const outcome = await maybeRefreshPreamble(deps(), runtime, SESSION, PROJECT, HOME, cache);

  expect(outcome.refreshed).toBe(true);
  expect(outcome.refreshed && outcome.content).toContain("FRESHMARKER");
  const receipts = await readReceipts(`${STATE}/context-log`, SESSION);
  expect(receipts.ok ? receipts.value : null).toMatchObject([
    { kind: "refresh", reason: "brain-changed" },
  ]);
});

test("defers while the cache is hot and keeps the stale baseline", async () => {
  seedBrain();
  const runtime = createContextRuntime();
  const cache = new Map();
  await maybeRefreshPreamble(deps(), runtime, SESSION, PROJECT, HOME, cache);

  fs.writeFileSync(`${PROJECT}/.operator/catalog.md`, "# changed");
  const session = sessionRuntime(runtime, SESSION);
  const baseline = session.preambleFingerprint;
  session.lastStepTokens = { input: 1, output: 1, reasoning: 0, cacheRead: 28529, cacheWrite: 0 };

  const outcome = await maybeRefreshPreamble(deps(), runtime, SESSION, PROJECT, HOME, cache);

  expect(outcome).toEqual({ refreshed: false, failed: false });
  expect(sessionRuntime(runtime, SESSION).preambleFingerprint).toBe(baseline);
  const receipts = await readReceipts(`${STATE}/context-log`, SESSION);
  expect(receipts.ok && receipts.value).toEqual([]);
});

test("defers below the estimate floor", async () => {
  seedBrain();
  const runtime = createContextRuntime();
  const cache = new Map();
  await maybeRefreshPreamble(deps(), runtime, SESSION, PROJECT, HOME, cache);

  fs.writeFileSync(`${PROJECT}/.operator/catalog.md`, "# changed");
  const session = sessionRuntime(runtime, SESSION);
  session.lastEstimate = 100;

  const outcome = await maybeRefreshPreamble(deps(), runtime, SESSION, PROJECT, HOME, cache);

  expect(outcome).toEqual({ refreshed: false, failed: false });
});

test("post-compaction pending bypasses the floor but not freshness", async () => {
  seedBrain();
  const runtime = createContextRuntime();
  const cache = new Map();
  await maybeRefreshPreamble(deps(), runtime, SESSION, PROJECT, HOME, cache);

  const session = sessionRuntime(runtime, SESSION);
  session.preambleRefreshPending = true;
  session.lastEstimate = 100;

  const unchanged = await maybeRefreshPreamble(deps(), runtime, SESSION, PROJECT, HOME, cache);
  expect(unchanged).toEqual({ refreshed: false, failed: false });
  expect(sessionRuntime(runtime, SESSION).preambleRefreshPending).toBe(false);

  fs.writeFileSync(`${PROJECT}/.operator/catalog.md`, "# changed after compact");
  sessionRuntime(runtime, SESSION).preambleRefreshPending = true;
  const outcome = await maybeRefreshPreamble(deps(), runtime, SESSION, PROJECT, HOME, cache);

  expect(outcome.refreshed).toBe(true);
  const receipts = await readReceipts(`${STATE}/context-log`, SESSION);
  expect(receipts.ok ? receipts.value : null).toMatchObject([
    { kind: "refresh", reason: "post-compaction" },
  ]);
});

test("stays quiet without the Brain and when stale", async () => {
  seedBrain();
  const runtime = createContextRuntime();

  const gated = await maybeRefreshPreamble(
    deps({ isBrainAvailable: () => false }),
    runtime,
    SESSION,
    PROJECT,
    HOME,
    new Map(),
  );
  expect(gated).toEqual({ refreshed: false, failed: false });

  const stale = await maybeRefreshPreamble(
    deps({ isCurrent: () => false }),
    runtime,
    SESSION,
    PROJECT,
    HOME,
    new Map(),
  );
  expect(stale).toEqual({ refreshed: false, failed: false });
});
