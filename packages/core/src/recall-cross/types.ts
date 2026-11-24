// Cross-session recall core types: the frozen interface every downstream step
// (helper ingest/index/query, adapter tools) depends on. Harness-agnostic:
// DSH and OpenCode rows converge to `SessionRecord` at ingest, and every
// consumer below the helper boundary speaks only these shapes.

export type RecallHarness = "dsh" | "opencode";

// One indexed turn. `pointer` is an opaque per-harness string the helper
// resolves back to full text; `howToPull` is the human-readable fetch path.
// Stored session ids are harness-prefixed (`dsh:<uuid>`,
// `opencode:<sessionId>`) so forget identity is never ambiguous. `kind`
// records which side spoke so the renderer can attribute excerpts.
export type SessionRecord = {
  readonly harness: RecallHarness;
  readonly sessionId: string;
  readonly project: string;
  readonly timestamp: number;
  readonly seq: number;
  readonly kind: "user" | "assistant" | "tool";
  readonly text: string;
  readonly pointer: string;
  readonly howToPull: string;
};

// Scope travels with the query, passed by the caller. Peer-list persistence
// (where a project declares its mutual peers) stays deferred; the shape the
// ranker consumes freezes here.
export type RecallScope = {
  readonly project: string;
  readonly peers: readonly string[];
};

export type RecallQuery = {
  readonly keywords: readonly string[];
  readonly scope: RecallScope;
  readonly harness?: RecallHarness | "all";
  readonly topN?: number;
};

export type RecallHit = {
  readonly record: SessionRecord;
  readonly score: number;
  readonly excerpt: string;
};
