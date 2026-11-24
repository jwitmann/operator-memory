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
  RecallHarness,
  RecallHit,
  SessionRecord,
} from "@jwitmann/vcc-brain-core/recall-cross/types";
import { Effect, FileSystem } from "effect";

import type { CliContext } from "../../utils.ts";
import { normalizeProject } from "./dsh.ts";
import {
  ensureRecallIndexPaths,
  openDatabase,
  type RecallIndexPaths,
  recallIndexPaths,
  rowToRecord,
  type SqliteDatabase,
  syncDshIndex,
} from "./index.ts";
import { defaultOpencodeDbPaths, isOpencodeCold, syncOpencodeIndex } from "./opencode.ts";

export type RecallQueryOptions = {
  readonly keywords: readonly string[];
  readonly project: string;
  readonly peers: readonly string[];
  readonly harness?: RecallHarness | "all";
  readonly topN?: number;
  readonly now: number;
  readonly opencodeDbPaths?: readonly string[];
};

// Cold backfill (first run over hundreds of thousands of foreign rows)
// runs only in the explicit `recall-cross index` step, never on the query
// path: a missing/never-indexed store is a clean error directing the user
// to index first, never a silent latency ambush. `wantsOpencode` scopes
// the work — an explicit `--harness dsh` skips OpenCode entirely.
function opencodeWants(harness: RecallHarness | "all" | undefined): boolean {
  return harness === undefined || harness === "all" || harness === "opencode";
}

const syncOpencodeForQuery = Effect.fn("syncOpencodeForQuery")(function* (
  paths: RecallIndexPaths,
  home: string,
  harness: RecallHarness | "all" | undefined,
  now: number,
  opencodeDbPaths: readonly string[] | undefined,
) {
  if (!opencodeWants(harness)) {
    return null;
  }
  const cold = yield* isOpencodeCold(paths.sqlite);
  if (cold) {
    if (harness === "opencode") {
      return "No OpenCode recall index yet. Run: vcc-brain-helper recall-cross index";
    }
    return null;
  }
  yield* syncOpencodeIndex(paths, opencodeDbPaths ?? defaultOpencodeDbPaths(home), now);
  return null;
});

const SELECT_COLUMNS =
  "harness, session_id, project, timestamp, seq, kind, text, pointer, how_to_pull";

// Candidate cap: measured 2026-11-24 on a 22k-turn corpus — worst
// origin depth 149 (long-turn BM25 burial), latency flat 7–25ms from
// 50 to 5000. 500 covers ~3x the worst observed depth at zero
// latency cost; re-measure if the corpus grows an order of magnitude.
const CANDIDATE_LIMIT = 500;

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

// Narrow-then-fetch: selecting wide `text` rows inside the ORDER BY
// spills the sorter to temp files, which sandboxed runs cannot create
// (SQLITE_CANTOPEN past ~50 wide rows). Sort narrow rowids in memory,
// then point-fetch the winners; the JS re-sort preserves candidate
// order for the single core re-sort downstream. Callers must cap input
// at CANDIDATE_LIMIT: the single IN list is only safe bounded.
function fetchOrdered(db: SqliteDatabase, ids: readonly unknown[]): unknown[] {
  const rowids = ids
    .map(id => (typeof id === "number" ? id : Number((id as Record<string, unknown>).rowid)))
    .filter(id => Number.isInteger(id));
  if (rowids.length === 0) {
    return [];
  }
  const order = new Map(rowids.map((id, at) => [id, at]));
  const position = (row: Record<string, unknown>): number =>
    order.get(Number(row.rowid)) ?? Number.MAX_SAFE_INTEGER;
  const rows = db
    .prepare(
      `SELECT rowid AS rowid, ${SELECT_COLUMNS} FROM turns WHERE rowid IN (${rowids.map(() => "?").join(",")})`,
    )
    .all(...rowids) as Array<Record<string, unknown>>;
  rows.sort((a, b) => position(a) - position(b));
  return rows;
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
  const ids = db
    .prepare(
      `SELECT rowid AS rowid FROM turns WHERE turns MATCH ?${harnessClause(harness)} ORDER BY bm25(turns) LIMIT ${CANDIDATE_LIMIT}`,
    )
    .all(match, ...harnessArgs(harness));
  return collectRecords(fetchOrdered(db, ids as readonly unknown[]));
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
  const ids = db
    .prepare(
      `SELECT rowid AS rowid FROM turns WHERE ${conditions}${harnessClause(harness)} ORDER BY timestamp DESC LIMIT ${CANDIDATE_LIMIT}`,
    )
    .all(...terms, ...harnessArgs(harness));
  return collectRecords(fetchOrdered(db, ids as readonly unknown[]));
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
  home: string,
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
  const opencodeError = yield* syncOpencodeForQuery(
    paths,
    home,
    options.harness,
    options.now,
    options.opencodeDbPaths,
  );
  if (opencodeError !== null) {
    return { exitCode: 2 as const, output: opencodeError, hits: [] as const };
  }
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
  home: string,
  opencodeDbPaths?: readonly string[],
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
  if (sessionId.startsWith("opencode:") || !sessionId.startsWith("dsh:")) {
    const opencodeError = yield* syncOpencodeForQuery(
      paths,
      home,
      sessionId.startsWith("opencode:") ? "opencode" : undefined,
      now,
      opencodeDbPaths,
    );
    if (opencodeError !== null) {
      return { exitCode: 2 as const, output: opencodeError };
    }
  }
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
    readonly opencodeDbPaths?: readonly string[];
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
  return yield* queryRecall(
    paths,
    options.root ?? `${context.home}/.dsh/sessions`,
    {
      keywords,
      project: normalizeProject(options.project ?? context.cwd, "home"),
      peers: options.peers ?? [],
      harness: options.harness as RecallHarness | "all" | undefined,
      topN: options.topN,
      now: options.now,
      opencodeDbPaths: options.opencodeDbPaths,
    },
    context.home,
  );
});

export const recallCrossRecall = Effect.fn("recallCrossRecall")(function* (
  context: CliContext,
  sessionId: string,
  seq: number | null,
  root: string | null,
  now: number,
  opencodeDbPaths?: readonly string[],
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
    context.home,
    opencodeDbPaths,
  );
});
