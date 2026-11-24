// OpenCode sqlite ingest (Phase 2). Reads the v2 session tables
// (`session_v2` + `session_message`, with `session_part` tool rows) from
// `~/.local/share/opencode/opencode.db` (+ `opencode-local.db`) through a
// read-only open and converges user/assistant text turns to the shared
// `SessionRecord` shape. Runs only in the helper CLI process (node);
// adapters never import this module.
//
// Table choice (verified against the live db 2026-11-24): the legacy
// `session`/`message`/`part` tables are frozen (max `time_updated`
// 17899665xxxxx) while `session_v2`/`session_message` keep current time
// (2803 sessions vs 1547 legacy). Only the v2 tables are ingested; the
// legacy tables are out of scope the way frozen V1 adapter data is.
// Every query below is index-backed by construction: per-session equality
// on `session_id` (prefix of `session_message_session_seq_idx` and
// `session_part_session_message_idx`), PK point lookups on `session_v2`,
// and `PRAGMA data_version` as the change gate. No `GROUP BY`, no
// unindexed scan over message/part `data` blobs: an unindexed aggregation
// fails outright (`SQLITE_CANTOPEN` temp spill under the agent sandbox).

import { createHash } from "node:crypto";

import { RECALL_CROSS_EXCERPT_HEADER } from "@jwitmann/vcc-brain-core/recall-cross/ranking";
import type { SessionRecord } from "@jwitmann/vcc-brain-core/recall-cross/types";
import { Data, Effect, FileSystem } from "effect";

import { isRecord } from "../../utils.ts";
import { normalizeProject, RECALL_TOOL_NAMES } from "./dsh.ts";
import type { RecallIndexPaths } from "./index.ts";
import {
  coerceNumber,
  coerceText,
  insertTurns,
  openDatabase,
  RECALL_RETENTION_MS,
  readForgottenIds,
  type SqliteDatabase,
} from "./store.ts";

export const OPENCODE_DB_NAMES = ["opencode.db", "opencode-local.db"] as const;

const NO_RECALL_TITLE = "[no-recall]";

// Tool-call input is unbounded provider JSON; the index keeps the name plus
// a bounded input excerpt so one giant tool call cannot bloat the index.
const TOOL_INPUT_CAP = 2000;

export function defaultOpencodeDbPaths(home: string): readonly string[] {
  return OPENCODE_DB_NAMES.map(name => `${home}/.local/share/opencode/${name}`);
}

export class OpencodeError extends Data.TaggedError("OpencodeError")<{
  readonly file: string;
  readonly reason: "missing-table" | "unreadable" | "unsupported-schema";
}> {}

// Source key for one OpenCode session inside one db file. Stored in the
// shared `files`/`turns.source_file` columns; the `opencode:` prefix keeps
// the DSH orphan sweep (path-based) from touching these rows. The middle
// segment is the basename plus a short hash of the full path: two db files
// in different directories sharing a basename must never share a key.
export function opencodeSourceKey(dbPath: string, sessionId: string): string {
  const base =
    dbPath
      .split("/")
      .filter(part => part !== "")
      .pop() ?? "opencode.db";
  const digest = createHash("sha256").update(dbPath).digest("hex").slice(0, 8);
  return `opencode:${base}:${digest}:${sessionId}`;
}

export type OpencodeSyncSummary = {
  readonly filesRead: number;
  readonly filesSkipped: readonly { readonly file: string; readonly reason: string }[];
  readonly turnsIndexed: number;
  readonly filesRemoved: number;
  readonly rowsExpired: number;
};

const OPENCODE_STATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS opencode_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// One session's rows delete-then-insert plus fingerprint upsert. The shared
// `insertTurns` batch does the row writes; the `files` upsert stays here
// because the fingerprint keying is OpenCode-specific. Runs inside the
// caller's per-db transaction (see `syncOneOpencodeDb`).
function replaceSessionTurns(
  db: SqliteDatabase,
  source: string,
  fingerprint: string,
  now: number,
  records: readonly SessionRecord[],
): void {
  insertTurns(db, records, source);
  db.prepare("INSERT OR REPLACE INTO files (path, hash, indexed_at) VALUES (?, ?, ?)").run(
    source,
    fingerprint,
    now,
  );
}

type OpencodeSourceDb = {
  readonly db: SqliteDatabase;
  readonly close: () => void;
  readonly path: string;
  readonly hasParts: boolean;
};

function tableNames(db: SqliteDatabase): Set<string> {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const names = new Set<string>();
  if (!Array.isArray(rows)) {
    return names;
  }
  for (const row of rows) {
    if (isRecord(row)) {
      const name = coerceText(row.name);
      if (name !== "") {
        names.add(name);
      }
    }
  }
  return names;
}

// Read-only open, proven by the write-attempt fixture test: the adapter
// and helper never write to a session store, and the open mode enforces it.
// An Effect (not a throwing async function) so missing tables and unreadable
// files surface as typed failures the sync loop records as loud skips.
export const openSourceDb = Effect.fn("openSourceDb")(function* (path: string) {
  const sqlite = yield* Effect.promise(() => import("node:sqlite"));
  let db: SqliteDatabase;
  try {
    db = new sqlite.DatabaseSync(path, { readOnly: true }) as unknown as SqliteDatabase;
  } catch {
    return yield* new OpencodeError({ file: path, reason: "unreadable" });
  }
  try {
    const names = tableNames(db);
    if (!names.has("session_v2") || !names.has("session_message")) {
      db.close();
      return yield* new OpencodeError({ file: path, reason: "missing-table" });
    }
    return { db, close: () => db.close(), path, hasParts: names.has("session_part") };
  } catch (error) {
    if (!(error instanceof OpencodeError)) {
      try {
        db.close();
      } catch {
        // Close best-effort; the original error carries the failure.
      }
    }
    throw error;
  }
});

function dataVersion(db: SqliteDatabase): number {
  const row = db.prepare("PRAGMA data_version").get();
  return isRecord(row) ? coerceNumber(row.data_version) : 0;
}

function storedMeta(db: SqliteDatabase, key: string): string | null {
  const row = db.prepare("SELECT value FROM opencode_meta WHERE key = ?").get(key);
  if (!isRecord(row)) {
    return null;
  }
  const value = coerceText(row.value);
  return value === "" ? null : value;
}

// Fingerprint for one session: max message `time_updated` plus the message
// count, folded in JS over one index-ranged read. New rows carry
// `time_updated = time_created`, so one watermark catches inserts and
// edits; the count catches same-timestamp inserts. A bare
// `MAX(time_updated)` aggregate would let the planner choose a full table
// scan (observed: the `(session_id, …)` index is not eligible for the
// aggregate), so the fold keeps the access path a ranged SEARCH. Only
// `time_updated` is read per row — blob `data` pages are never touched.
function sessionFingerprint(source: OpencodeSourceDb, sessionId: string): string {
  const rows = source.db
    .prepare("SELECT time_updated FROM session_message WHERE session_id = ?")
    .all(sessionId);
  if (!Array.isArray(rows)) {
    return "0:0";
  }
  let max = 0;
  let count = 0;
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const updated = coerceNumber(row.time_updated);
    if (updated > max) {
      max = updated;
    }
    count += 1;
  }
  return `${max}:${count}`;
}

type OpencodeSessionRow = {
  readonly id: string;
  readonly directory: string;
  readonly title: string;
};

function listSessions(source: OpencodeSourceDb): OpencodeSessionRow[] {
  // `session_v2` is a tiny table (thousands of rows); a full read here is
  // the allowed counterpart of the DSH sessions-root walk.
  const rows = source.db.prepare("SELECT id, directory, title FROM session_v2").all();
  const sessions: OpencodeSessionRow[] = [];
  if (!Array.isArray(rows)) {
    return sessions;
  }
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const id = coerceText(row.id);
    if (id === "") {
      continue;
    }
    sessions.push({
      id,
      directory: coerceText(row.directory),
      title: coerceText(row.title),
    });
  }
  return sessions;
}

function readMessages(source: OpencodeSourceDb, sessionId: string): OpencodeMessageRow[] {
  // `WHERE session_id = ? ORDER BY seq` rides
  // `session_message_session_seq_idx`; the `type` filter is a per-row
  // predicate, never a scan. User/assistant only: compaction, system,
  // idle and synthetic rows are control records, like DSH `compaction/*`.
  const rows = source.db
    .prepare(
      "SELECT type, seq, time_created, data FROM session_message WHERE session_id = ? AND type IN ('user', 'assistant') ORDER BY seq",
    )
    .all(sessionId);
  const messages: OpencodeMessageRow[] = [];
  if (!Array.isArray(rows)) {
    return messages;
  }
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const type = coerceText(row.type);
    if (type !== "user" && type !== "assistant") {
      continue;
    }
    const data = coerceText(row.data);
    if (data === "") {
      continue;
    }
    messages.push({
      type,
      seq: coerceNumber(row.seq),
      time: coerceNumber(row.time_created),
      data,
    });
  }
  return messages;
}

export type OpencodeToolRow = {
  readonly seq: number;
  readonly time: number;
  readonly ordinal: number;
  readonly text: string;
};

// Chunked `IN` batches: one giant placeholder list risks the SQLite
// host-parameter limit (and the JS spread arg limit), and the throw would
// land inside the per-db transaction, rolling back every session in the
// file. 500 ids per batch keeps each statement small and independent.
const TOOL_ID_BATCH = 500;

function readToolParts(source: OpencodeSourceDb, sessionId: string): OpencodeToolRow[] {
  if (!source.hasParts) {
    return [];
  }
  // Two SEARCH steps instead of a JOIN: the planner is free to reorder a
  // join with a full scan of the small side (observed on fixtures), while
  // each step here is pinned to an index — `session_part` via its
  // `(session_id, message_id, ordinal)` prefix, `session_message` via PK
  // point lookups. The plan-shape fixture test pins both to SEARCH.
  const partRows = source.db
    .prepare(
      "SELECT message_id AS mid, ordinal AS ordinal, data AS data FROM session_part WHERE session_id = ? AND type = 'tool'",
    )
    .all(sessionId);
  if (!Array.isArray(partRows) || partRows.length === 0) {
    return [];
  }
  // Keyed by message id + ordinal: one message carries many tool parts
  // (distinct ordinals), and every part must survive — keying by message
  // id alone would silently keep only the first tool call per message.
  const parts: { mid: string; ordinal: number; data: string }[] = [];
  const seen = new Set<string>();
  for (const row of partRows) {
    if (!isRecord(row)) {
      continue;
    }
    const mid = coerceText(row.mid);
    const ordinal = coerceNumber(row.ordinal);
    const data = coerceText(row.data);
    const key = `${mid}#${ordinal}`;
    if (mid !== "" && data !== "" && !seen.has(key)) {
      seen.add(key);
      parts.push({ mid, ordinal, data });
    }
  }
  if (parts.length === 0) {
    return [];
  }
  const tools: OpencodeToolRow[] = [];
  for (let at = 0; at < parts.length; at += TOOL_ID_BATCH) {
    const batch = parts.slice(at, at + TOOL_ID_BATCH);
    const placeholders = batch.map(() => "?").join(",");
    const messageRows = source.db
      .prepare(`SELECT id, seq, time_created FROM session_message WHERE id IN (${placeholders})`)
      .all(...batch.map(part => part.mid));
    if (!Array.isArray(messageRows)) {
      continue;
    }
    const seqById = new Map<string, { seq: number; time: number }>();
    for (const row of messageRows) {
      if (!isRecord(row)) {
        continue;
      }
      const id = coerceText(row.id);
      if (id !== "" && !seqById.has(id)) {
        seqById.set(id, { seq: coerceNumber(row.seq), time: coerceNumber(row.time_created) });
      }
    }
    for (const part of batch) {
      const parsed = parseToolPart(part.data);
      const parent = seqById.get(part.mid);
      if (parsed === null || parent === undefined) {
        continue;
      }
      tools.push({ seq: parent.seq, time: parent.time, ordinal: part.ordinal, text: parsed.text });
    }
  }
  return tools;
}

function storedFingerprint(db: SqliteDatabase, source: string): string | null {
  const row = db.prepare("SELECT hash FROM files WHERE path = ?").get(source);
  if (!isRecord(row)) {
    return null;
  }
  const hash = coerceText(row.hash);
  return hash === "" ? null : hash;
}

// Delta sync over one OpenCode db file. Change gate first (`PRAGMA
// data_version` — one cheap call, false positives from unrelated-table
// writes just fall through to per-session fingerprints that match), then
// per-session fingerprints, then delete-then-insert only for changed
// sessions. Unchanged sessions cost one index-ranged read each.
function syncOneOpencodeDb(
  db: SqliteDatabase,
  source: OpencodeSourceDb,
  now: number,
  liveSessions: Set<string>,
  forgotten: ReadonlySet<string>,
): { filesRead: number; turnsIndexed: number; filesSkipped: { file: string; reason: string }[] } {
  let filesRead = 0;
  let turnsIndexed = 0;
  const filesSkipped: { file: string; reason: string }[] = [];
  // One transaction per db file: autocommit-per-session fsyncs stall for
  // minutes under the agent sandbox, while a single commit is milliseconds.
  // All-or-nothing per db — a crash leaves zero new rows, and the absent
  // fingerprints make the next run redo the work.
  db.exec("BEGIN");
  try {
    for (const session of listSessions(source)) {
      const key = opencodeSourceKey(source.path, session.id);
      liveSessions.add(session.id);
      const fingerprint = sessionFingerprint(source, session.id);
      if (storedFingerprint(db, key) === fingerprint) {
        continue;
      }
      // Forget tombstone: the fingerprint is recorded (so the session is
      // not reprocessed every sync) but no turns are indexed — a forgotten
      // session stays forgotten (see `readForgottenIds`).
      if (forgotten.has(`opencode:${session.id}`)) {
        replaceSessionTurns(db, key, fingerprint, now, []);
        continue;
      }
      const project = normalizeProject(
        session.directory === "" ? null : session.directory,
        "opencode",
      );
      const { records, turnsSkipped } = opencodeSessionRecords(
        session.id,
        project,
        session.title,
        readMessages(source, session.id),
        readToolParts(source, session.id),
      );
      if (turnsSkipped > 0 && records.length === 0 && session.title.trim() !== NO_RECALL_TITLE) {
        filesSkipped.push({ file: `${source.path}#${session.id}`, reason: "no-indexable-turns" });
      }
      replaceSessionTurns(db, key, fingerprint, now, records);
      filesRead += 1;
      turnsIndexed += records.length;
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Rollback best-effort; the original error carries the failure.
    }
    throw error;
  }
  return { filesRead, turnsIndexed, filesSkipped };
}

// Orphan sweep: indexed OpenCode sessions gone from every synced db lose
// their rows (plus the 30-day expiry backstop below for anything missed).
// PK existence checks happen in JS over one in-memory id set, never as an
// unindexed join against the foreign db.
function sweepOpencodeOrphans(db: SqliteDatabase, liveSessions: Set<string>): number {
  const rows = db
    .prepare(
      "SELECT DISTINCT session_id AS sessionId, source_file AS sourceFile FROM turns WHERE harness = 'opencode'",
    )
    .all();
  let filesRemoved = 0;
  if (!Array.isArray(rows)) {
    return filesRemoved;
  }
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const sessionId = coerceText(row.sessionId);
    const sourceFile = coerceText(row.sourceFile);
    if (sessionId === "" || sourceFile === "") {
      continue;
    }
    const bare = sessionId.startsWith("opencode:")
      ? sessionId.slice("opencode:".length)
      : sessionId;
    if (!liveSessions.has(bare)) {
      db.prepare("DELETE FROM turns WHERE source_file = ?").run(sourceFile);
      db.prepare("DELETE FROM files WHERE path = ?").run(sourceFile);
      filesRemoved += 1;
    }
  }
  return filesRemoved;
}

function expireTurns(db: SqliteDatabase, now: number): number {
  const cutoff = now - RECALL_RETENTION_MS;
  db.prepare("DELETE FROM turns WHERE CAST(timestamp AS INTEGER) < ?").run(cutoff);
  const changed = db.prepare("SELECT changes() AS n").get();
  return isRecord(changed) ? coerceNumber(changed.n) : 0;
}

export const isOpencodeCold = Effect.fn("isOpencodeCold")(function* (sqlitePath: string) {
  // True when OpenCode has never completed a sync here (no `cold_done`
  // marker): the query path must direct the user to index first instead of
  // running a minutes-long backfill inline.
  // Read-only probe: a query-path cold check must never create the index
  // file as a side effect. Any probe failure (missing/corrupt/unreadable)
  // reads as cold, directing the user to the explicit index step.
  const warm = yield* Effect.promise(async () => {
    try {
      const sqlite = await import("node:sqlite");
      const probe = new sqlite.DatabaseSync(sqlitePath, {
        readOnly: true,
      }) as unknown as SqliteDatabase;
      try {
        const names = tableNames(probe);
        if (!names.has("opencode_meta")) {
          return false;
        }
        return storedMeta(probe, "cold_done") === "1";
      } finally {
        probe.close();
      }
    } catch {
      return false;
    }
  });
  return !warm;
});

// Full-or-delta sync over OpenCode db files. Cold backfill (first run over
// hundreds of thousands of part rows) runs only here — the explicit
// `recall-cross index` step — never on the query path, which checks
// `isOpencodeCold` first and directs the user to index instead.
export const syncOpencodeIndex = Effect.fn("syncOpencodeIndex")(function* (
  paths: RecallIndexPaths,
  dbPaths: readonly string[],
  now: number,
) {
  const db = yield* Effect.promise(() => openDatabase(paths.sqlite));
  try {
    db.exec(OPENCODE_STATE_SCHEMA);
    const skipped: { file: string; reason: string }[] = [];
    const liveSessions = new Set<string>();
    let versionsMatch = storedMeta(db, "cold_done") === "1";
    let filesRead = 0;
    let turnsIndexed = 0;
    const fileSystem = yield* FileSystem.FileSystem;
    const forgotten = yield* readForgottenIds(paths.forgetLog);
    for (const dbPath of dbPaths) {
      const exists = yield* fileSystem.stat(dbPath).pipe(
        Effect.map(() => true),
        Effect.catch(() => Effect.succeed(false)),
      );
      if (!exists) {
        continue;
      }
      // Typed failures (missing tables, unreadable files) become loud
      // skips; only unexpected defects escape. `Effect.result`, not
      // try/catch: Effect failures do not throw into generators.
      const opened = yield* Effect.result(openSourceDb(dbPath));
      if (opened._tag === "Failure") {
        const failure = opened.failure;
        skipped.push({
          file: dbPath,
          reason: failure instanceof OpencodeError ? failure.reason : "unreadable",
        });
        versionsMatch = false;
        continue;
      }
      const source = opened.success;
      try {
        const version = dataVersion(source.db);
        if (storedMeta(db, `dv:${dbPath}`) !== `${version}`) {
          versionsMatch = false;
        }
        const part = syncOneOpencodeDb(db, source, now, liveSessions, forgotten);
        filesRead += part.filesRead;
        turnsIndexed += part.turnsIndexed;
        skipped.push(...part.filesSkipped);
        db.prepare("INSERT OR REPLACE INTO opencode_meta (key, value) VALUES (?, ?)").run(
          `dv:${dbPath}`,
          `${version}`,
        );
      } finally {
        source.close();
      }
    }
    if (versionsMatch) {
      // Expiry still runs on the fast path: rows age out during idle
      // periods with no source writes, and only a sync can remove them.
      const expired = expireTurns(db, now);
      return {
        filesRead,
        filesSkipped: skipped,
        turnsIndexed,
        filesRemoved: 0,
        rowsExpired: expired,
      };
    }
    const removed = sweepOpencodeOrphans(db, liveSessions);
    const expired = expireTurns(db, now);
    db.prepare("INSERT OR REPLACE INTO opencode_meta (key, value) VALUES ('cold_done', '1')").run();
    return {
      filesRead,
      filesSkipped: skipped,
      turnsIndexed,
      filesRemoved: removed,
      rowsExpired: expired,
    };
  } finally {
    db.close();
  }
});

// A user turn stores its text JSON-encoded (`{"text": ...}`), and the text
// itself is usually a JSON-encoded string (`"\"prompt\""`). Unwrap one
// encoding level only when it yields a string; anything else stays raw.
export function parseUserText(data: unknown): string | null {
  if (typeof data !== "string") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return data.trim() === "" ? null : data;
  }
  if (!isRecord(parsed) || typeof parsed.text !== "string") {
    return null;
  }
  const inner = parsed.text;
  if (inner.startsWith(`"`) && inner.endsWith(`"`) && inner.length >= 2) {
    try {
      const unwrapped: unknown = JSON.parse(inner);
      if (typeof unwrapped === "string") {
        return unwrapped.trim() === "" ? null : unwrapped;
      }
    } catch {
      // Not a doubly-encoded string: fall through to the raw text.
    }
  }
  return inner.trim() === "" ? null : inner;
}

// An assistant turn stores `{content: [{type, text}]}`. Both `text` and
// `reasoning` items carry prose in the v2 schema (unlike DSH, where only
// `text` items do), so both enter the index as assistant kind.
export function parseAssistantText(data: unknown): string | null {
  if (typeof data !== "string") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.content)) {
    return null;
  }
  const parts: string[] = [];
  for (const item of parsed.content) {
    if (
      isRecord(item)
      && (item.type === "text" || item.type === "reasoning")
      && typeof item.text === "string"
      && item.text.trim() !== ""
    ) {
      parts.push(item.text);
    }
  }
  const joined = parts.join("\n");
  return joined.trim() === "" ? null : joined;
}

// A `session_part` tool row: name plus a bounded input excerpt, or null
// when the row is not a recallable tool call (wrong shape, or one of our
// own recall tools — the self-pollution guard).
export function parseToolPart(data: unknown): { name: string; text: string } | null {
  if (typeof data !== "string") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.name !== "string" || parsed.name === "") {
    return null;
  }
  if (RECALL_TOOL_NAMES.has(parsed.name)) {
    return null;
  }
  const input = isRecord(parsed.state) ? JSON.stringify(parsed.state.input ?? null) : "null";
  const excerpt = input.length > TOOL_INPUT_CAP ? `${input.slice(0, TOOL_INPUT_CAP)}…` : input;
  return { name: parsed.name, text: `tool ${parsed.name} ${excerpt}` };
}

export type OpencodeMessageRow = {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
  readonly data: string;
};

// One session's turns converge to index records here, mirroring the DSH
// ingest's exclusion rules: header-bearing text (our own rendered excerpts)
// never re-enters the index, and `[no-recall]` titles opt the session out.
export function opencodeSessionRecords(
  sessionId: string,
  project: string,
  title: string,
  messages: readonly OpencodeMessageRow[],
  tools: readonly OpencodeToolRow[],
): { readonly records: readonly SessionRecord[]; readonly turnsSkipped: number } {
  if (title.trim() === NO_RECALL_TITLE) {
    return { records: [], turnsSkipped: messages.length + tools.length };
  }
  const storedId = `opencode:${sessionId}`;
  const records: SessionRecord[] = [];
  let turnsSkipped = 0;
  // Tool turns share their parent message's `seq` (it is the `howToPull`
  // anchor `recall --seq N` restores), but every record needs a distinct
  // pointer: the search union dedupes on pointer, so a shared pointer would
  // silently drop the tool turn or the message turn.
  const push = (
    seq: number,
    time: number,
    kind: SessionRecord["kind"],
    text: string,
    pointerSuffix: string,
  ): void => {
    if (text.includes(RECALL_CROSS_EXCERPT_HEADER)) {
      turnsSkipped += 1;
      return;
    }
    records.push({
      harness: "opencode",
      sessionId: storedId,
      project,
      timestamp: time,
      seq,
      kind,
      text,
      pointer: `${storedId}#seq=${seq}${pointerSuffix}`,
      howToPull: `vcc-brain-helper recall-cross recall ${storedId} --seq ${seq}`,
    });
  };
  for (const message of messages) {
    const text =
      message.type === "user" ? parseUserText(message.data) : parseAssistantText(message.data);
    if (text === null) {
      turnsSkipped += 1;
      continue;
    }
    push(message.seq, message.time, message.type === "user" ? "user" : "assistant", text, "");
  }
  for (const tool of tools) {
    push(tool.seq, tool.time, "tool", tool.text, `:tool:${tool.ordinal}`);
  }
  return { records, turnsSkipped };
}
