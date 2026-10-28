import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { failure, hasNodeErrorCode, type Result, success } from "../utils.ts";

// Omission store: one plain-text file per payload under
// <root>/<sessionID>/<contentID>, append-only. A per-session index file
// (<root>/<sessionID>/index.jsonl) maps the stable trim key
// (`<callID>:input` / `<callID>:output`) to its content ID. Re-storing an
// existing key returns the existing ID without rewriting anything, which is
// what makes re-trimming byte-identical across requests. The caller supplies
// the root (the adapter passes `~/.operator/state/omitted`); core stays
// harness-agnostic.

export type OmissionStoreError = {
  readonly path: string;
  readonly cause: unknown;
};

export type OmissionIndexEntry = {
  readonly key: string;
  readonly id: string;
};

// One omission payload to persist. Tokens are precomputed by the trim
// planner's single walk so receipt accounting never re-encodes content.
export type OmissionBatchItem = {
  readonly key: string;
  readonly content: string;
};

export type BatchStoreResult = {
  // Resolved content ID for every requested key that persisted or already
  // existed. Keys that failed have no entry.
  readonly ids: ReadonlyMap<string, string>;
  // Keys newly persisted by this call (pre-existing keys resolve but are
  // not counted, matching the adapter's receipt semantics).
  readonly stored: ReadonlySet<string>;
  // Keys that could not be persisted; the caller leaves those parts intact.
  readonly failed: ReadonlySet<string>;
};

const INDEX_FILE = "index.jsonl";
const ID_PREFIX = "omitted-";

export async function storeOmissions(
  root: string,
  sessionID: string,
  items: readonly OmissionBatchItem[],
): Promise<Result<BatchStoreResult, OmissionStoreError>> {
  const sessionRoot = join(root, sessionID);
  if (!isSafePathSegment(sessionID)) {
    return failure({ path: sessionRoot, cause: new Error("Unsafe path segment") });
  }

  const directoryResult = await mkdirSafe(sessionRoot);
  if (!directoryResult.ok) {
    return directoryResult;
  }

  const entriesResult = await readIndex(sessionRoot);
  if (!entriesResult.ok) {
    return entriesResult;
  }

  const known = new Map<string, string>();
  for (const entry of entriesResult.value) {
    if (!known.has(entry.key)) {
      known.set(entry.key, entry.id);
    }
  }

  const ids = new Map<string, string>(known);
  const stored = new Set<string>();
  const failed = new Set<string>();
  const fresh: OmissionIndexEntry[] = [];
  let next = nextId(entriesResult.value);

  for (const item of items) {
    if (ids.has(item.key)) {
      continue;
    }
    if (!isSafePathSegment(item.key)) {
      failed.add(item.key);
      continue;
    }
    const id = formatContentID(next);
    next += 1;
    try {
      await writeFile(join(sessionRoot, id), item.content, "utf8");
    } catch {
      failed.add(item.key);
      continue;
    }
    ids.set(item.key, id);
    stored.add(item.key);
    fresh.push({ key: item.key, id });
  }

  if (fresh.length > 0) {
    const lines = fresh.map(entry => `${JSON.stringify(entry)}\n`).join("");
    try {
      await appendFile(indexPath(sessionRoot), lines, "utf8");
    } catch (cause) {
      for (const entry of fresh) {
        ids.delete(entry.key);
        stored.delete(entry.key);
        failed.add(entry.key);
      }
      return failure({ path: indexPath(sessionRoot), cause });
    }
  }

  return success({ ids, stored, failed });
}

export async function storeOmission(
  root: string,
  sessionID: string,
  key: string,
  content: string,
): Promise<Result<string, OmissionStoreError>> {
  const batched = await storeOmissions(root, sessionID, [{ key, content }]);
  if (!batched.ok) {
    return batched;
  }
  const id = batched.value.ids.get(key);
  if (id === undefined) {
    return failure({ path: join(root, sessionID), cause: new Error("Omission not persisted") });
  }
  return success(id);
}

export async function readOmission(
  root: string,
  sessionID: string,
  contentID: string,
): Promise<Result<string | null, OmissionStoreError>> {
  const payloadPath = join(root, sessionID, contentID);
  if (!isSafePathSegment(sessionID) || !isSafePathSegment(contentID)) {
    return failure({ path: payloadPath, cause: new Error("Unsafe path segment") });
  }

  try {
    return success(await readFile(payloadPath, "utf8"));
  } catch (cause) {
    return hasNodeErrorCode(cause, "ENOENT")
      ? success(null)
      : failure({ path: payloadPath, cause });
  }
}

export async function listOmissions(
  root: string,
  sessionID: string,
): Promise<Result<readonly OmissionIndexEntry[], OmissionStoreError>> {
  if (!isSafePathSegment(sessionID)) {
    return failure({ path: join(root, sessionID), cause: new Error("Unsafe path segment") });
  }
  return readIndex(join(root, sessionID));
}

async function readIndex(
  sessionRoot: string,
): Promise<Result<readonly OmissionIndexEntry[], OmissionStoreError>> {
  const path = indexPath(sessionRoot);

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    return hasNodeErrorCode(cause, "ENOENT") ? success([]) : failure({ path, cause });
  }

  // Append-only log: malformed lines are skipped, never fatal.
  const entries: OmissionIndexEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed === "object"
        && parsed !== null
        && "key" in parsed
        && "id" in parsed
        && typeof parsed.key === "string"
        && typeof parsed.id === "string"
      ) {
        entries.push({ key: parsed.key, id: parsed.id });
      }
    } catch {
      // Skip malformed line.
    }
  }

  return success(entries);
}

async function mkdirSafe(path: string): Promise<Result<void, OmissionStoreError>> {
  try {
    await mkdir(path, { recursive: true });
    return success(undefined);
  } catch (cause) {
    return failure({ path, cause });
  }
}

function indexPath(sessionRoot: string): string {
  return join(sessionRoot, INDEX_FILE);
}

function nextId(entries: readonly OmissionIndexEntry[]): number {
  let max = 0;
  for (const entry of entries) {
    const suffix = entry.id.startsWith(ID_PREFIX) ? entry.id.slice(ID_PREFIX.length) : null;
    const value = suffix === null ? Number.NaN : Number.parseInt(suffix, 10);
    if (!Number.isNaN(value) && value > max) {
      max = value;
    }
  }
  return max + 1;
}

function formatContentID(id: number): string {
  return `${ID_PREFIX}${String(id).padStart(3, "0")}`;
}

export function isSafePathSegment(segment: string): boolean {
  return (
    segment.length > 0 && !segment.includes("/") && !segment.includes("\\") && segment !== ".."
  );
}
