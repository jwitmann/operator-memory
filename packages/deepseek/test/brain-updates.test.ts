import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { readReceipts } from "@aerovato/operator-core/context/receipts";

import { maybeAppendBrainUpdateReminder } from "../src/brain-updates.ts";
import { createDshRuntime, sessionRuntime } from "../src/runtime.ts";

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "operator-dsh-brain-"));
  dirs.push(dir);
  return dir;
}

async function seedBrain(project: string, home: string): Promise<void> {
  for (const root of [join(project, ".operator"), join(project, ".operator-shared")]) {
    await mkdir(join(root, "index"), { recursive: true });
    await writeFile(join(root, "operator.md"), `# ops ${root}`);
    await writeFile(join(root, "catalog.md"), `# catalog ${root}`);
    await writeFile(join(root, "index", "index.md"), `# index ${root}`);
  }
  await mkdir(join(home, ".operator", "user"), { recursive: true });
  await writeFile(join(home, ".operator", "user", "operator.md"), "# user ops");
  await writeFile(join(home, ".operator", "user", "catalog.md"), "# user catalog");
}

function seedCompletedCalls(
  sessionId: string,
  runtime: ReturnType<typeof createDshRuntime>,
  count: number,
): void {
  const session = sessionRuntime(runtime, sessionId);
  for (let index = 0; index < count; index++) {
    const callId = `c${index}`;
    session.pendingCallNames.set(callId, "bash");
    session.completedCallIds.add(callId);
  }
}

function deps(project: string, home: string, state: string) {
  return {
    config: { enabled: true, toolCallThreshold: 25 },
    projectDirectory: project,
    homeDirectory: home,
    stateDirectory: state,
    isBrainAvailable: () => true,
    reportReceiptFailure: () => undefined,
  };
}

test("writes one log-only receipt when the reminder fires", async () => {
  const project = await makeDir();
  const home = await makeDir();
  const state = await makeDir();
  await seedBrain(project, home);
  const runtime = createDshRuntime();

  const seeded = await maybeAppendBrainUpdateReminder(
    deps(project, home, state),
    runtime,
    "session-test",
    "preamble",
  );
  expect(seeded).toBe("preamble");

  seedCompletedCalls("session-test", runtime, 25);
  const reminded = await maybeAppendBrainUpdateReminder(
    deps(project, home, state),
    runtime,
    "session-test",
    "preamble",
  );
  expect(reminded).toContain("<operator-brain-update-reminder>");

  const raw = await readFile(join(state, "context-log", "session-test.log"), "utf8");
  const lines = raw.trim().split("\n");
  expect(lines).toHaveLength(1);
  const receipt = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
  expect(receipt).toMatchObject({
    kind: "brain-reminder",
    threshold: 25,
    completedSinceBaseline: 25,
  });
  expect(typeof receipt.at).toBe("string");
});

test("writes no receipt when quiet", async () => {
  const project = await makeDir();
  const home = await makeDir();
  const state = await makeDir();
  await seedBrain(project, home);
  const runtime = createDshRuntime();

  const seeded = await maybeAppendBrainUpdateReminder(
    deps(project, home, state),
    runtime,
    "session-test",
    "preamble",
  );
  expect(seeded).toBe("preamble");

  seedCompletedCalls("session-test", runtime, 10);
  const quiet = await maybeAppendBrainUpdateReminder(
    deps(project, home, state),
    runtime,
    "session-test",
    "preamble",
  );
  expect(quiet).toBe("preamble");

  const logged = await readReceipts(join(state, "context-log"), "session-test");
  expect(logged.ok && logged.value).toEqual([]);
});

test("a lost receipt never fails the reminder", async () => {
  const project = await makeDir();
  const home = await makeDir();
  const state = await makeDir();
  await seedBrain(project, home);
  const runtime = createDshRuntime();

  const seeded = await maybeAppendBrainUpdateReminder(
    deps(project, home, state),
    runtime,
    "../escape",
    "preamble",
  );
  expect(seeded).toBe("preamble");

  seedCompletedCalls("../escape", runtime, 25);
  const reminded = await maybeAppendBrainUpdateReminder(
    deps(project, home, state),
    runtime,
    "../escape",
    "preamble",
  );
  expect(reminded).toContain("<operator-brain-update-reminder>");
});
