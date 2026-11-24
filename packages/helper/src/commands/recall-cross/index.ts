// Cross-session recall FTS5 index (Step 3). Owns all index mutation logic;
// `cli.ts` only parses args and calls in. Runs only in the helper CLI
// process (node); adapters never import this module. Storage:
// `~/.vcc-brain/state/recall-index/index.sqlite` (dir 0700, file 0600,
// re-enforced at every entry before any read or write).

import { createHash } from "node:crypto";

import type { SessionRecord } from "@jwitmann/vcc-brain-core/recall-cross/types";
import { Effect, FileSystem } from "effect";

import { ensurePrivateDirectory, listFiles } from "../../filesystem.ts";
import { type CliContext, isRecord } from "../../utils.ts";
import { DshSessionError, ingestDshFile } from "./dsh.ts";
import { defaultOpencodeDbPaths, syncOpencodeIndex } from "./opencode.ts";
import {
  coerceNumber,
  coerceText,
  insertTurns,
  openDatabase,
  RECALL_RETENTION_MS,
  readForgottenIds,
  type SqliteDatabase,
} from "./store.ts";

// Re-exported so existing importers (`query.ts`, fixture tests) keep one
// import site while the implementation lives in `store.ts`.
export type { SqliteDatabase };
export { coerceNumber, coerceText, insertTurns, openDatabase, RECALL_RETENTION_MS };

export const RECALL_INDEX_DIR_NAME = "recall-index";
export const RECALL_INDEX_FILE_NAME = "index.sqlite";
export const RECALL_FORGET_LOG_NAME = "forget.log";

export type RecallIndexPaths = {
  readonly dir: string;
  readonly sqlite: string;
  readonly forgetLog: string;
};

export function recallIndexPaths(home: string): RecallIndexPaths {
  const dir = `${home}/.vcc-brain/state/${RECALL_INDEX_DIR_NAME}`;
  return {
    dir,
    sqlite: `${dir}/${RECALL_INDEX_FILE_NAME}`,
    forgetLog: `${dir}/${RECALL_FORGET_LOG_NAME}`,
  };
}

export function fingerprintBytes(raw: Uint8Array): string {
  return createHash("sha256").update(raw).digest("hex");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS turns USING fts5(
  harness, session_id, project, timestamp, seq, kind, text, pointer, how_to_pull, source_file,
  tokenize = 'trigram'
);
`;

// Enforce 0700 dir / 0600 file at every entry, before any read or write.
// Creation mode does not repair pre-existing looser perms, so the entry
// check does: chmod unconditionally (no-op when already correct).
export const ensureRecallIndexPaths = Effect.fn("ensureRecallIndexPaths")(function* (
  paths: RecallIndexPaths,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  yield* ensurePrivateDirectory(paths.dir);
  const fileKind = yield* fileSystem.stat(paths.sqlite).pipe(
    Effect.map(info => info.type),
    Effect.catch(() => Effect.succeed(null)),
  );
  if (fileKind === null) {
    const db = yield* Effect.promise(() => openDatabase(paths.sqlite));
    try {
      db.exec(SCHEMA);
    } finally {
      db.close();
    }
  }
  yield* fileSystem.chmod(paths.sqlite, 0o600);
});

export type RecallSyncSummary = {
  readonly filesRead: number;
  readonly filesSkipped: readonly { readonly file: string; readonly reason: string }[];
  readonly turnsIndexed: number;
  readonly filesRemoved: number;
  readonly rowsExpired: number;
};

export function rowToRecord(value: unknown): SessionRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const sessionId = coerceText(value.session_id);
  if (sessionId === "") {
    return null;
  }
  // Defensive coercion is intentional: a corrupt row must never crash sync.
  const kindText = coerceText(value.kind);
  return {
    harness: coerceText(value.harness) === "opencode" ? "opencode" : "dsh",
    sessionId,
    project: coerceText(value.project),
    timestamp: coerceNumber(value.timestamp),
    seq: coerceNumber(value.seq),
    kind: kindText === "tool" ? "tool" : kindText === "assistant" ? "assistant" : "user",
    text: coerceText(value.text),
    pointer: coerceText(value.pointer),
    howToPull: coerceText(value.how_to_pull),
  };
}

export function readAllRecords(db: SqliteDatabase): SessionRecord[] {
  const rows = db
    .prepare(
      "SELECT harness, session_id, project, timestamp, seq, kind, text, pointer, how_to_pull FROM turns",
    )
    .all() as unknown[];
  const records: SessionRecord[] = [];
  for (const row of rows) {
    const record = rowToRecord(row);
    if (record !== null) {
      records.push(record);
    }
  }
  return records;
}

function storedHash(db: SqliteDatabase, path: string): string | null {
  const row = db.prepare("SELECT hash FROM files WHERE path = ?").get(path);
  if (!isRecord(row)) {
    return null;
  }
  const hash = coerceText(row.hash);
  return hash === "" ? null : hash;
}

// Full sync over a DSH sessions root. Fingerprint is sha256 of file bytes
// (pure function of file state); unchanged files skip ingest without
// re-reading content. Changed files delete-then-insert their rows.
// Orphaned source files (indexed but gone from disk) lose their rows.
// Expiry deletes turns older than the 30-day backstop relative to `now`.
export const syncDshIndex = Effect.fn("syncDshIndex")(function* (
  paths: RecallIndexPaths,
  sessionsRoot: string,
  now: number,
) {
  yield* ensureRecallIndexPaths(paths);
  const fileSystem = yield* FileSystem.FileSystem;
  const db = yield* Effect.promise(() => openDatabase(paths.sqlite));
  try {
    db.exec(SCHEMA);
    const entries = (yield* listFiles(sessionsRoot)).filter(entry =>
      entry.relativePath.endsWith("/session.v4.jsonl.zstd"),
    );
    const seen = new Set<string>();
    let filesRead = 0;
    let turnsIndexed = 0;
    const filesSkipped: { file: string; reason: string }[] = [];
    // Forget tombstones: a forgotten session stays forgotten — the sync
    // filters its turns instead of resurrecting them (see `readForgottenIds`
    // in `store.ts`). The fingerprint is still recorded so the file is not
    // re-ingested on every sync.
    const forgotten = yield* readForgottenIds(paths.forgetLog);
    for (const entry of entries) {
      seen.add(entry.path);
      const raw = yield* fileSystem.readFile(entry.path);
      const hash = fingerprintBytes(raw);
      if (storedHash(db, entry.path) === hash) {
        continue;
      }
      const slug = entry.relativePath.split("/")[0] ?? "";
      const result = yield* Effect.result(ingestDshFile(entry.path, slug));
      if (result._tag === "Failure") {
        const failure = result.failure;
        filesSkipped.push({
          file: entry.path,
          reason: failure instanceof DshSessionError ? failure.reason : String(failure),
        });
        continue;
      }
      filesRead += 1;
      const kept = result.success.records.filter(record => !forgotten.has(record.sessionId));
      turnsIndexed += kept.length;
      db.exec("BEGIN");
      try {
        insertTurns(db, kept, entry.path);
        db.prepare("INSERT OR REPLACE INTO files (path, hash, indexed_at) VALUES (?, ?, ?)").run(
          entry.path,
          hash,
          now,
        );
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Rollback best-effort; the original error carries the failure.
        }
        throw error;
      }
    }
    // Orphan sweep: indexed DSH source files no longer on disk lose their
    // rows. OpenCode rows (`opencode:…` source keys, owned by the OpenCode
    // sync) are excluded here and swept there.
    const known = db
      .prepare("SELECT path FROM files WHERE path NOT LIKE 'opencode:%'")
      .all() as unknown[];
    let filesRemoved = 0;
    for (const row of known) {
      if (!isRecord(row)) {
        continue;
      }
      const path = coerceText(row.path);
      if (path !== "" && !seen.has(path)) {
        db.prepare("DELETE FROM turns WHERE source_file = ?").run(path);
        db.prepare("DELETE FROM files WHERE path = ?").run(path);
        filesRemoved += 1;
      }
    }
    // 30-day backstop: delete turns older than cutoff.
    const cutoff = now - RECALL_RETENTION_MS;
    db.prepare("DELETE FROM turns WHERE CAST(timestamp AS INTEGER) < ?").run(cutoff);
    const expired = db.prepare("SELECT changes() AS n").get();
    const rowsExpired = isRecord(expired) ? coerceNumber(expired.n) : 0;
    return {
      filesRead,
      filesSkipped,
      turnsIndexed,
      filesRemoved,
      rowsExpired,
    } satisfies RecallSyncSummary;
  } finally {
    db.close();
  }
});

export type ForgetResult =
  | { readonly status: "deleted"; readonly rows: number }
  | { readonly status: "not-found" };

export const recallCrossIndex = Effect.fn("recallCrossIndex")(function* (
  context: CliContext,
  sessionsRoot: string | null,
  now: number,
) {
  const root = sessionsRoot ?? `${context.home}/.dsh/sessions`;
  const paths = recallIndexPaths(context.home);
  const dsh = yield* syncDshIndex(paths, root, now);
  const opencode = yield* syncOpencodeIndex(paths, defaultOpencodeDbPaths(context.home), now);
  const lines = [
    `Indexed ${dsh.turnsIndexed + opencode.turnsIndexed} turns from ${dsh.filesRead + opencode.filesRead} sources (dsh: ${dsh.turnsIndexed}/${dsh.filesRead}, opencode: ${opencode.turnsIndexed}/${opencode.filesRead}).`,
    `Skipped ${dsh.filesSkipped.length + opencode.filesSkipped.length}, removed ${dsh.filesRemoved + opencode.filesRemoved} orphans, expired ${dsh.rowsExpired + opencode.rowsExpired}.`,
  ];
  for (const skip of [...dsh.filesSkipped, ...opencode.filesSkipped]) {
    lines.push(`skip ${skip.file}: ${skip.reason}`);
  }
  return { exitCode: 0, output: lines.join("\n") };
});

export const recallCrossForget = Effect.fn("recallCrossForget")(function* (
  context: CliContext,
  sessionId: string,
  harness: string | undefined,
  now: number,
) {
  const paths = recallIndexPaths(context.home);
  if (harness !== undefined && harness !== "dsh" && harness !== "opencode") {
    return { exitCode: 2, output: `Unknown harness: ${harness}` };
  }
  return yield* forgetSession(paths, sessionId, { harness, now });
});

function parseForgetId(
  sessionId: string,
  harness: string | null,
): { harness: string; id: string } | null {
  const prefixed = sessionId.match(/^(dsh|opencode):(.+)$/);
  if (prefixed !== null) {
    const [, prefix, rest] = prefixed;
    if (harness !== null && harness !== prefix) {
      return null;
    }
    return { harness: prefix as string, id: `${prefix}:${rest}` };
  }
  if (harness === null) {
    return null;
  }
  return { harness, id: `${harness}:${sessionId}` };
}

// Delete a session's rows and append one JSONL line to `forget.log`.
// Unknown id is a no-op with a zero exit code and a `not-found` stdout line,
// never a log line. Prefix disagreement exits non-zero without deleting.
export const forgetSession = Effect.fn("forgetSession")(function* (
  paths: RecallIndexPaths,
  sessionId: string,
  options: {
    readonly harness?: string;
    readonly reason?: string;
    readonly actor?: string;
    readonly now?: number;
  },
) {
  yield* ensureRecallIndexPaths(paths);
  const parsed = parseForgetId(sessionId, options.harness ?? null);
  if (parsed === null) {
    return {
      result: { status: "mismatch" },
      exitCode: 2,
      output: `Harness mismatch: --harness ${options.harness ?? "(none)"} disagrees with id ${sessionId}`,
    };
  }
  const db = yield* Effect.promise(() => openDatabase(paths.sqlite));
  try {
    const sources = db
      .prepare("SELECT DISTINCT source_file AS sourceFile FROM turns WHERE session_id = ?")
      .all(parsed.id) as unknown[];
    const existing = db
      .prepare("SELECT COUNT(*) AS n FROM turns WHERE session_id = ?")
      .get(parsed.id);
    const count = isRecord(existing) ? coerceNumber(existing.n) : 0;
    if (count === 0) {
      return {
        result: { status: "not-found" } satisfies ForgetResult,
        exitCode: 0,
        output: "not-found",
      };
    }
    db.prepare("DELETE FROM turns WHERE session_id = ?").run(parsed.id);
    for (const row of sources) {
      if (!isRecord(row)) {
        continue;
      }
      const sourceFile = coerceText(row.sourceFile);
      if (sourceFile === "") {
        continue;
      }
      const remaining = db
        .prepare("SELECT COUNT(*) AS n FROM turns WHERE source_file = ?")
        .get(sourceFile);
      if (isRecord(remaining) && coerceNumber(remaining.n) === 0) {
        db.prepare("DELETE FROM files WHERE path = ?").run(sourceFile);
      }
    }
    const line = `${JSON.stringify({
      ts: options.now ?? Date.now(),
      sessionId: parsed.id,
      harness: parsed.harness,
      reason: options.reason ?? "explicit",
      actor: options.actor ?? "cli",
    })}\n`;
    const fileSystem = yield* FileSystem.FileSystem;
    const previous = yield* fileSystem
      .readFileString(paths.forgetLog)
      .pipe(Effect.catch(() => Effect.succeed("")));
    yield* fileSystem.writeFileString(paths.forgetLog, `${previous}${line}`);
    yield* fileSystem
      .chmod(paths.forgetLog, 0o600)
      .pipe(Effect.catch(() => Effect.succeed(undefined)));
    return {
      result: { status: "deleted", rows: count } satisfies ForgetResult,
      exitCode: 0,
      output: `deleted ${count}`,
    };
  } finally {
    db.close();
  }
});
