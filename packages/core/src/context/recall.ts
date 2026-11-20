// Same-session recall core, the lossless counterpart of the compiler:
// checkpoint `(seq N)` pointers expand back into exact original content from
// the append-only log. Faithful logic port of the port repo's `recall.mjs`
// (itself ported from dsh-compaction-vcc@0.7.4 `src/recall.js`). Oracle
// vectors live in `recall.test.ts`, captured from the original (port selftest
// run 2026-11-19).
//
// Deliberate deviation: `deriveEventMessage` access is guarded with `isRecord`
// instead of bare property reads, so non-object sessions return the log-only
// rendering instead of throwing. The deriver is invoked receiver-preserving
// (Reflect.apply): the host exposes it as a prototype method over instance
// state, so a detached call throws on `this`.

import {
  estimateEntryTokens,
  isCheckpointSource,
  projectToolResultText,
  sanitize,
  truncateTokens,
  type MessageSource,
} from "./compiler.ts";
import { isRecord } from "../utils.ts";
import { sessionEventAt, sessionEvents } from "./session-compat.ts";

// Total budget for one recall operation, in density-aware tokens.
export const DEFAULT_MAX_RECALL_TOKENS = 16000;
// Widest single range accepted from one selection, bounding expansion work.
export const MAX_RECALL_SPAN = 1000;

export type SeqSelection = {
  readonly start: number;
  readonly end: number;
};

export type SeqParseResult = {
  readonly selections: SeqSelection[];
  readonly errors: string[];
};

// One block of a recall-projected message. Recall is the lossless layer, so
// blocks carry full text, reasoning, raw tool-call arguments, and nested
// tool-result content; only media renders as labels.
export type RecallBlock = {
  readonly type?: string;
  readonly text?: string;
  readonly name?: string;
  readonly arguments?: string;
  readonly content?: readonly unknown[];
};

export type RecallMessage = {
  readonly role: string;
  readonly content: readonly (RecallBlock | null)[] | null;
};

export type RecallEntry = {
  readonly seq: number;
  readonly text: string;
  readonly truncated?: boolean;
};

export type RecallConfig = {
  readonly maxRecallTokens: number;
};

export type RecallResult = {
  readonly text: string;
  readonly entries: RecallEntry[];
  readonly seqs: number[];
  readonly recalled: number;
  readonly missing: number;
  readonly skipped: number;
  readonly truncated: boolean;
  readonly tokens: number;
};

// Parse one seq selection string into ordered inclusive ranges. Accepted
// forms per comma-separated part: `12`, `3-7`, `seq 12`, `seqs 3-7`, with
// optional surrounding parentheses — so a model or human can paste a
// checkpoint marker verbatim.
export function parseSeqSpec(input: unknown): SeqParseResult {
  const selections: SeqSelection[] = [];
  const errors: string[] = [];
  const raw = String(input ?? "").trim();
  if (raw.length === 0) return { selections, errors: ["missing seq selection"] };
  for (const part of raw.split(",")) {
    let token = part.trim();
    if (token.length === 0) continue;
    token = token.replace(/^\((.*)\)$/u, "$1").trim();
    const match = /^(?:seqs?\s+)?(\d+)(?:\s*-\s*(\d+))?$/iu.exec(token);
    if (match === null) {
      errors.push(`invalid seq selection "${part}"`);
      continue;
    }
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    // Rejects anything outside the safe-integer range BEFORE any arithmetic:
    // a seq at or above 2^53 makes `seq += 1` a no-op in IEEE-754, so the
    // expansion loop below never terminates and freezes the host
    // synchronously. Both bounds are checked because an out-of-range `end`
    // only needs the loop guard to be true.
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      errors.push(`seq selection "${part}" is outside the safe integer range`);
      continue;
    }
    if (start < 1) {
      errors.push(`invalid seq selection "${part}" (seq starts at 1)`);
      continue;
    }
    if (end < start) {
      errors.push(`invalid seq range "${part}" (end before start)`);
      continue;
    }
    if (end - start + 1 > MAX_RECALL_SPAN) {
      errors.push(`seq range "${part}" is wider than the ${MAX_RECALL_SPAN}-seq limit`);
      continue;
    }
    selections.push({ start, end });
  }
  return { selections, errors };
}

// Project one derived message into plain text, keeping everything: text,
// reasoning, raw tool-call arguments, and nested tool-result content. Media
// renders as labels (their bytes live in the attachment service).
export function projectMessageText(message: RecallMessage): string {
  const parts: string[] = [];
  const content = message.content ?? [];
  for (const block of content) {
    if (block === null || block === undefined) continue;
    switch (block.type) {
      case "text":
        if (block.text !== undefined && block.text.length > 0) parts.push(sanitize(block.text));
        break;
      case "reasoning":
        if (block.text !== undefined && block.text.length > 0) {
          parts.push(`[reasoning]\n${sanitize(block.text)}`);
        }
        break;
      case "tool-call":
        parts.push(`[tool-call ${block.name ?? "unknown"}]\n${sanitize(block.arguments ?? "")}`);
        break;
      case "tool-result":
        parts.push(`[tool-result]\n${projectToolResultText(block.content ?? [])}`);
        break;
      case "image":
        parts.push("[image]");
        break;
      case "document":
        parts.push("[document]");
        break;
      default:
        parts.push(`[${String(block.type)}]`);
    }
  }
  return parts.join("\n");
}

// Expand ordered selections into a deduplicated ordered seq list.
export function expandSelections(selections: readonly SeqSelection[]): number[] {
  const seqs: number[] = [];
  const seen = new Set<number>();
  for (const selection of selections) {
    const start = selection?.start;
    const end = selection?.end;
    // Defensive guard: `parseSeqSpec` already rejects unsafe integers, but
    // this function is exported and reachable with a hand-built selection
    // array. Without the guard, `seq += 1` at 2^53 is a no-op and the loop
    // below never terminates (synchronous host freeze). Skipping the range
    // is the only safe failure mode.
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) continue;
    if (start === undefined || end === undefined) continue;
    for (let seq = start; seq <= end; seq += 1) {
      if (seen.has(seq)) continue;
      seen.add(seq);
      seqs.push(seq);
    }
  }
  return seqs;
}

// The structured `source` of a session event's data, or undefined when the
// event carries none. Guards through isRecord so foreign sessions cannot
// throw the lookup.
function eventSource(event: { readonly data?: unknown }): MessageSource {
  if (!isRecord(event.data)) return undefined;
  const source = event.data.source;
  return isRecord(source) ? source : undefined;
}

// Collect the durable seqs of every landed compaction checkpoint node in one
// session, oldest first. Each compaction replaces its span with exactly one
// checkpoint node, so the ordinal (`1` = oldest) counts compactions.
export function findCheckpointSeqs(session: unknown): number[] {
  const seqs: number[] = [];
  for (const event of sessionEvents(session)) {
    if (event.type === "user/message" && isCheckpointSource(eventSource(event))) {
      seqs.push(event.seq);
    }
  }
  return seqs;
}

// Derive the display message for one session event through the host's own
// accessor, validating the result shape. Shared by recall and search so both
// read the log the same way. Sessions without the accessor yield null, and
// the caller falls back to the raw data payload.
export function deriveSessionMessage(
  session: unknown,
  event: { readonly seq: number; readonly type: string; readonly data?: unknown },
): RecallMessage | null {
  if (!isRecord(session)) return null;
  const derive = session.deriveEventMessage;
  if (typeof derive !== "function") return null;
  // Receiver-preserving call: the host exposes this as a prototype method
  // over instance state, so a detached call throws on `this`.
  const message = Reflect.apply(derive as (event: unknown) => unknown, session, [event]);
  if (!isRecord(message)) return null;
  const role = message.role;
  const content = message.content;
  if (typeof role !== "string" || !Array.isArray(content)) return null;
  return { role, content: content as readonly (RecallBlock | null)[] };
}

// Resolve one typed recall reference into inclusive seq ranges:
// `seq` takes a seq selection; `result` names a tool result via the
// `result N` pointer on a tool-call one-liner; `checkpoint` takes an ordinal
// (`1` = oldest, as in the `[checkpoint N]` elision marker) or a `seq N`
// pointer to a checkpoint node.
export function resolveRecallReference(
  session: unknown,
  type: string,
  id: unknown,
): SeqParseResult {
  const raw = String(id ?? "").trim();
  if (type === "seq") return parseSeqSpec(raw);
  if (type === "result") {
    const token = raw
      .replace(/^\((.*)\)$/u, "$1")
      .trim()
      .replace(/^result\s+/iu, "");
    const match = /^(\d+)$/u.exec(token);
    if (match === null) {
      return {
        selections: [],
        errors: [`invalid result reference "${id}" (expected a seq like "3" or "result 3")`],
      };
    }
    const seq = Number(match[1]);
    const event = sessionEventAt(session, seq);
    if (event === undefined || event.seq !== seq) {
      return { selections: [], errors: [`result seq ${seq} not found in this session`] };
    }
    if (event.type !== "tool/result") {
      return { selections: [], errors: [`seq ${seq} is not a tool result (it is ${event.type})`] };
    }
    return { selections: [{ start: seq, end: seq }], errors: [] };
  }
  if (type === "checkpoint") {
    const token = raw.replace(/^\((.*)\)$/u, "$1").trim();
    const bySeq = /^seqs?\s+(\d+)$/iu.exec(token);
    if (bySeq !== null) {
      const seq = Number(bySeq[1]);
      const event = sessionEventAt(session, seq);
      if (event === undefined || event.seq !== seq) {
        return { selections: [], errors: [`checkpoint seq ${seq} not found in this session`] };
      }
      if (!isCheckpointSource(eventSource(event))) {
        return { selections: [], errors: [`seq ${seq} is not a checkpoint node`] };
      }
      return { selections: [{ start: seq, end: seq }], errors: [] };
    }
    const ordinal = token.replace(/^checkpoint\s+/iu, "");
    const match = /^(\d+)$/u.exec(ordinal);
    if (match === null) {
      return {
        selections: [],
        errors: [
          `invalid checkpoint reference "${id}" (expected an ordinal like "1" or "checkpoint 1", or a "seq N" pointer)`,
        ],
      };
    }
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 1) {
      return { selections: [], errors: [`invalid checkpoint ordinal "${id}"`] };
    }
    const checkpointSeqs = findCheckpointSeqs(session);
    const seq = checkpointSeqs[index - 1];
    if (seq === undefined) {
      return {
        selections: [],
        errors: [
          `checkpoint ${index} not found (this session has ${checkpointSeqs.length} checkpoint(s))`,
        ],
      };
    }
    return { selections: [{ start: seq, end: seq }], errors: [] };
  }
  return {
    selections: [],
    errors: [`invalid recall type "${String(type)}" (expected "seq", "result", or "checkpoint")`],
  };
}

// Recall the full original content of the requested seqs from one session's
// durable log. Message events project through `deriveEventMessage`; log-only
// events render as a labeled data dump. The total output is bounded by
// `maxRecallTokens`; a cut appends a provenance marker and remaining
// requested seqs are accounted in `skipped`.
export function recallSession(
  session: unknown,
  selections: readonly SeqSelection[],
  config: RecallConfig,
): RecallResult {
  const maxRecallTokens = config.maxRecallTokens;
  const requested = expandSelections(selections);
  const entries: RecallEntry[] = [];
  const seqs: number[] = [];
  let budget = maxRecallTokens;
  let truncated = false;
  let missing = 0;
  let skipped = 0;
  for (let index = 0; index < requested.length; index += 1) {
    const seq = requested[index];
    if (seq === undefined) continue;
    if (budget <= 0) {
      skipped = requested.length - index;
      truncated = true;
      break;
    }
    const event = sessionEventAt(session, seq);
    if (event === undefined || event.seq !== seq) {
      missing += 1;
      entries.push({ seq, text: `[seq ${seq}: not found in this session]` });
      continue;
    }
    const message = deriveSessionMessage(session, event);
    const body =
      message !== null
        ? `[seq ${seq}: ${message.role}]\n${projectMessageText(message)}`
        : `[seq ${seq}: ${event.type}]\n${JSON.stringify(event.data ?? null).slice(0, maxRecallTokens * 4)}`;
    const kept = truncateTokens(body, budget, "recall budget");
    budget -= estimateEntryTokens(kept.text);
    if (kept.truncated) truncated = true;
    entries.push({ seq, text: kept.text, truncated: kept.truncated });
    seqs.push(seq);
  }
  if (skipped > 0) {
    const firstSkipped = requested[requested.length - skipped];
    entries.push({
      seq: firstSkipped ?? 0,
      text: `[recall budget exhausted: ${skipped} further requested seq(s) not included]`,
    });
  }
  return {
    text: entries.map(entry => entry.text).join("\n\n"),
    entries,
    seqs,
    recalled: seqs.length,
    missing,
    skipped,
    truncated,
    tokens: entries.reduce((total, entry) => total + estimateEntryTokens(entry.text), 0),
  };
}
