import { appendFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
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

// Default retention for one session's omission store. A BIG.txt-class
// omission runs ~50 KB, so 200 payloads stay near 10 MiB with 32 MiB of
// headroom for large-output sessions; a month keeps recovery useful without
// growing forever. The adapter enforces the count cap on every store and
// exposes the full policy through the operator:prune tool.
export const DEFAULT_RETENTION = {
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxPayloads: 200,
  maxBytes: 32 * 1024 * 1024,
};

// Retention policy for one prune run. Null dimensions are skipped, so a
// count-only sweep needs no payload stats and an age-only sweep needs no
// size accounting. All bounds prefer the newest entries: the index is
// append-only, so later lines are newer payloads.
export type RetentionPolicy = {
  readonly maxAgeMs: number | null;
  readonly maxPayloads: number | null;
  readonly maxBytes: number | null;
};

export type PruneResult = {
  // Content IDs removed in this run, oldest first.
  readonly removed: readonly string[];
  readonly freedBytes: number;
  readonly remaining: number;
};

// Removes expired and over-cap payloads for one session, then rewrites the
// index without them. Payload writes precede the index append, so a crash
// between them can only leave unindexed payload files (ignored, never
// served). Later deletion can still leave index entries pointing at missing
// files; this sweep drops those dangling entries.
export async function pruneOmissions(
  root: string,
  sessionID: string,
  policy: RetentionPolicy,
  now: number,
): Promise<Result<PruneResult, OmissionStoreError>> {
  const sessionRoot = join(root, sessionID);
  if (!isSafePathSegment(sessionID)) {
    return failure({ path: sessionRoot, cause: new Error("Unsafe path segment") });
  }

  const entriesResult = await readIndex(sessionRoot);
  if (!entriesResult.ok) {
    return entriesResult;
  }
  if (entriesResult.value.length === 0) {
    return success({ removed: [], freedBytes: 0, remaining: 0 });
  }

  // Index entries whose payload files are already gone are always dropped
  // on sweeps that gather stats; count-only sweeps skip stats and leave them
  // for the next sized run.
  const drop = new Set<string>();
  const stats = new Map<string, { size: number; ageMs: number }>();
  const needsStats = policy.maxAgeMs !== null || policy.maxBytes !== null;
  if (needsStats) {
    for (const entry of entriesResult.value) {
      try {
        const info = await stat(join(sessionRoot, entry.id));
        stats.set(entry.id, { size: info.size, ageMs: now - info.mtimeMs });
      } catch (cause) {
        if (!hasNodeErrorCode(cause, "ENOENT")) {
          return failure({ path: join(sessionRoot, entry.id), cause });
        }
        // Already gone on disk: drop the dangling index entry below.
        drop.add(entry.id);
      }
    }
  }

  if (policy.maxAgeMs !== null) {
    const maxAgeMs = policy.maxAgeMs;
    for (const entry of entriesResult.value) {
      const info = stats.get(entry.id);
      if (info === undefined || info.ageMs > maxAgeMs) {
        drop.add(entry.id);
      }
    }
  }

  const survivors = () => entriesResult.value.filter(entry => !drop.has(entry.id));
  if (policy.maxPayloads !== null) {
    const over = survivors();
    for (const entry of over.slice(0, Math.max(0, over.length - policy.maxPayloads))) {
      drop.add(entry.id);
    }
  }
  if (policy.maxBytes !== null) {
    let bytes = 0;
    for (const entry of [...survivors()].reverse()) {
      bytes += stats.get(entry.id)?.size ?? 0;
    }
    for (const entry of survivors()) {
      if (bytes <= policy.maxBytes) {
        break;
      }
      bytes -= stats.get(entry.id)?.size ?? 0;
      drop.add(entry.id);
    }
  }

  let freedBytes = 0;
  for (const entry of entriesResult.value) {
    if (!drop.has(entry.id)) {
      continue;
    }
    freedBytes += stats.get(entry.id)?.size ?? 0;
    try {
      await unlink(join(sessionRoot, entry.id));
    } catch (cause) {
      if (!hasNodeErrorCode(cause, "ENOENT")) {
        return failure({ path: join(sessionRoot, entry.id), cause });
      }
    }
  }

  const remaining = entriesResult.value.filter(entry => !drop.has(entry.id));
  try {
    await writeFile(
      indexPath(sessionRoot),
      remaining.map(entry => `${JSON.stringify(entry)}\n`).join(""),
      "utf8",
    );
  } catch (cause) {
    return failure({ path: indexPath(sessionRoot), cause });
  }

  return success({
    removed: entriesResult.value.filter(entry => drop.has(entry.id)).map(entry => entry.id),
    freedBytes,
    remaining: remaining.length,
  });
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
