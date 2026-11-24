// Shared sqlite kernel for the recall-cross index (Phase 2). Owns the
// pieces the DSH and OpenCode syncs genuinely share — row coercion, turn
// insertion, the index-database opener, the retention backstop, and the
// forget tombstones — so the two harness syncs cannot drift apart. Imports
// only core types, `effect`, and helper `utils.ts`: never `index.ts`,
// `dsh.ts`, or `opencode.ts`, keeping the dependency direction one-way
// (both syncs import the store; nothing imports the syncs except `cli.ts`
// and `query.ts`).

import type { SessionRecord } from "@jwitmann/vcc-brain-core/recall-cross/types";
import { Effect, FileSystem } from "effect";

import { isRecord } from "../../utils.ts";

// Retention backstop shared by both harness syncs: turns older than the
// cutoff (evaluated at sync time) are deleted. One spelling only.
export const RECALL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Defensive coercion: a corrupt row must never crash a sync.
export function coerceText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function coerceNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export type SqliteDatabase = {
  readonly exec: (sql: string) => void;
  readonly prepare: (sql: string) => {
    readonly get: (...params: unknown[]) => unknown;
    readonly all: (...params: unknown[]) => unknown[];
    readonly run: (...params: unknown[]) => unknown;
  };
  readonly close: () => void;
};

export async function openDatabase(path: string): Promise<SqliteDatabase> {
  const sqlite = await import("node:sqlite");
  return new sqlite.DatabaseSync(path) as unknown as SqliteDatabase;
}

// One session's rows delete-then-insert as a statement batch. The caller
// owns the transaction (per-file for DSH, per-db for OpenCode): the batch
// itself is identical, which is why it lives here and not in either sync.
export function insertTurns(
  db: SqliteDatabase,
  turns: readonly SessionRecord[],
  sourceFile: string,
): void {
  db.prepare("DELETE FROM turns WHERE source_file = ?").run(sourceFile);
  const insert = db.prepare(
    "INSERT INTO turns (harness, session_id, project, timestamp, seq, kind, text, pointer, how_to_pull, source_file) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const turn of turns) {
    insert.run(
      turn.harness,
      turn.sessionId,
      turn.project,
      turn.timestamp,
      turn.seq,
      turn.kind,
      turn.text,
      turn.pointer,
      turn.howToPull,
      sourceFile,
    );
  }
}

// Forget tombstones: `forget.log` is the audit trail AND the resurrection
// guard. Both syncs consult this set and skip forgotten session ids, so a
// forgotten session stays forgotten until the source itself changes shape
// (there is no un-forget). Lenient parse: a corrupt log line is skipped,
// never fatal.
export const readForgottenIds = Effect.fn("readForgottenIds")(function* (forgetLog: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const text = yield* fileSystem
    .readFileString(forgetLog)
    .pipe(Effect.catch(() => Effect.succeed("")));
  const ids = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed) && typeof parsed.sessionId === "string" && parsed.sessionId !== "") {
        ids.add(parsed.sessionId);
      }
    } catch {
      // Corrupt log line: skip, never fatal.
    }
  }
  return ids;
});
