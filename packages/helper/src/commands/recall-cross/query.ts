// Cross-session recall query + single-session recall (Step 4). Rendering,
// search, and full-text session pulls live here; `cli.ts` only parses args
// and calls in. Runs only in the helper CLI process (node). On-demand sync, then FTS5 `MATCH` + BM25 candidate
// collection, then `instr` fallback when `MATCH` misses or the query
// carries punctuation/single characters. The helper collects candidates in
// BM25 order; core `rankRecall` applies the single final ordering.

import {
  RECALL_CROSS_EXCERPT_HEADER,
  rankRecall,
} from "@jwitmann/vcc-brain-core/recall-cross/ranking";
import type {
  RecallHit,
  RecallHarness,
  SessionRecord,
} from "@jwitmann/vcc-brain-core/recall-cross/types";
import { Effect, FileSystem } from "effect";

import type { CliContext } from "../../utils.ts";
import {
  ensureRecallIndexPaths,
  openDatabase,
  type RecallIndexPaths,
  recallIndexPaths,
  rowToRecord,
  type SqliteDatabase,
  syncDshIndex,
} from "./index.ts";
import { normalizeProject } from "./dsh.ts";

export type RecallQueryOptions = {
  readonly keywords: readonly string[];
  readonly project: string;
  readonly peers: readonly string[];
  readonly harness?: RecallHarness | "all";
  readonly topN?: number;
  readonly now: number;
};

const SELECT_COLUMNS =
  "harness, session_id, project, timestamp, seq, kind, text, pointer, how_to_pull";

function escapePhrase(term: string): string {
  return term.replace(/"/g, `""`);
}

function harnessClause(harness: RecallHarness | "all" | undefined): string {
  return harness === undefined || harness === "all" ? "" : " AND harness = ? ";
}

function harnessArgs(harness: RecallHarness | "all" | undefined): readonly unknown[] {
  return harness === undefined || harness === "all" ? [] : [harness];
}

function collectRecords(rows: unknown): SessionRecord[] {
  const records: SessionRecord[] = [];
  if (!Array.isArray(rows)) {
    return records;
  }
  for (const row of rows) {
    const record = rowToRecord(row);
    if (record !== null) {
      records.push(record);
    }
  }
  return records;
}

// `MATCH` misses on punctuation/single characters or throws on FTS syntax:
// the caller treats empty-or-throw as the signal for the `instr` fallback.
function matchCandidates(
  db: SqliteDatabase,
  keywords: readonly string[],
  harness: RecallHarness | "all" | undefined,
): SessionRecord[] {
  const terms = keywords.map(keyword => keyword.trim()).filter(term => term !== "");
  if (terms.length === 0) {
    return [];
  }
  const match = terms.map(term => `"${escapePhrase(term)}"`).join(" AND ");
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}, bm25(turns) AS score FROM turns WHERE turns MATCH ?${harnessClause(harness)} ORDER BY score LIMIT 50`,
    )
    .all(match, ...harnessArgs(harness));
  return collectRecords(rows);
}

function instrCandidates(
  db: SqliteDatabase,
  keywords: readonly string[],
  harness: RecallHarness | "all" | undefined,
): SessionRecord[] {
  const terms = keywords.map(keyword => keyword.trim().toLowerCase()).filter(term => term !== "");
  if (terms.length === 0) {
    return [];
  }
  const conditions = terms.map(() => "instr(lower(text), ?) > 0").join(" AND ");
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM turns WHERE ${conditions}${harnessClause(harness)} ORDER BY timestamp DESC LIMIT 50`,
    )
    .all(...terms, ...harnessArgs(harness));
  return collectRecords(rows);
}

function carriesFallbackSignals(keywords: readonly string[]): boolean {
  return keywords.some(keyword => keyword.trim().length <= 1 || /[^\p{L}\p{N}\s]/u.test(keyword));
}

export function searchCandidates(
  db: SqliteDatabase,
  keywords: readonly string[],
  harness: RecallHarness | "all" | undefined,
): { readonly records: readonly SessionRecord[]; readonly fallback: boolean } {
  let matched: SessionRecord[] = [];
  try {
    matched = matchCandidates(db, keywords, harness);
  } catch {
    matched = [];
  }
  if (matched.length > 0 && !carriesFallbackSignals(keywords)) {
    return { records: matched, fallback: false };
  }
  // Union, never replace: a query that matched under FTS5 must not come
  // back empty because the fallback path missed. Dedupe on pointer.
  const extra = instrCandidates(db, keywords, harness);
  const seen = new Set(matched.map(record => record.pointer));
  const records = [...matched];
  for (const record of extra) {
    if (!seen.has(record.pointer)) {
      seen.add(record.pointer);
      records.push(record);
    }
  }
  return { records, fallback: matched.length === 0 };
}

export function renderHit(hit: RecallHit): string {
  const excerpt = `${RECALL_CROSS_EXCERPT_HEADER} ${hit.excerpt}`;
  return [
    `- [${hit.record.sessionId}#seq=${hit.record.seq}] (${hit.record.harness}/${hit.record.kind}) ${excerpt}`,
    `  ${hit.record.howToPull}`,
  ].join("\n");
}

// On-demand sync, then search, then the single core re-sort. A missing or
// empty index is a clean error directing the user to index first — never a
// silent auto-backfill, never a stack trace.
export const queryRecall = Effect.fn("queryRecall")(function* (
  paths: RecallIndexPaths,
  sessionsRoot: string,
  options: RecallQueryOptions,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const exists = yield* fileSystem.stat(paths.sqlite).pipe(
    Effect.map(() => true),
    Effect.catch(() => Effect.succeed(false)),
  );
  if (!exists) {
    return {
      exitCode: 2 as const,
      output: "No recall index yet. Run: vcc-brain-helper recall-cross index",
      hits: [] as const,
    };
  }
  yield* syncDshIndex(paths, sessionsRoot, options.now);
  const db = yield* Effect.promise(() => openDatabase(paths.sqlite));
  try {
    const { records } = searchCandidates(db, options.keywords, options.harness);
    if (records.length === 0) {
      return { exitCode: 0 as const, output: "No matching turns.", hits: [] as const };
    }
    const hits = rankRecall(
      records,
      {
        keywords: options.keywords,
        scope: { project: options.project, peers: options.peers },
        harness: options.harness,
        topN: options.topN,
      },
      options.now,
    );
    if (hits.length === 0) {
      return { exitCode: 0 as const, output: "No matching turns in scope.", hits: [] as const };
    }
    return { exitCode: 0 as const, output: hits.map(renderHit).join("\n"), hits };
  } finally {
    db.close();
  }
});

// Full-text pull of one indexed session, newest-last. An optional `seq`
// restores a single turn; otherwise every turn renders in order. Unknown
// ids are a clean `not-found`, never a stack trace.
export const recallSessionTurns = Effect.fn("recallSessionTurns")(function* (
  paths: RecallIndexPaths,
  sessionsRoot: string,
  sessionId: string,
  seq: number | null,
  now: number,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const exists = yield* fileSystem.stat(paths.sqlite).pipe(
    Effect.map(() => true),
    Effect.catch(() => Effect.succeed(false)),
  );
  if (!exists) {
    return {
      exitCode: 2 as const,
      output: "No recall index yet. Run: vcc-brain-helper recall-cross index",
    };
  }
  yield* syncDshIndex(paths, sessionsRoot, now);
  const db = yield* Effect.promise(() => openDatabase(paths.sqlite));
  try {
    const rows = db
      .prepare(
        seq === null
          ? `SELECT ${SELECT_COLUMNS} FROM turns WHERE session_id = ? ORDER BY timestamp ASC, seq ASC LIMIT 200`
          : `SELECT ${SELECT_COLUMNS} FROM turns WHERE session_id = ? AND CAST(seq AS INTEGER) = ? ORDER BY timestamp ASC, seq ASC LIMIT 200`,
      )
      .all(...(seq === null ? [sessionId] : [sessionId, seq]));
    const records = collectRecords(rows);
    if (records.length === 0) {
      return { exitCode: 0 as const, output: "not-found" };
    }
    const blocks = records.map(
      record =>
        `[${record.sessionId}#seq=${record.seq}] (${record.harness}/${record.kind})\n${RECALL_CROSS_EXCERPT_HEADER} ${record.text}`,
    );
    return { exitCode: 0 as const, output: blocks.join("\n\n") };
  } finally {
    db.close();
  }
});

export const recallCrossQuery = Effect.fn("recallCrossQuery")(function* (
  context: CliContext,
  keywords: readonly string[],
  options: {
    readonly harness?: string;
    readonly project?: string;
    readonly peers?: readonly string[];
    readonly root?: string | null;
    readonly topN?: number;
    readonly now: number;
  },
) {
  if (
    options.harness !== undefined
    && options.harness !== "dsh"
    && options.harness !== "opencode"
    && options.harness !== "all"
  ) {
    return {
      exitCode: 2 as const,
      output: `Unknown harness: ${options.harness}`,
      hits: [] as const,
    };
  }
  if (keywords.map(keyword => keyword.trim()).filter(term => term !== "").length === 0) {
    return {
      exitCode: 2 as const,
      output: "Usage: recall-cross query [--harness dsh|opencode|all] <keywords>",
      hits: [] as const,
    };
  }
  const paths = recallIndexPaths(context.home);
  yield* ensureRecallIndexPaths(paths);
  return yield* queryRecall(paths, options.root ?? `${context.home}/.dsh/sessions`, {
    keywords,
    project: normalizeProject(options.project ?? context.cwd, "home"),
    peers: options.peers ?? [],
    harness: options.harness as RecallHarness | "all" | undefined,
    topN: options.topN,
    now: options.now,
  });
});

export const recallCrossRecall = Effect.fn("recallCrossRecall")(function* (
  context: CliContext,
  sessionId: string,
  seq: number | null,
  root: string | null,
  now: number,
) {
  if (sessionId.trim() === "") {
    return { exitCode: 2 as const, output: "Usage: recall-cross recall <session-id> [--seq N]" };
  }
  const paths = recallIndexPaths(context.home);
  yield* ensureRecallIndexPaths(paths);
  return yield* recallSessionTurns(
    paths,
    root ?? `${context.home}/.dsh/sessions`,
    sessionId,
    seq,
    now,
  );
});
