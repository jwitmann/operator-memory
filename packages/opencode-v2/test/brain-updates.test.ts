import { fs, vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";

import type { RequestMessage } from "@aerovato/operator-core/context/tokens";

import { createContextRuntime, sessionRuntime } from "../src/runtime.ts";
import { maybeAppendBrainUpdateReminder } from "../src/brain-updates.ts";

vi.mock("node:fs/promises", async () => {
  const { fs: memoryFileSystem } = await import("memfs");
  return {
    mkdir: memoryFileSystem.promises.mkdir,
    readdir: memoryFileSystem.promises.readdir,
    stat: memoryFileSystem.promises.stat,
    writeFile: memoryFileSystem.promises.writeFile,
  };
});

const SESSION = "ses_test";
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

function completedMessages(count: number): RequestMessage[] {
  const calls: unknown[] = [];
  const results: unknown[] = [];
  for (let index = 0; index < count; index++) {
    const id = `toolu_${index}`;
    calls.push({ type: "tool-call", id, name: "read", input: { filePath: `/${id}` } });
    results.push({
      type: "tool-result",
      id,
      name: "read",
      result: { type: "text", value: id },
    });
  }
  return [
    { role: "assistant", content: calls },
    { role: "tool", content: results },
  ];
}

// Rewrites the catalog with a forced mtime bump: fingerprints read mtime at
// millisecond granularity, so a same-tick rewrite would leave the
// fingerprint unmoved and the reset-asserting test would (incorrectly for
// its purpose) see a threshold crossing instead of a quiet reset.
function rewriteCatalog(text: string): void {
  const path = `${PROJECT}/.operator/catalog.md`;
  fs.writeFileSync(path, text);
  const later = new Date(Date.now() + 1000);
  fs.utimesSync(path, later, later);
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    config: { enabled: true, toolCallThreshold: 25 },
    projectDirectory: PROJECT,
    homeDirectory: HOME,
    isBrainAvailable: () => true,
    ...overrides,
  };
}

beforeEach(() => {
  vol.reset();
});

test("stays inert when disabled, unavailable, or stale", async () => {
  seedBrain();
  const runtime = createContextRuntime();

  for (const override of [
    { config: { enabled: false, toolCallThreshold: 25 } },
    { isBrainAvailable: () => false },
    { isCurrent: () => false },
  ]) {
    const unchanged = await maybeAppendBrainUpdateReminder(
      deps(override),
      runtime,
      SESSION,
      completedMessages(100),
      "preamble",
    );
    expect(unchanged).toBe("preamble");
  }

  expect(sessionRuntime(runtime, SESSION).brainUpdateActivity.fingerprint).toBeNull();
});

test("stays quiet when a reload lands during the fingerprint read", async () => {
  seedBrain();
  const runtime = createContextRuntime();
  let current = true;
  const pending = maybeAppendBrainUpdateReminder(
    { ...deps(), isCurrent: () => current },
    runtime,
    SESSION,
    completedMessages(100),
    "preamble",
  );
  current = false;

  expect(await pending).toBe("preamble");
  expect(sessionRuntime(runtime, SESSION).brainUpdateActivity.fingerprint).toBeNull();
});

test("reminds once per fingerprint era", async () => {
  seedBrain();
  const runtime = createContextRuntime();

  const seeded = await maybeAppendBrainUpdateReminder(
    deps(),
    runtime,
    SESSION,
    completedMessages(0),
    "preamble",
  );
  expect(seeded).toBe("preamble");

  const reminded = await maybeAppendBrainUpdateReminder(
    deps(),
    runtime,
    SESSION,
    completedMessages(25),
    "preamble",
  );
  expect(reminded).toContain("<operator-brain-update-reminder>");
  expect(reminded).toContain("completed 25 tool calls without a Brain change");

  const repeated = await maybeAppendBrainUpdateReminder(
    deps(),
    runtime,
    SESSION,
    completedMessages(40),
    "preamble",
  );
  expect(repeated).toBe("preamble");
});

test("honors a custom threshold", async () => {
  seedBrain();
  const runtime = createContextRuntime();
  const config = { enabled: true, toolCallThreshold: 40 };
  await maybeAppendBrainUpdateReminder(
    { ...deps(), config },
    runtime,
    SESSION,
    completedMessages(0),
    "preamble",
  );
  const below = await maybeAppendBrainUpdateReminder(
    { ...deps(), config },
    runtime,
    SESSION,
    completedMessages(39),
    "preamble",
  );
  expect(below).toBe("preamble");

  const reminded = await maybeAppendBrainUpdateReminder(
    { ...deps(), config },
    runtime,
    SESSION,
    completedMessages(40),
    "preamble",
  );
  expect(reminded).toContain("completed 40 tool calls without a Brain change");
});

test("a Brain change resets the baseline without reminding", async () => {
  seedBrain();
  const runtime = createContextRuntime();
  await maybeAppendBrainUpdateReminder(deps(), runtime, SESSION, completedMessages(0), "preamble");
  await maybeAppendBrainUpdateReminder(deps(), runtime, SESSION, completedMessages(25), "preamble");

  rewriteCatalog("# changed");

  const reset = await maybeAppendBrainUpdateReminder(
    deps(),
    runtime,
    SESSION,
    completedMessages(25),
    "preamble",
  );
  expect(reset).toBe("preamble");
  expect(sessionRuntime(runtime, SESSION).brainUpdateActivity).toMatchObject({ reminded: false });
});

test("stays quiet when the fingerprint cannot be read", async () => {
  seedBrain();
  fs.rmSync(`${PROJECT}/.operator/index`, { recursive: true });
  fs.writeFileSync(`${PROJECT}/.operator/index`, "not a directory");
  const runtime = createContextRuntime();

  const unchanged = await maybeAppendBrainUpdateReminder(
    deps(),
    runtime,
    SESSION,
    completedMessages(100),
    "preamble",
  );

  expect(unchanged).toBe("preamble");
  expect(sessionRuntime(runtime, SESSION).brainUpdateActivity.fingerprint).toBeNull();
});
