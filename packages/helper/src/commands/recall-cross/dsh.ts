import { Buffer } from "node:buffer";
import { zstdDecompressSync } from "node:zlib";

import { RECALL_CROSS_EXCERPT_HEADER } from "@jwitmann/vcc-brain-core/recall-cross/ranking";
import type { SessionRecord } from "@jwitmann/vcc-brain-core/recall-cross/types";
import { Data, Effect, FileSystem, type Path } from "effect";

import { listFiles } from "../../filesystem.ts";
import { isRecord } from "../../utils.ts";

// DSH session ingest (Step 2). Reads `session.v4.jsonl.zstd` files under a
// sessions root, decompresses with the `node:zlib` stdlib, and converges
// user/assistant text turns to the shared `SessionRecord` shape. Runs only in
// the helper CLI process (node); adapters never import this module.
// Shape notes (verified against live sessions 2026-11-24): two directory
// layouts (`<slug>/<uuid>/` and `<slug>/session-<uuid>/`), two
// `user/message` envelopes (`{role, content}` and `{content, source, id}`),
// `assistant/message` text buried in `data.message.content` items, tool
// traffic in `tool/call` + `tool/result` records, titles in `session/title`
// or `title` records (latest wins).

const SESSION_LOG_NAME = "session.v4.jsonl.zstd";
const SESSION_FORMAT_VERSION = 4;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const NO_RECALL_TITLE = "[no-recall]";

// Adapter tool traffic that must never re-enter the index (self-pollution
// guard). Matches the tool names registered in `packages/deepseek/src/tool.ts`.
const RECALL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "vcc-brain-search-sessions",
  "vcc-brain-recall-session",
]);

export class DshSessionError extends Data.TaggedError("DshSessionError")<{
  readonly file: string;
  readonly reason: "no-header" | "unsupported-version" | "no-zstd-frames" | "undecodable";
}> {}

export type DshFileIngest = {
  readonly records: readonly SessionRecord[];
  readonly turnsSkipped: number;
  readonly corruptLines: number;
  readonly partial: boolean;
};

export type DshFileSkip = {
  readonly file: string;
  readonly reason: string;
};

export type DshIngestSummary = {
  readonly records: readonly SessionRecord[];
  readonly filesRead: number;
  readonly filesSkipped: readonly DshFileSkip[];
  readonly turnsSkipped: number;
  readonly corruptLines: number;
};

type CandidateTurn = {
  readonly seq: number;
  readonly time: number;
  readonly kind: "user" | "assistant" | "tool";
  readonly text: string;
  readonly resultCallId: string | null;
};

// Split multi-frame zstd on the frame magic and decode frame by frame.
// All-or-nothing per file: any undecodable frame excludes the whole file
// (zero rows, loudly reported). A magic sequence can occur naturally inside
// a frame's payload, so a failed segment retries merged with its successor:
// a false split recovers intact, genuine corruption fails again.
export function decodeZstdFrames(data: Uint8Array): {
  readonly text: string;
  readonly frames: number;
  readonly decoded: number;
  readonly corrupt: boolean;
} {
  const buf = Buffer.from(data);
  const starts: number[] = [];
  let from = 0;
  for (;;) {
    const at = buf.indexOf(ZSTD_MAGIC, from);
    if (at < 0) {
      break;
    }
    starts.push(at);
    from = at + ZSTD_MAGIC.length;
  }
  let text = "";
  let decoded = 0;
  let corrupt = false;
  let index = 0;
  while (index < starts.length) {
    const start = starts[index];
    const end = index + 1 < starts.length ? starts[index + 1] : buf.length;
    try {
      text += zstdDecompressSync(buf.subarray(start, end)).toString("utf8");
      decoded += 1;
      index += 1;
    } catch {
      // A magic sequence can occur naturally inside a frame's payload,
      // splitting one true frame into two undecodable halves. Retry the
      // segment merged with its successor: a false split recovers as the
      // intact frame, while genuine corruption fails again and both skip.
      const mergedEnd = index + 2 < starts.length ? starts[index + 2] : buf.length;
      if (index + 1 < starts.length) {
        try {
          text += zstdDecompressSync(buf.subarray(start, mergedEnd)).toString("utf8");
          // Merged retry consumed two split segments' worth of bytes.
          decoded += 2;
          index += 2;
          continue;
        } catch {
          // Genuinely corrupt: the whole file is excluded below.
          corrupt = true;
        }
      } else {
        corrupt = true;
      }
      index += 1;
    }
  }
  return { text, frames: starts.length, decoded, corrupt };
}

// Join the `{type: "text", text}` items of a message content array.
// Non-text items (reasoning, tool calls, media) never enter the index.
function joinTextItems(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const item of content) {
    if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.join("\n");
}

// Project identity is the `cwd` basename (never a raw absolute path: the
// same checkout under different roots must key one identity), falling back
// to the directory slug when no `cwd` is recorded. Peer-declared aliases
// stay deferred; this normalization is the key the alias map will rewrite.
export function normalizeProject(cwd: string | null, slug: string): string {
  if (cwd === null || cwd.trim() === "") {
    return slug;
  }
  const parts = cwd.split("/").filter(part => part !== "");
  return parts.length > 0 ? (parts[parts.length - 1] as string) : slug;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" ? value : 0;
}

// Ingest one session file. Corrupt JSONL lines skip with a count; any
// undecodable zstd frame excludes the whole file (zero rows, `undecodable`)
// so every indexed session is whole by construction. A missing header or
// wrong format version fails the same way while the walk continues.
export const ingestDshFile = Effect.fn("ingestDshFile")(function* (file: string, slug: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const raw = yield* fileSystem.readFile(file);
  const { text, frames, decoded, corrupt } = decodeZstdFrames(raw);
  if (frames === 0) {
    return yield* new DshSessionError({ file, reason: "no-zstd-frames" });
  }
  if (decoded === 0 || corrupt || decoded < frames) {
    return yield* new DshSessionError({ file, reason: "undecodable" });
  }

  let sessionId: string | null = null;
  let cwd: string | null = null;
  let title = "";
  let corruptLines = 0;
  const candidates: CandidateTurn[] = [];
  const recallCallIds = new Set<string>();

  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      corruptLines += 1;
      continue;
    }
    if (!isRecord(event)) {
      corruptLines += 1;
      continue;
    }
    const type = readString(event, "type");
    const seq = readNumber(event, "seq");
    const time = readNumber(event, "time");
    const data = event.data;
    const body: Record<string, unknown> = isRecord(data) ? data : event;

    if (type === "session") {
      if (readNumber(event, "version") !== SESSION_FORMAT_VERSION) {
        return yield* new DshSessionError({ file, reason: "unsupported-version" });
      }
      if (sessionId === null) {
        sessionId = readString(event, "id");
        cwd = readString(event, "cwd");
      }
      continue;
    }
    if (type === "session/title" || type === "title") {
      const next = readString(body, "title");
      if (next !== null && next !== "") {
        title = next;
      }
      continue;
    }
    if (type === "tool/call") {
      const name = readString(body, "name");
      const callId = readString(body, "callId");
      if (name !== null && RECALL_TOOL_NAMES.has(name)) {
        if (callId !== null) {
          recallCallIds.add(callId);
        }
      }
      continue;
    }
    if (type === "user/message" || type === "assistant/message") {
      const content =
        type === "assistant/message"
          ? isRecord(body.message)
            ? body.message.content
            : null
          : body.content;
      const turnText = joinTextItems(content).trim();
      if (turnText !== "") {
        candidates.push({
          seq,
          time,
          kind: type === "assistant/message" ? "assistant" : "user",
          text: turnText,
          resultCallId: null,
        });
      }
      continue;
    }
    if (type === "tool/result") {
      const message = body.message;
      const content = isRecord(message) ? message.content : null;
      const turnText = joinTextItems(content).trim();
      if (turnText !== "") {
        // Production shape nests the call id under the message envelope
        // (`message.toolCallId`, fallback `message.source.callId`), not at
        // the record top level — verified against live sessions 2026-11-24.
        const messageRecord: Record<string, unknown> = isRecord(message) ? message : {};
        const sourceRecord: Record<string, unknown> = isRecord(messageRecord.source)
          ? messageRecord.source
          : {};
        const callId =
          readString(messageRecord, "toolCallId")
          ?? readString(sourceRecord, "callId")
          ?? readString(body, "toolCallId");
        candidates.push({ seq, time, kind: "tool", text: turnText, resultCallId: callId });
      }
    }
  }

  if (sessionId === null) {
    return yield* new DshSessionError({ file, reason: "no-header" });
  }

  if (title.trim() === NO_RECALL_TITLE) {
    return {
      records: [],
      turnsSkipped: candidates.length,
      corruptLines,
      partial: false,
    } satisfies DshFileIngest;
  }

  const records: SessionRecord[] = [];
  let turnsSkipped = 0;
  const storedId = `dsh:${sessionId}`;
  const project = normalizeProject(cwd, slug);
  for (const turn of candidates) {
    if (
      turn.text.includes(RECALL_CROSS_EXCERPT_HEADER)
      || (turn.resultCallId !== null && recallCallIds.has(turn.resultCallId))
    ) {
      turnsSkipped += 1;
      continue;
    }
    records.push({
      harness: "dsh",
      sessionId: storedId,
      project,
      timestamp: turn.time,
      seq: turn.seq,
      kind: turn.kind,
      text: turn.text,
      pointer: `${file}#seq=${turn.seq}`,
      howToPull: `DSH session file ${file}, seq ${turn.seq}`,
    });
  }
  return {
    records,
    turnsSkipped,
    corruptLines,
    partial: false,
  } satisfies DshFileIngest;
});

// Walk a sessions root for every session log (both known layouts), ingest
// each, and keep going past per-file failures with the reason recorded.
export const ingestDshSessions = Effect.fn("ingestDshSessions")(function* (root: string) {
  const files = (yield* listFiles(root)).filter(entry =>
    entry.relativePath.endsWith(`/${SESSION_LOG_NAME}`),
  );
  const records: SessionRecord[] = [];
  const filesSkipped: DshFileSkip[] = [];
  let filesRead = 0;
  let turnsSkipped = 0;
  let corruptLines = 0;
  for (const entry of files) {
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
    records.push(...result.success.records);
    turnsSkipped += result.success.turnsSkipped;
    corruptLines += result.success.corruptLines;
  }
  return {
    records,
    filesRead,
    filesSkipped,
    turnsSkipped,
    corruptLines,
  } satisfies DshIngestSummary;
});

export type DshServices = FileSystem.FileSystem | Path.Path;
