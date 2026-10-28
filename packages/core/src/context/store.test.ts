import { fs, vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";

import { listOmissions, readOmission, storeOmission, storeOmissions } from "./store.ts";

vi.mock("node:fs/promises", async () => {
  const { fs: memoryFileSystem } = await import("memfs");
  return {
    appendFile: memoryFileSystem.promises.appendFile,
    mkdir: memoryFileSystem.promises.mkdir,
    readFile: memoryFileSystem.promises.readFile,
    writeFile: memoryFileSystem.promises.writeFile,
  };
});

const ROOT = "/state/omitted";
const SESSION = "ses_test";

beforeEach(() => {
  vol.reset();
});

test("stores a payload as one plain-text file and returns a content ID", async () => {
  const result = await storeOmission(ROOT, SESSION, "toolu_1:output", "original content");

  expect(result.ok).toBe(true);
  expect(result.ok && result.value).toBe("omitted-001");
  expect(fs.readFileSync(`${ROOT}/${SESSION}/omitted-001`, "utf8")).toBe("original content");
});

test("re-storing the same key returns the existing ID without rewriting", async () => {
  const first = await storeOmission(ROOT, SESSION, "toolu_1:output", "first body");
  const second = await storeOmission(ROOT, SESSION, "toolu_1:output", "second body");

  expect(first.ok && first.value).toBe("omitted-001");
  expect(second.ok && second.value).toBe("omitted-001");
  expect(fs.readFileSync(`${ROOT}/${SESSION}/omitted-001`, "utf8")).toBe("first body");
});

test("allocates sequential IDs across distinct keys", async () => {
  const one = await storeOmission(ROOT, SESSION, "toolu_1:output", "a");
  const two = await storeOmission(ROOT, SESSION, "toolu_1:input", "b");
  const three = await storeOmission(ROOT, SESSION, "toolu_2:output", "c");

  expect(one.ok && one.value).toBe("omitted-001");
  expect(two.ok && two.value).toBe("omitted-002");
  expect(three.ok && three.value).toBe("omitted-003");
});

test("reads back stored content and reports absence as null", async () => {
  await storeOmission(ROOT, SESSION, "toolu_1:output", "payload");

  const found = await readOmission(ROOT, SESSION, "omitted-001");
  expect(found.ok && found.value).toBe("payload");

  const missing = await readOmission(ROOT, SESSION, "omitted-404");
  expect(missing.ok && missing.value).toBeNull();
});

test("sessions are isolated by directory", async () => {
  await storeOmission(ROOT, SESSION, "toolu_1:output", "mine");
  const other = await readOmission(ROOT, "ses_other", "omitted-001");

  expect(other.ok && other.value).toBeNull();
});

test("lists index entries, skipping malformed lines", async () => {
  await storeOmission(ROOT, SESSION, "toolu_1:output", "a");
  await storeOmission(ROOT, SESSION, "toolu_2:input", "b");
  const indexPath = `${ROOT}/${SESSION}/index.jsonl`;
  fs.appendFileSync(indexPath, 'not-json\n{"key": 1, "id": 2}\n');

  const entries = await listOmissions(ROOT, SESSION);
  expect(entries.ok && entries.value).toEqual([
    { key: "toolu_1:output", id: "omitted-001" },
    { key: "toolu_2:input", id: "omitted-002" },
  ]);
});

test("rejects path traversal segments", async () => {
  const bad = await storeOmission(ROOT, "../escape", "k", "v");
  expect(bad.ok).toBe(false);

  const badRead = await readOmission(ROOT, SESSION, "../index.jsonl");
  expect(badRead.ok).toBe(false);
});

test("stores a batch with one index read and one append", async () => {
  const result = await storeOmissions(ROOT, SESSION, [
    { key: "toolu_1:output", content: "a" },
    { key: "toolu_1:input", content: "b" },
    { key: "toolu_2:output", content: "c" },
  ]);

  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect([...result.value.ids]).toEqual([
    ["toolu_1:output", "omitted-001"],
    ["toolu_1:input", "omitted-002"],
    ["toolu_2:output", "omitted-003"],
  ]);
  expect([...result.value.stored]).toEqual(["toolu_1:output", "toolu_1:input", "toolu_2:output"]);
  expect(result.value.failed.size).toBe(0);

  // One append carried all three lines.
  const lines = String(fs.readFileSync(`${ROOT}/${SESSION}/index.jsonl`, "utf8"))
    .trimEnd()
    .split("\n");
  expect(lines).toHaveLength(3);
  expect(fs.readFileSync(`${ROOT}/${SESSION}/omitted-002`, "utf8")).toBe("b");
});

test("reuses existing IDs and counts only fresh keys as stored", async () => {
  await storeOmissions(ROOT, SESSION, [{ key: "toolu_1:output", content: "first" }]);
  const second = await storeOmissions(ROOT, SESSION, [
    { key: "toolu_1:output", content: "second" },
    { key: "toolu_2:output", content: "new" },
  ]);

  expect(second.ok).toBe(true);
  if (!second.ok) {
    return;
  }
  expect(second.value.ids.get("toolu_1:output")).toBe("omitted-001");
  expect(second.value.ids.get("toolu_2:output")).toBe("omitted-002");
  expect([...second.value.stored]).toEqual(["toolu_2:output"]);
  expect(fs.readFileSync(`${ROOT}/${SESSION}/omitted-001`, "utf8")).toBe("first");
});

test("first occurrence wins for duplicate keys within one batch", async () => {
  const result = await storeOmissions(ROOT, SESSION, [
    { key: "toolu_1:output", content: "first" },
    { key: "toolu_1:output", content: "second" },
  ]);

  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.value.ids.get("toolu_1:output")).toBe("omitted-001");
  expect(fs.readFileSync(`${ROOT}/${SESSION}/omitted-001`, "utf8")).toBe("first");
});

test("marks unsafe keys failed without failing the batch", async () => {
  const result = await storeOmissions(ROOT, SESSION, [
    { key: "../escape", content: "evil" },
    { key: "toolu_1:output", content: "good" },
  ]);

  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect([...result.value.failed]).toEqual(["../escape"]);
  expect(result.value.ids.get("toolu_1:output")).toBe("omitted-001");
  expect(fs.existsSync(`${ROOT}/escape`)).toBe(false);
});

test("rejects an unsafe session for the whole batch", async () => {
  const result = await storeOmissions(ROOT, "../escape", [{ key: "k", content: "v" }]);

  expect(result.ok).toBe(false);
});
