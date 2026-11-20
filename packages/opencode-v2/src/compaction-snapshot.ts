// Per-session compaction snapshot: the lossless counterpart of the compiled
// checkpoint. Stores cleaned raw request messages (full text, reasoning, raw
// tool-call input, full tool-result values) so `operator-recall` and
// `operator-search` can restore exactly what a checkpoint elided or
// truncated. Faithful logic port of the port repo's `snapshot.mjs` (itself
// derived from dsh-compaction-vcc@0.7.4): seq assignment goes through the
// same `toCompilerNode` filter as the checkpoint header, so recall seqs are
// by construction identical to checkpoint `(seq N)` pointers.
//
// Deliberate deviations from the port source:
// - Storage is a per-session JSON file under the adapter state directory
//   (`context-snapshot/<sessionID>.json`), not host `ctx.storage`: this
//   adapter persists through the filesystem like receipts and omissions.
// - Writes are maintained per turn by the context hook (growth-guarded by
//   version/count/lastID, best-effort file write); the compaction hook
//   refreshes unconditionally — the guard makes an unchanged conversation
//   a no-op, and the refresh heals a failed per-turn write at the moment
//   freshness matters most (deliberately stricter than the oracle's
//   seen-presence skip, which would freeze such staleness in). The
//   oracle's >1MB warn tripwire has no console here, so the constant is
//   kept for observability and the write still lands.
// - Surface is agent tools (`operator-recall`, `operator-search`), not slash
//   commands: the checkpoint guide promises agent-callable recovery, and
//   tools follow the `operator-read_omitted` precedent. No status formatter:
//   the file itself is the status.
// - No `console` output anywhere: failures resolve through Result, never warn.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DEFAULT_MAX_RECALL_TOKENS,
  recallSession,
  resolveRecallReference,
  type RecallBlock,
  type RecallMessage,
  type RecallResult,
  type SeqSelection,
} from "@aerovato/operator-core/context/recall";
import {
  DEFAULT_MAX_SEARCH_HITS,
  searchSession,
  type SearchResult,
} from "@aerovato/operator-core/context/search";
import { isSafePathSegment } from "@aerovato/operator-core/context/store";
import { failure, isRecord, type Result, success } from "@aerovato/operator-core/utils";

import {
  mediaLabel,
  projectResultValue,
  stringifyToolInput,
  toCompilerNode,
} from "./compaction-compiler.ts";

export const SNAPSHOT_VERSION = 1;

// Tripwire for write amplification: one full-envelope rewrite per compaction.
// Kept from the port for observability; the write path does not warn.
export const MAX_SNAPSHOT_WRITE_BYTES = 1000000;

export type CleanedPart = {
  readonly type: string;
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
  readonly result?: unknown;
  readonly mediaType?: string;
};

export type CleanedMessage = {
  readonly id?: string;
  readonly role: string;
  readonly content: readonly (CleanedPart | null)[];
};

export type SnapshotEnvelope = {
  readonly version: number;
  readonly messages: CleanedMessage[];
  readonly count: number;
  readonly lastID?: string;
  readonly writtenAt: string;
};

export type SnapshotError = {
  readonly path: string;
  readonly cause: unknown;
};

export type SnapshotEvent = {
  readonly seq: number;
  readonly type: string;
  readonly data: {
    readonly message?: CleanedMessage;
    readonly source?: { readonly kind: string };
  };
};

// Strip one content part to its storable core. Transport bloat (`cache`,
// `metadata`, `providerMetadata`) and media bytes are dropped (recall
// renders media as labels anyway); unknown future part types are label-only.
export function cleanPart(part: unknown): CleanedPart | null {
  if (part === null || part === undefined) return null;
  if (!isRecord(part) || typeof part.type !== "string") return null;
  switch (part.type) {
    case "text":
      return { type: "text", text: typeof part.text === "string" ? part.text : "" };
    case "reasoning":
      return { type: "reasoning", text: typeof part.text === "string" ? part.text : "" };
    case "tool-call":
      return {
        type: "tool-call",
        id: typeof part.id === "string" ? part.id : "",
        name: typeof part.name === "string" ? part.name : "unknown",
        ...(part.input === undefined ? {} : { input: part.input }),
      };
    case "tool-result":
      return {
        type: "tool-result",
        id: typeof part.id === "string" ? part.id : "",
        name: typeof part.name === "string" ? part.name : "unknown",
        result: part.result ?? null,
      };
    case "media": {
      const mime = isRecord(part.media) ? (part.media.mediaType ?? part.media.mime) : undefined;
      return {
        type: "media",
        mediaType: typeof mime === "string" ? mime : "",
      };
    }
    case "compaction":
      return typeof part.text === "string" && part.text.length > 0
        ? { type: "compaction", text: part.text }
        : null;
    case "effort":
      return null;
    default:
      return { type: String(part.type) };
  }
}

// Strip one request message to its storable core. System role and
// empty/invalid content are dropped (never compiled, never sequenced); every
// other shell is kept even when empty so seqs still align with the compile
// side.
export function cleanMessage(message: unknown): CleanedMessage | null {
  if (!isRecord(message)) return null;
  const content = message.content;
  if (!Array.isArray(content)) return null;
  if (message.role === "system") return null;
  const id = typeof message.id === "string" && message.id !== "" ? message.id : undefined;
  if (message.role === "assistant") {
    const live = content.filter(block => block !== null && block !== undefined);
    if (live.length === 1) {
      const only = live[0];
      if (isRecord(only) && only.type === "compaction") {
        const text = only.text;
        if (typeof text !== "string" || text.length === 0) return null;
        return {
          ...(id === undefined ? {} : { id }),
          role: "assistant",
          content: [{ type: "compaction", text }],
        };
      }
    }
  }
  const cleaned: CleanedPart[] = [];
  for (const part of content) {
    const kept = cleanPart(part);
    if (kept !== null) cleaned.push(kept);
  }
  const role = message.role;
  if (role !== "user" && role !== "assistant" && role !== "tool") return null;
  return {
    ...(id === undefined ? {} : { id }),
    role,
    content: cleaned,
  };
}

// Build a snapshot from request messages, oldest first.
export function buildSnapshot(messages: readonly unknown[]): Omit<SnapshotEnvelope, "writtenAt"> {
  const list = Array.isArray(messages) ? messages : [];
  const cleaned: CleanedMessage[] = [];
  for (const message of list) {
    const kept = cleanMessage(message);
    if (kept !== null) cleaned.push(kept);
  }
  let lastID: string | undefined;
  for (let index = cleaned.length - 1; index >= 0; index -= 1) {
    const id = cleaned[index]?.id;
    if (typeof id === "string" && id !== "") {
      lastID = id;
      break;
    }
  }
  return {
    version: SNAPSHOT_VERSION,
    messages: cleaned,
    count: cleaned.length,
    ...(lastID === undefined ? {} : { lastID }),
  };
}

// Decide whether a snapshot write is needed (growth guard). The context
// hook maintains the snapshot per turn through `rememberSnapshot`; this
// stays exported for tests.
export function snapshotNeedsWrite(
  previous:
    | { readonly version?: number; readonly count?: number; readonly lastID?: string }
    | null
    | undefined,
  next: { readonly version: number; readonly count: number; readonly lastID?: string },
): boolean {
  if (previous === null || previous === undefined) return true;
  if ((previous.version ?? SNAPSHOT_VERSION) !== next.version) return true;
  if (next.count !== previous.count) return true;
  return next.lastID !== previous.lastID;
}

// Estimate the serialized size of a snapshot envelope in chars. Returns 0
// for unserializable input (never trips; the write path fails the same way
// on any unserializable envelope).
export function snapshotWriteBytes(envelope: unknown): number {
  try {
    const text = JSON.stringify(envelope);
    return typeof text === "string" ? text.length : 0;
  } catch {
    return 0;
  }
}

// Growth-guard state for per-turn snapshot maintenance: the last
// successfully written snapshot's identity. The session runtime holds one
// per session; the compaction hook treats non-null as proof the context
// hook already covers the session.
export type SnapshotSeen = {
  readonly version: number;
  readonly count: number;
  readonly lastID?: string;
};

// Per-turn snapshot maintenance shared by the context hook (every request)
// and the compaction hook (fallback when no context-hook snapshot exists
// for the session yet). Growth-guarded: an unchanged conversation (same
// version/count/lastID as `prev`) skips the rewrite, so idle turns cost no
// I/O. Best-effort and never throws: every failure resolves to unwritten
// with the previous seen state kept, so the next turn retries.
export async function rememberSnapshot(
  root: string,
  sessionID: string,
  messages: readonly unknown[],
  at: string,
  prev: SnapshotSeen | null | undefined,
): Promise<{ readonly wrote: boolean; readonly seen: SnapshotSeen | null }> {
  const kept = prev ?? null;
  try {
    const snap = buildSnapshot(messages);
    if (!snapshotNeedsWrite(kept, snap)) {
      return { wrote: false, seen: kept };
    }
    const written = await writeCompactionSnapshot(root, sessionID, messages, at);
    if (!written.ok) {
      return { wrote: false, seen: kept };
    }
    return {
      wrote: true,
      seen: {
        version: snap.version,
        count: snap.count,
        ...(snap.lastID === undefined ? {} : { lastID: snap.lastID }),
      },
    };
  } catch {
    return { wrote: false, seen: kept };
  }
}

function snapshotPath(root: string, sessionID: string): string {
  return join(root, `${sessionID}.json`);
}

// Persist one compaction snapshot. Best-effort: callers treat a failure as a
// missing snapshot (tools reply that recall is unavailable), never as fatal.
export async function writeCompactionSnapshot(
  root: string,
  sessionID: string,
  messages: readonly unknown[],
  at: string,
): Promise<Result<void, SnapshotError>> {
  const path = snapshotPath(root, sessionID);
  if (!isSafePathSegment(sessionID)) {
    return failure({ path, cause: new Error("Unsafe path segment") });
  }
  const envelope: SnapshotEnvelope = { ...buildSnapshot(messages), writtenAt: at };
  try {
    await mkdir(root, { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(envelope)}\n`, "utf8");
    await rename(tmp, path);
  } catch (cause) {
    return failure({ path, cause });
  }
  return success(undefined);
}

export async function readCompactionSnapshot(
  root: string,
  sessionID: string,
): Promise<Result<SnapshotEnvelope | null, SnapshotError>> {
  const path = snapshotPath(root, sessionID);
  if (!isSafePathSegment(sessionID)) {
    return failure({ path, cause: new Error("Unsafe path segment") });
  }
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    if (isRecord(cause) && (cause as { code?: unknown }).code === "ENOENT") return success(null);
    return failure({ path, cause });
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.messages)) return success(null);
    return success(parsed as SnapshotEnvelope);
  } catch (cause) {
    return failure({ path, cause });
  }
}

// Map one cleaned part to a recall block. Never drops: unknown types render
// as labels.
function recallBlock(part: CleanedPart): RecallBlock {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text ?? "" };
    case "reasoning":
      return { type: "reasoning", text: part.text ?? "" };
    case "tool-call":
      return {
        type: "tool-call",
        name: part.name ?? "unknown",
        arguments: stringifyToolInput(part.input),
      };
    case "tool-result": {
      const result = part.result;
      if (isRecord(result) && result.type === "content" && Array.isArray(result.value)) {
        const content = [];
        for (const block of result.value) {
          if (block === null || block === undefined) continue;
          if (!isRecord(block)) continue;
          if (block.type === "text")
            content.push({ type: "text", text: typeof block.text === "string" ? block.text : "" });
          else if (block.type === "file") {
            const name = block.name;
            const uri = block.uri;
            content.push({
              type: "text",
              text: `[file ${typeof name === "string" ? name : typeof uri === "string" ? uri : "attachment"}]`,
            });
          } else content.push({ type: String(block.type) });
        }
        return { type: "tool-result", content };
      }
      return { type: "tool-result", content: [{ type: "text", text: projectResultValue(result) }] };
    }
    case "media":
      return { type: mediaLabel({ mediaType: part.mediaType }) };
    case "compaction":
      return { type: "text", text: part.text ?? "" };
    default:
      return { type: String(part.type) };
  }
}

// Project one cleaned message to a recall message (`deriveEventMessage`
// output). A lone compaction block re-enters as plain text (its checkpoint
// nature is recorded on the event, not the message).
export function snapshotMessageToRecall(message: CleanedMessage): RecallMessage {
  const content = Array.isArray(message?.content) ? message.content : [];
  if (message?.role === "assistant" && content.length === 1 && content[0]?.type === "compaction") {
    return { role: "user", content: [{ type: "text", text: content[0]?.text ?? "" }] };
  }
  const blocks: RecallBlock[] = [];
  for (const part of content) {
    if (part === null || part === undefined || typeof part.type !== "string") continue;
    blocks.push(recallBlock(part));
  }
  return { role: message?.role ?? "user", content: blocks };
}

// Build the session-shaped event list from cleaned messages. Seq assignment
// goes through `toCompilerNode` directly on the cleaned messages (same
// filter + 1-based ordinals as checkpoints); payloads stay lossless cleaned
// raw.
export function toSnapshotEvents(messages: readonly CleanedMessage[]): SnapshotEvent[] {
  const list = Array.isArray(messages) ? messages : [];
  const events: SnapshotEvent[] = [];
  for (const cleaned of list) {
    if (cleaned === null || cleaned === undefined || !Array.isArray(cleaned.content)) continue;
    const node = toCompilerNode(cleaned, events.length + 1);
    if (node === null) continue;
    const isCheckpoint =
      node.message?.role === "user" && node.message?.source?.kind === "compact-checkpoint";
    const type = isCheckpoint
      ? "user/message"
      : cleaned.role === "user"
        ? "user/message"
        : cleaned.role === "tool"
          ? "tool/result"
          : "assistant/message";
    events.push({
      seq: node.seq,
      type,
      data: {
        message: cleaned,
        ...(isCheckpoint ? { source: { kind: "compact-checkpoint" } } : {}),
      },
    });
  }
  return events;
}

// The session-shaped value the recall/search cores read: snapshot access
// plus message projection.
export function makeSnapshotSession(messages: readonly CleanedMessage[]): {
  readonly snapshotEvents: () => readonly SnapshotEvent[];
  readonly eventAt: (seq: number) => SnapshotEvent | undefined;
  readonly events: readonly SnapshotEvent[];
  readonly deriveEventMessage: (event: SnapshotEvent) => RecallMessage | null;
} {
  const events = toSnapshotEvents(messages);
  const frozen = Object.freeze(events.slice());
  const bySeq = new Map(frozen.map(event => [event.seq, event]));
  return {
    snapshotEvents() {
      return frozen;
    },
    eventAt(seq: number) {
      return bySeq.get(seq);
    },
    get events() {
      return frozen;
    },
    deriveEventMessage(event: SnapshotEvent) {
      const cleaned = event?.data?.message;
      if (cleaned === null || cleaned === undefined) return null;
      return snapshotMessageToRecall(cleaned);
    },
  };
}

// Resolve a parsed recall reference against snapshot messages. Thin wrapper
// over the core resolver so tool wiring imports only this module.
export function resolveRecallSelections(
  messages: readonly CleanedMessage[],
  type: string,
  id: string,
): { readonly selections: readonly SeqSelection[]; readonly errors: readonly string[] } {
  return resolveRecallReference(makeSnapshotSession(messages), type, id);
}

// Recall full original content for parsed selections from a snapshot.
export function recallFromSnapshot(
  messages: readonly CleanedMessage[],
  selections: readonly SeqSelection[],
  maxRecallTokens: number = DEFAULT_MAX_RECALL_TOKENS,
): RecallResult {
  const budget =
    typeof maxRecallTokens === "number" && Number.isFinite(maxRecallTokens) && maxRecallTokens > 0
      ? maxRecallTokens
      : DEFAULT_MAX_RECALL_TOKENS;
  return recallSession(makeSnapshotSession(messages), selections, { maxRecallTokens: budget });
}

// Search a snapshot for a pattern: pad a dummy seq-0 entry so the core's
// verbatim positional scan (`events[seq]`, `event.seq === seq`) holds for
// 1-based seqs, then drop any phantom hit and rebuild the summary around
// the live hits.
export function searchSnapshot(
  messages: readonly CleanedMessage[],
  patternSource: string,
  config: { readonly maxSearchHits?: number; readonly maxRecallTokens?: number } = {},
): SearchResult {
  const input = config !== null && typeof config === "object" ? config : {};
  const maxSearchHits =
    typeof input.maxSearchHits === "number"
    && Number.isFinite(input.maxSearchHits)
    && input.maxSearchHits > 0
      ? Math.floor(input.maxSearchHits)
      : DEFAULT_MAX_SEARCH_HITS;
  const maxRecallTokens =
    typeof input.maxRecallTokens === "number"
    && Number.isFinite(input.maxRecallTokens)
    && input.maxRecallTokens > 0
      ? input.maxRecallTokens
      : DEFAULT_MAX_RECALL_TOKENS;
  const inner = makeSnapshotSession(messages);
  const live = inner.snapshotEvents();
  const padded: readonly SnapshotEvent[] = [{ seq: 0, type: "session.created", data: {} }, ...live];
  const paddedSession = {
    snapshotEvents() {
      return padded;
    },
    eventAt(seq: number) {
      if (seq === 0) return padded[0];
      return inner.eventAt(seq);
    },
    get events() {
      return padded;
    },
    deriveEventMessage(event: SnapshotEvent) {
      if (event?.seq === 0) return null;
      return inner.deriveEventMessage(event);
    },
  };
  const out = searchSession(paddedSession, patternSource, { maxSearchHits, maxRecallTokens });
  // The seq-0 pad satisfies the verbatim positional scan but must never
  // surface: seq 0 is unrecallable, so drop any phantom hit and rebuild the
  // summary around the live hits.
  const hits = out.hits.filter(hit => hit.seq !== 0);
  const dropped = out.hits.length - hits.length;
  const totalMatches = out.totalMatches - dropped;
  const omitted = Math.max(0, totalMatches - hits.length);
  const lines = [
    `[search "${out.pattern}": ${totalMatches} matching event(s)]`,
    ...hits.map(hit => hit.text),
    ...(omitted > 0
      ? [`[${omitted} more matching event(s) omitted — narrow the pattern or use recall]`]
      : []),
    ...(out.truncated ? ["[search budget exhausted; some hits were cut]"] : []),
  ];
  if (hits.length > 0)
    lines.push("[use recall with a (seq N) pointer to restore any hit's full original content]");
  return {
    ...out,
    totalMatches,
    hits,
    omitted,
    text: lines.join("\n\n"),
  };
}

// Format a recall tool reply (header + recalled text).
export function formatRecallReply(type: string, id: string, recalled: RecallResult): string {
  const label =
    `**operator-recall ${type} ${id}** (${recalled.seqs.length} event(s), ${recalled.tokens} tokens`
    + `${recalled.missing > 0 ? `, ${recalled.missing} missing` : ""}`
    + `${recalled.truncated ? ", budget-truncated" : ""})`;
  return `${label}\n\n${recalled.text}`;
}

// Format a search tool reply (header + search text).
export function formatSearchReply(pattern: string, found: SearchResult): string {
  return `**operator-search ${pattern}** (${found.totalMatches} matching event(s))\n\n${found.text}`;
}

// Classify a snapshot read for tool wiring: read-failure vs empty vs ready
// never diverge per tool.
export function classifySnapshotStore(
  read: Result<SnapshotEnvelope | null, SnapshotError>,
):
  | { readonly status: "failed" }
  | { readonly status: "empty" }
  | { readonly status: "ready"; readonly messages: readonly CleanedMessage[] } {
  if (!read.ok) return { status: "failed" };
  const messages = read.value?.messages;
  if (read.value === null || !Array.isArray(messages) || messages.length === 0) {
    return { status: "empty" };
  }
  return { status: "ready", messages };
}
