// Deterministic tokenizer and token-budget primitives for the instant
// compaction compiler. Faithful logic port of dsh-compaction-vcc@0.7.4
// `src/compiler.js` via the opencode-vcc-port stage 1 (`compiler/tokenize.mjs`):
// fixed-density word-class tokens (letter runs, digit runs, single
// punctuation, whitespace runs), character-density estimation (0.3 per
// non-CJK character, 0.6 per CJK character), and dual-enforced truncation
// (token count AND a `limit * 4` character ceiling, floor 32). Everything
// here is total and offline: same input text always yields the same tokens,
// counts, and slices. Oracle vectors live in `compiler.test.ts`, captured
// from the original (port selftest run 2026-11-19).

import { isRecord } from "../utils.ts";

const TOKEN_RE = /[a-zA-Z]+|[0-9]+|[^\sa-zA-Z0-9]|\s+/g;

// biome-ignore lint/suspicious/noControlCharactersInRegex: sanitizer intentionally matches the ESC byte class.
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

// biome-ignore lint/suspicious/noControlCharactersInRegex: sanitizer intentionally matches the C0/C1 byte classes.
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// Move the end of a slice to a code-point boundary: a cut must never leave
// a high surrogate without its low half.
function completeCodePointAtEnd(text: string): string {
  return isHighSurrogate(text.charCodeAt(text.length - 1)) ? text.slice(0, -1) : text;
}

// Move the start of a slice to a code-point boundary (a tail excerpt must
// never begin inside a surrogate pair).
function completeCodePointAtStart(text: string): string {
  return isLowSurrogate(text.charCodeAt(0)) ? text.slice(1) : text;
}

// Split text into fixed-density tokens: letter runs, digit runs, single
// punctuation chars, and whitespace runs. Whitespace tokens are included in
// the list but never counted by `countTokens`.
export function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

// True when the character carries the 0.6 CJK weight. Name kept for API
// stability; it means "CJK-density character" (kana, hangul, Thai, Lao,
// Indic scripts included — same density class, not ideographs only).
export function isCjkChar(char: string): boolean {
  const code = char.codePointAt(0) ?? -1;
  return (
    (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0x3000 && code <= 0x303f)
    || (code >= 0xff00 && code <= 0xffef)
    || (code >= 0x3040 && code <= 0x30ff)
    || (code >= 0x31f0 && code <= 0x31ff)
    || (code >= 0xac00 && code <= 0xd7af)
    || (code >= 0x1100 && code <= 0x11ff)
    || (code >= 0x0e00 && code <= 0x0e7f)
    || (code >= 0x0e80 && code <= 0x0eff)
    || (code >= 0x0900 && code <= 0x097f)
    || (code >= 0x0980 && code <= 0x09ff)
    || (code >= 0x0a00 && code <= 0x0a7f)
    || (code >= 0x0a80 && code <= 0x0aff)
    || (code >= 0x0b00 && code <= 0x0b7f)
    || (code >= 0x0b80 && code <= 0x0bff)
    || (code >= 0x0c00 && code <= 0x0c7f)
    || (code >= 0x0c80 && code <= 0x0cff)
    || (code >= 0x0d00 && code <= 0x0d7f)
    || (code >= 0x0d80 && code <= 0x0dff)
    || (code >= 0x1000 && code <= 0x109f)
    || (code >= 0x1780 && code <= 0x17ff)
  );
}

// Estimate tokens under the character-density conversion (0.3 per non-CJK
// character, 0.6 per CJK character). Integer tenths, exact under ceil for
// long inputs.
export function estimateDeepSeekTokens(text: string): number {
  let nonCjk = 0;
  let cjk = 0;
  for (const char of text) {
    if (isCjkChar(char)) cjk += 1;
    else nonCjk += 1;
  }
  return (nonCjk * 3 + cjk * 6) / 10;
}

// Count the non-whitespace tokens of a text under `tokenize`.
export function countTokens(text: string): number {
  let count = 0;
  for (const token of tokenize(text)) if (token.trim().length > 0) count += 1;
  return count;
}

// Size one emitted entry the way every budget in this module is enforced:
// the word-class token count, floored at the character-density equivalent so
// the total cap also sees pathological long runs.
export function estimateEntryTokens(text: string): number {
  return Math.max(countTokens(text), Math.ceil(estimateDeepSeekTokens(text)));
}

// Strip carriage returns, ANSI escapes, and control bytes — deterministic
// cleanup, never token-changing rewrites.
export function sanitize(text: string): string {
  let out = text;
  if (out.includes("\r")) out = out.replaceAll("\r", "");
  if (out.includes("\x1b")) out = out.replace(ANSI_RE, "");
  return out.replace(CONTROL_RE, "");
}

export type TruncatedText = {
  readonly text: string;
  readonly truncated: boolean;
};

// Truncate text to a non-whitespace-token budget, preserving exact original
// tokens and appending a provenance note on a cut. Every budget is enforced
// twice — by token count AND by a `limit * 4` character ceiling (floor 32),
// so pathological unbroken runs (base64 blobs, minified files) cannot pass.
export function truncateTokens(text: string, limit: number, ref: string | null): TruncatedText {
  const tokens = tokenize(text);
  let count = 0;
  let cut = tokens.length;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token.trim().length === 0) continue;
    count += 1;
    if (count > limit) {
      cut = index;
      break;
    }
  }
  let out = cut >= tokens.length ? text : tokens.slice(0, cut).join("");
  let truncated = cut < tokens.length;
  const maxChars = Math.max(32, limit * 4);
  if (out.length > maxChars) {
    out = completeCodePointAtEnd(out.slice(0, maxChars));
    truncated = true;
  } else if (truncated) {
    out = completeCodePointAtEnd(out);
  }
  if (!truncated) return { text, truncated: false };
  out = out.replace(/\s+$/u, "");
  const note = ref === null ? "...(truncated)" : `...(truncated from ${ref})`;
  return { text: out + note, truncated: true };
}

// Keep the LAST `limit` non-whitespace tokens of a text, additionally capped
// at `limit * 4` characters. The end of the text is always preserved.
export function tailTokens(text: string, limit: number, ref: string | null): TruncatedText {
  const tokens = tokenize(text);
  let count = 0;
  let startIndex = tokens.length;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if ((tokens[index] ?? "").trim().length > 0) {
      count += 1;
      if (count > limit) break;
    }
    startIndex = index;
  }
  let out = startIndex === 0 ? text : tokens.slice(startIndex).join("");
  let truncated = startIndex > 0;
  const maxChars = Math.max(32, limit * 4);
  if (out.length > maxChars) {
    out = completeCodePointAtStart(out.slice(out.length - maxChars));
    truncated = true;
  } else if (truncated) {
    out = completeCodePointAtStart(out);
  }
  if (!truncated) return { text, truncated: false };
  const tailNote = ref === null ? "...(elided before)" : `...(elided before ${ref})`;
  return { text: tailNote + out, truncated: true };
}

// ── region compiler (stage 2) ─────────────────────────────────────────────
// Faithful logic port of the port repo's `compile.mjs` (itself ported from
// dsh-compaction-vcc@0.7.4 `src/compiler.js`): noise stripping, tool-call
// one-liners, content projection, the ordered-region compiler with budget
// rescaling and cap elision, and checkpoint framing. Deliberate deviations
// from the port source are marked below; everything else reproduces it.
// Oracle vectors live in `compiler.test.ts`, captured from the original.

// ── noise stripping ──

const NOISE_UNWRAP_RE = /<\/?(?:command-name|command-args)>/g;

// The VCC brief-mode noise XML patterns, adapted to harness markup. Applied
// with the `s` flag; the replacement set is configurable via
// `CompilerConfig.noisePatterns`.
export const DEFAULT_NOISE_PATTERNS: readonly string[] = [
  "<ide_opened_file>.*?</ide_opened_file>",
  "<ide_selection>.*?</ide_selection>",
  "<system-reminder>.*?</system-reminder>",
  "<command-message>.*?</command-message>",
  "<task-notification>.*?</task-notification>",
];

// Compile untrusted noise-pattern sources, throwing on invalid regex.
export function compileNoisePatterns(sources: readonly string[]): RegExp[] {
  return sources.map((source, index) => {
    try {
      return new RegExp(source, "s");
    } catch (error) {
      throw new Error(
        `noisePatterns[${index}] (${JSON.stringify(source)}) is not a valid regular expression: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
}

// Strip configured noise XML blocks from user text and unwrap command-name /
// command-args tags.
export function stripNoiseXml(text: string, patterns: readonly RegExp[]): string {
  let out = text;
  for (const pattern of patterns) out = out.replace(pattern, "");
  out = out.replace(NOISE_UNWRAP_RE, "");
  return out.trim();
}

// ── tool-call one-liner ──

// VCC's `_TOOL_SUMMARY_FIELDS`, extended for the DSH tool catalog. The
// OpenCode mapping lives in adapter config (`toolKeyFields`); these defaults
// are carried verbatim so behavior without config matches the original.
export const DEFAULT_TOOL_KEY_FIELDS: Readonly<Record<string, string>> = {
  read: "file_path",
  edit: "file_path",
  write: "file_path",
  glob: "pattern",
  grep: "pattern",
  bash: "command",
  web_search: "query",
  skill: "name",
  ralph: "objective",
  subagent: "description",
  subagent_fork: "description",
  create_goal: "objective",
  update_goal: "objective",
  workflow: "name",
  interrupt_agent: "agent_id",
  job_kill: "job_id",
  job_output: "job_id",
  send_message: "message",
};

// Tools whose key argument is kept in the one-liner. Everything else renders
// name-only — bookkeeping tools carry no semantic payload worth the tokens.
export const DEFAULT_ARG_TOOLS: readonly string[] = [
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "bash",
  "shell",
  "web_search",
  "skill",
  "subagent",
  "subagent_fork",
  "ralph",
  "workflow",
];

// First-line projection for a tool-call one-liner: multiline arguments
// collapse to the first physical line plus a `[+ N lines]` marker.
export function oneLineArg(value: string): string {
  const lines = value.split(/\r?\n/u);
  if (lines.length === 1) return value;
  const firstLine = lines[0] ?? "";
  if (firstLine !== "" || lines.every(line => line.trim() === "")) return firstLine;
  return `${lines.find(line => line.trim() !== "") ?? ""} [+ ${lines.length - 1} lines]`;
}

// Pick the key argument for a tool-call one-liner: the tool-specific field
// first, then the first string-valued argument, else nothing.
export function pickToolKeyArg(
  name: string,
  input: unknown,
  keyFields: Readonly<Record<string, string>>,
): string | undefined {
  if (!isRecord(input)) return undefined;
  const preferred = keyFields[name];
  if (preferred !== undefined) {
    const value = input[preferred];
    if (typeof value === "string" && value.length > 0) return value;
  }
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

// Safely parse a tool-call's raw JSON arguments. Non-string inputs yield
// null exactly where the original's throwing parse does: every downstream
// use only distinguishes parsed-object from not-parsed.
export function parseToolArguments(args: unknown): unknown {
  if (typeof args !== "string") return null;
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return null;
  }
}

// ── content projection helpers ──

export type CompileContentBlock = {
  readonly type?: string;
  readonly text?: string;
  readonly name?: string;
  readonly arguments?: unknown;
  readonly id?: string;
  readonly toolCallId?: string;
};

export type CompileMessage = {
  readonly role: string;
  readonly content: readonly (CompileContentBlock | null)[] | null;
  readonly toolCallId?: string;
  readonly source?: { readonly kind?: unknown } | null;
};

export type CompileNode = {
  readonly seq: number;
  readonly message: CompileMessage | null;
};

// Project nested tool-result blocks into one plain-text string: text blocks
// are joined, images and documents render as VCC-style labels.
export function projectToolResultText(blocks: unknown): string {
  const parts: string[] = [];
  if (!Array.isArray(blocks)) return "";
  for (const block of blocks) {
    if (block === null || block === undefined) continue;
    if (!isRecord(block)) continue;
    if (block.type === "text") {
      const raw = block.text;
      const text = sanitize(typeof raw === "string" ? raw : "");
      if (text.length > 0) parts.push(text);
    } else if (block.type === "image") parts.push("[image]");
    else if (block.type === "document") parts.push("[document]");
    else parts.push(`[${String(block.type)}]`);
  }
  return parts.join("\n");
}

export type MessageSource =
  | {
      readonly kind?: unknown;
      readonly [key: string]: unknown;
    }
  | null
  | undefined;

// Whether a message source identifies a landed compaction checkpoint node.
// Host 0.2.x builds the marker with `compactCheckpointSource()`, which yields
// `{ kind: "compact-checkpoint", compactionId, sourceCommandId? }`. The legacy
// `{ kind: "plugin", plugin: "compact" }` shape from earlier hosts is still
// accepted so checkpoints written by an older host stay recallable.
export function isCheckpointSource(source: MessageSource): boolean {
  if (!isRecord(source)) return false;
  if (source.kind === "compact-checkpoint") return true;
  return source.kind === "plugin" && source.plugin === "compact";
}

// Whether a message source is one of the harness-injected instruction blocks
// the caller asked to elide (see `elideSourceKinds`). Matching is on the
// structured `source.kind` field the harness records, never on message text.
export function isElidableSource(source: MessageSource, kinds: readonly string[]): boolean {
  if (kinds === undefined || kinds.length === 0) return false;
  const kind = source?.kind;
  return typeof kind === "string" && kinds.includes(kind);
}

// Display labels for elidable instruction sources. Anything not listed falls
// back to its raw `source.kind`, so a new host source still gets a readable
// pointer without a code change. Carried as the default; the adapter supplies
// its own table through `CompilerConfig.elideSourceLabels`.
export const DEFAULT_ELIDABLE_SOURCE_LABELS: Readonly<Record<string, string>> = {
  "dsh-mnemon": "记忆快照",
  "agent-instructions": "规则与冷库索引",
  "skill-catalog": "技能清单",
  "runtime-context": "运行时上下文",
  "time-context": "时间上下文",
};

// Markers that open a hot-memory snapshot as the sibling memory plugin
// renders it. Carried as the default; the adapter supplies its own markers
// through `CompilerConfig.memorySnapshotMarkers`. Inert unless
// checkpoint-body elision runs.
export const DEFAULT_MEMORY_SNAPSHOT_MARKERS: readonly string[] = [
  "MNEMON RUNTIME MEMORY SNAPSHOT",
  "[MNEMON]",
];
// Closing tag of one memory file block inside a snapshot.
export const DEFAULT_MEMORY_FILE_CLOSE = "</runtime-memory-file>";
// Text that may separate two consecutive memory file blocks of ONE snapshot,
// so the two are treated as a single span.
export const DEFAULT_MEMORY_BLOCK_JOINER: RegExp =
  /^\s*(?:MEMORY\.md \(working reference\)|USER\.md \(user profile\)|<runtime-memory-file )/;
// One role header line of this compiler's own checkpoint format. Memory
// snapshots never contain one, so finding it between a file block's opening
// and its close means the close belongs to a LATER block (truncation case)
// and the span must stop before this.
export const DEFAULT_MEMORY_ROLE_HEAD: RegExp = /\n\[(?:user|assistant|tool)\]\s*\n/;

// Marker text the host puts inside a REAL rules/index wrapper. Prose that
// only mentions `<system-reminder>` as a string must not qualify.
export const DEFAULT_SYSTEM_REMINDER_BODY_MARKERS: readonly string[] = [
  "The following workspace instructions may be relevant",
  "Instructions from:",
];
// How far into a candidate wrapper the proof phrase must appear.
export const DEFAULT_SYSTEM_REMINDER_PROOF_WINDOW = 600;
// How close a memory marker must sit to the first file block to count.
export const DEFAULT_MEMORY_MARKER_WINDOW = 800;

// Default copy for the pointer standing in for an elided instruction block.
// Carries the seq so the agent can `recall` the original, plus what it was
// and how big it was. The adapter supplies its own wording through
// `CompilerConfig.elidedSourceNote`.
export const DEFAULT_ELIDED_SOURCE_NOTE = (label: string, seq: number, length: number): string =>
  `[${label} 已压缩为指针（seq ${seq}，原文 ${length} 字符）— 原文可用 recall 调回，且下一次压缩后会重新注入]`;

// Default copy for a collapsed harness-injected body inside a prior
// checkpoint. The adapter supplies its own wording through
// `CompilerConfig.elidedBodyNote`.
export const DEFAULT_ELIDED_BODY_NOTE = (length: number): string =>
  `[注入内容已压缩为指针（原文 ${length} 字符）— 压缩后会重新注入，原文可用 recall 调回]`;

// Locate injected memory snapshots embedded in a PRIOR checkpoint body.
// Returns `[start, end)` character spans, left to right.
function findMemorySnapshotSpans(
  text: string,
  markers: readonly string[],
  fileClose: string,
  blockJoiner: RegExp,
  roleHead: RegExp,
  markerWindow: number,
): [number, number][] {
  const spans: [number, number][] = [];
  let searchFrom = 0;
  while (searchFrom < text.length) {
    let markerAt: number | undefined;
    for (const marker of markers) {
      const index = text.indexOf(marker, searchFrom);
      if (index !== -1 && (markerAt === undefined || index < markerAt)) markerAt = index;
    }
    if (markerAt === undefined) break;
    const firstFile = text.indexOf("<runtime-memory-file ", markerAt);
    if (firstFile === -1) break;
    if (firstFile - markerAt > markerWindow) {
      // Just prose quoting the marker — skip past it and keep looking.
      searchFrom = markerAt + 1;
      continue;
    }
    let end: number | undefined;
    let cursor = firstFile;
    for (;;) {
      const close = text.indexOf(fileClose, cursor);
      if (close === -1) break;
      // A memory block whose closing tag was truncated away has no close of
      // its own, so the search below would run on to the NEXT block's close
      // and swallow every real turn in between. Role headers are this
      // compiler's own output and never appear inside a memory snapshot, so
      // a role header before the close proves the span has left the block.
      const head = roleHead.exec(text.slice(cursor, close));
      if (head !== null) {
        end = cursor + head.index;
        break;
      }
      const after = close + fileClose.length;
      end = after;
      cursor = after;
      if (!blockJoiner.test(text.slice(after, after + 240))) break;
    }
    if (end === undefined) break;
    spans.push([markerAt, end]);
    searchFrom = end;
  }
  return spans;
}

// Locate `<system-reminder>…</system-reminder>` wrappers that really frame
// workspace rules, the cold-store index or runtime context.
function findSystemReminderSpans(
  text: string,
  bodyMarkers: readonly string[],
  proofWindow: number,
): [number, number][] {
  const spans: [number, number][] = [];
  const pattern = /(?:^|\n)<system-reminder>\n/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const open = text.indexOf("<system-reminder>", match.index);
    const head = text.slice(open, open + proofWindow);
    if (bodyMarkers.some(marker => head.includes(marker))) {
      const close = text.indexOf("</system-reminder>", open);
      if (close !== -1) spans.push([open, close + "</system-reminder>".length]);
    }
    match = pattern.exec(text);
  }
  return spans;
}

export type ElideResult = {
  readonly text: string;
  readonly spans: number;
  readonly chars: number;
};

// Collapse harness-injected bodies embedded in a PRIOR checkpoint to
// one-line pointers. Only checkpoint prose is touched; live conversation
// text is never scanned. Marker lists and pointer copy come from config.
export function elideCheckpointInjectedBodies(text: string, config: CompilerConfig): ElideResult {
  const spans = [
    ...findMemorySnapshotSpans(
      text,
      config.memorySnapshotMarkers,
      config.memoryFileClose,
      config.memoryBlockJoiner,
      config.memoryRoleHead,
      config.memoryMarkerWindow,
    ),
    ...findSystemReminderSpans(
      text,
      config.systemReminderBodyMarkers,
      config.systemReminderProofWindow,
    ),
  ].sort((left, right) => left[0] - right[0]);
  if (spans.length === 0) return { text, spans: 0, chars: 0 };
  let out = "";
  let cursor = 0;
  let chars = 0;
  let removed = 0;
  for (const span of spans) {
    const start = span[0];
    const end = span[1];
    // Overlapping spans would otherwise duplicate text; keep the outer one.
    if (start < cursor) continue;
    out += text.slice(cursor, start);
    const length = end - start;
    chars += length;
    removed += 1;
    out += config.elidedBodyNote(length);
    cursor = end;
  }
  out += text.slice(cursor);
  return { text: out, spans: removed, chars };
}

// Head/tail excerpt of a tool result under one shared token budget. The tail
// is anchored to the end of the text at character granularity, so a result
// whose tail matters more than its head (file listings, logs) keeps its end.
export function excerptToolResult(text: string, budget: number, ref: string): string {
  const overBudget = countTokens(text) > budget || text.length > budget * 4;
  if (budget <= 0 || !overBudget) return text;
  const half = Math.floor(budget / 2);
  const headLimit = Math.max(8, half);
  const tailLimit = Math.max(8, budget - headLimit);
  const head = truncateTokens(text, headLimit, ref);
  const tail = tailTokens(text, tailLimit, ref);
  return `${head.text}\n...(elided from ${ref})\n${tail.text}`;
}

// ── the region compiler ──

export const CHECKPOINT_PREAMBLE =
  "This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.";
export const CHECKPOINT_OPEN_TAG = "<compacted-checkpoint>";
export const CHECKPOINT_CLOSE_TAG = "</compacted-checkpoint>";

// Checkpoint framing copy: the recall guide plus the preamble and tags that
// wrap the compiled body. Part of the checkpoint wire format (bumped with
// COMPILER_REV); carried as config so the adapter owns its wording.
export type CheckpointFraming = {
  readonly recallGuide: string;
  readonly preamble: string;
  readonly openTag: string;
  readonly closeTag: string;
};

// Model-facing guide framed into the head of every checkpoint: tells the
// agent how to recover content the compiler elided or truncated, using the
// two recall tools that read the append-only durable log.
export const RECALL_GUIDE =
  'RECALL: append-only log — nothing is lost. `recall` restores original content: type "seq", id "3-7"; "result", id "3"; "checkpoint", id "1" (`[checkpoint N]` = dropped). `search` finds by keyword.';

// Per-node reference marker: the durable seq is the lossless pointer.
function seqRef(seq: number): string {
  return `seq ${seq}`;
}

// Build marker for this compiler revision. Bumped whenever the compiled
// output format changes, so debug logs can prove which code version ran.
export const COMPILER_REV = "vcc-compiler-debug-2";

export const DEFAULT_CHECKPOINT_FRAMING: CheckpointFraming = {
  recallGuide: RECALL_GUIDE,
  preamble: CHECKPOINT_PREAMBLE,
  openTag: CHECKPOINT_OPEN_TAG,
  closeTag: CHECKPOINT_CLOSE_TAG,
};

export type CompilerConfig = {
  readonly textTokens: number;
  readonly userTextTokens: number;
  readonly toolCallTokens: number;
  readonly toolResultExcerptTokens: number;
  readonly maxTokens: number;
  readonly includeReasoning: boolean;
  readonly stripNoiseXml: boolean;
  readonly noisePatterns: readonly RegExp[];
  readonly toolKeyFields: Readonly<Record<string, string>>;
  readonly toolArgTools: readonly string[];
  readonly hideTools: readonly string[];
  readonly elideCheckpointInjectedBodies: boolean;
  readonly elideSourceKinds: readonly string[];
  readonly elideSourceLabels: Readonly<Record<string, string>>;
  readonly memorySnapshotMarkers: readonly string[];
  readonly memoryFileClose: string;
  readonly memoryBlockJoiner: RegExp;
  readonly memoryRoleHead: RegExp;
  readonly memoryMarkerWindow: number;
  readonly systemReminderBodyMarkers: readonly string[];
  readonly systemReminderProofWindow: number;
  readonly elidedSourceNote: (label: string, seq: number, length: number) => string;
  readonly elidedBodyNote: (length: number) => string;
  readonly framing: CheckpointFraming;
  readonly checkpointOrdinals: ReadonlyMap<number, number | string> | null;
  readonly debug: boolean;
  readonly debugSink: ((text: string) => void) | null;
};

export type CompileBudgets = {
  readonly textTokens: number;
  readonly userTextTokens: number;
  readonly toolCallTokens: number;
  readonly toolResultExcerptTokens: number;
};

export type CompileEntryKind =
  | "text"
  | "reasoning"
  | "tool"
  | "media"
  | "result"
  | "checkpoint"
  | "note";

export type CompileEntry = {
  readonly seq: number;
  readonly text: string;
  readonly kind: CompileEntryKind;
};

export type CompileStats = {
  readonly nodes: number;
  readonly entries: number;
  readonly toolCalls: number;
  readonly toolResults: number;
  readonly images: number;
  readonly documents: number;
  readonly reasoningElided: number;
  readonly noiseElided: number;
  readonly elidedSourceRows: number;
  readonly elidedSourceChars: number;
  readonly elidedCheckpointSpans: number;
  readonly elidedCheckpointChars: number;
  readonly checkpoints: number;
  readonly tokens: number;
  readonly elidedToolRows: number;
  readonly elidedRows: number;
};

// Emit one debug line through the configured sink when `debug` is enabled.
// Deviation from the port: no `console.error` fallback — runtime code never
// writes to the console; observability flows through the caller's channels.
function debugLog(config: CompilerConfig, tag: string, line: string): void {
  if (!config.debug) return;
  const text = `[dsh-compaction-vcc] ${tag}: ${line}`;
  try {
    config.debugSink?.(text);
  } catch {
    // A failing debug sink must never break a compaction.
  }
}

// Compile one ordered region into compact entries. `message` may be null
// (non-projecting node); `budgets` selects the per-block budgets, defaulting
// to the config values (the budget-cap loop passes scaled budgets on retry).
export function compileNodes(
  nodes: readonly CompileNode[],
  config: CompilerConfig,
  budgets: CompileBudgets | null,
): { readonly entries: CompileEntry[]; readonly stats: CompileStats } {
  const effective: CompileBudgets = budgets ?? {
    textTokens: config.textTokens,
    userTextTokens: config.userTextTokens,
    toolCallTokens: config.toolCallTokens,
    toolResultExcerptTokens: config.toolResultExcerptTokens,
  };
  const keyFields = { ...DEFAULT_TOOL_KEY_FIELDS, ...config.toolKeyFields };
  const patterns = config.noisePatterns;
  // Empty lists mean "unset": the config pipeline injects `[]` for absent
  // array keys, so fall back to the defaults instead of rendering every
  // tool call name-only.
  const argTools = config.toolArgTools.length > 0 ? config.toolArgTools : DEFAULT_ARG_TOOLS;
  const hiddenTools = new Set(config.hideTools);
  debugLog(
    config,
    "compile",
    `rev=${COMPILER_REV} nodes=${nodes.length} argTools=[${argTools.join(",")}] hideTools={${[...hiddenTools].join(",")}} budgets=${JSON.stringify(effective)}`,
  );
  const entries: CompileEntry[] = [];
  const stats = {
    nodes: nodes.length,
    entries: 0,
    toolCalls: 0,
    toolResults: 0,
    images: 0,
    documents: 0,
    reasoningElided: 0,
    noiseElided: 0,
    elidedSourceRows: 0,
    elidedSourceChars: 0,
    elidedCheckpointSpans: 0,
    elidedCheckpointChars: 0,
    checkpoints: 0,
    tokens: 0,
    elidedToolRows: 0,
    elidedRows: 0,
  };
  // Pre-pass over the ordered nodes: map each tool-call id to the seq of its
  // result node, so every call one-liner can carry a VCC-style result pointer
  // even though results no longer occupy entries. Reads the message-level
  // `toolCallId` first with the legacy first-block shape as fallback.
  const resultSeqByCallId = new Map<string, number>();
  for (const node of nodes) {
    const message = node.message;
    if (message === null || message === undefined) continue;
    const first = message.content?.[0];
    const toolResultBlock =
      first !== undefined && first !== null && first.type === "tool-result" ? first : undefined;
    const callId =
      typeof message.toolCallId === "string"
        ? message.toolCallId
        : typeof toolResultBlock?.toolCallId === "string"
          ? toolResultBlock.toolCallId
          : undefined;
    if (callId !== undefined) resultSeqByCallId.set(callId, node.seq);
  }
  let lastRole: string | undefined;
  let open = false;

  // Append one compiled entry carrying a deletion-priority kind. Kinds order
  // the cap-elision passes in compileRegion: `result`/`tool`/`media`/`note`
  // rows are dropped before `text`/`reasoning`/`checkpoint` rows, so when a
  // checkpoint must shrink, the conversation's words survive its logs.
  const pushEntry = (seq: number, text: string, kind: CompileEntryKind): void => {
    entries.push({ seq, text, kind });
    stats.entries += 1;
    stats.tokens += estimateEntryTokens(text);
  };
  const roleHeader = (role: string): string => {
    if (!open || lastRole !== role) {
      open = true;
      lastRole = role;
      return `[${role}]\n`;
    }
    return "";
  };

  for (const node of nodes) {
    const message = node.message;
    // A null/absent `content` used to fall through and throw, aborting the
    // whole compile. Skip the node instead so the rest still compiles.
    if (message === null || message === undefined) continue;
    if (!Array.isArray(message.content)) continue;
    if (message.role === "assistant") {
      let header = "";
      for (const block of message.content) {
        // A null block in the array used to throw on `block.type` and abort
        // the whole compile. Skip it.
        if (block === null || block === undefined) continue;
        if (block.type === "text") {
          const text = sanitize(block.text ?? "");
          if (text.trim().length === 0) continue;
          header = roleHeader("assistant");
          const kept = truncateTokens(text, effective.textTokens, seqRef(node.seq));
          pushEntry(node.seq, `${header}${kept.text}`, "text");
          continue;
        }
        if (block.type === "reasoning") {
          if (!config.includeReasoning) {
            stats.reasoningElided += 1;
            continue;
          }
          const text = sanitize(block.text ?? "");
          if (text.trim().length === 0) continue;
          header = roleHeader("assistant");
          const kept = truncateTokens(text, effective.textTokens, seqRef(node.seq));
          pushEntry(node.seq, `${header}${kept.text}`, "reasoning");
          continue;
        }
        if (block.type === "tool-call") {
          const name = block.name ?? "unknown";
          stats.toolCalls += 1;
          if (hiddenTools.has(name)) {
            debugLog(config, "tool", `seq=${node.seq} name=${name} HIDDEN (hideTools)`);
            continue;
          }
          header = roleHeader("assistant");
          // One line, always: key argument only for whitelisted tools, and a
          // pointer to the result node so the dropped result stays one recall
          // away.
          let oneLine: string;
          let diag: string;
          if (argTools.includes(name)) {
            const parsed = parseToolArguments(block.arguments);
            const arg = pickToolKeyArg(name, parsed, keyFields);
            oneLine = arg === undefined ? `* ${name}` : `* ${name} "${oneLineArg(arg)}"`;
            diag = `whitelist=yes argsType=${typeof block.arguments} argsLen=${
              block.arguments === null || block.arguments === undefined
                ? 0
                : String(block.arguments).length
            } argsHead=${JSON.stringify(String(block.arguments).slice(0, 60))} parse=${
              parsed === null ? "FAIL" : "ok"
            } key=${keyFields[name] ?? "(fallback)"} arg=${
              arg === undefined ? "(none)" : JSON.stringify(String(arg).slice(0, 60))
            }`;
          } else {
            oneLine = `* ${name}`;
            diag = `whitelist=no argsType=${typeof block.arguments} argsLen=${
              block.arguments === null || block.arguments === undefined
                ? 0
                : String(block.arguments).length
            } argsHead=${JSON.stringify(String(block.arguments).slice(0, 60))}`;
          }
          const callId = typeof block.id === "string" ? block.id : undefined;
          const resultSeq = callId === undefined ? undefined : resultSeqByCallId.get(callId);
          const ref =
            resultSeq === undefined
              ? seqRef(node.seq)
              : `${seqRef(node.seq)} -> result ${resultSeq}`;
          const kept = truncateTokens(oneLine, effective.toolCallTokens, seqRef(node.seq));
          debugLog(
            config,
            "tool",
            `seq=${node.seq} name=${name} ${diag} line=${JSON.stringify(oneLine.slice(0, 80))} truncated=${kept.truncated} ref=${ref}`,
          );
          pushEntry(node.seq, `${header}${kept.text} (${ref})`, "tool");
          continue;
        }
        if (block.type === "image") {
          stats.images += 1;
          header = roleHeader("assistant");
          pushEntry(node.seq, `${header}[image] (${seqRef(node.seq)})`, "media");
          continue;
        }
        if (block.type === "document") {
          stats.documents += 1;
          header = roleHeader("assistant");
          pushEntry(node.seq, `${header}[document] (${seqRef(node.seq)})`, "media");
          continue;
        }
        // Unknown merge-extensible block types render as labels.
        header = roleHeader("assistant");
        pushEntry(node.seq, `${header}[${String(block.type)}] (${seqRef(node.seq)})`, "media");
      }
      // Reasoning-only and empty assistant messages produce no entry.
      continue;
    }
    if (message.role === "tool") {
      stats.toolResults += 1;
      const body = projectToolResultText(message.content);
      if (body.length > 0) {
        const header = roleHeader("tool");
        // Excerpt to the configured budget: tool output is the bulk of a long
        // session, and the full text stays one recall away via the call
        // line's `-> result N` pointer.
        const kept = excerptToolResult(body, effective.toolResultExcerptTokens, seqRef(node.seq));
        pushEntry(node.seq, `${header}${kept}`, "result");
      }
      continue;
    }
    if (message.role === "user") {
      const first = message.content[0];
      if (first !== undefined && first !== null && first.type === "tool-result") {
        // Tool results never occupy an entry: the content is either absorbed
        // into the following assistant text or one recall away via the call
        // line's `-> result N` pointer.
        stats.toolResults += 1;
        continue;
      }
      if (isCheckpointSource(message.source)) {
        stats.checkpoints += 1;
        let text = projectToolResultText(message.content);
        if (text.length > 0 && config.elideCheckpointInjectedBodies) {
          // A prior checkpoint body still carries every memory snapshot and
          // rules block that was live when it was compiled. Those are re-sent
          // in full after this compaction, so keeping them here is a
          // duplicate. Opt-in (default off) because it rewrites previously
          // compiled prose.
          const collapsed = elideCheckpointInjectedBodies(text, config);
          if (collapsed.spans > 0) {
            text = collapsed.text;
            stats.elidedCheckpointSpans += collapsed.spans;
            stats.elidedCheckpointChars += collapsed.chars;
          }
        }
        if (text.length > 0) {
          // The checkpoint node is harness-generated framing — display it as
          // [system].
          const header = roleHeader("system");
          pushEntry(node.seq, `${header}${text}`, "checkpoint");
        }
        continue;
      }
      if (isElidableSource(message.source, config.elideSourceKinds)) {
        // Harness-injected instruction blocks are re-injected in full after
        // every compaction, so keeping their body here duplicates them.
        // Collapse to a recall pointer.
        const text = projectToolResultText(message.content);
        if (text.length === 0) continue;
        const kind = message.source?.kind;
        const label =
          typeof kind === "string" ? (config.elideSourceLabels[kind] ?? kind) : "(unknown)";
        stats.elidedSourceRows += 1;
        stats.elidedSourceChars += text.length;
        pushEntry(
          node.seq,
          `${roleHeader("user")}* ${config.elidedSourceNote(label, node.seq, text.length)}`,
          "note",
        );
        continue;
      }
      let surviving = 0;
      let header = "";
      for (const block of message.content) {
        // A null block in the array used to throw on `block.type` and abort
        // the whole compile. Skip it.
        if (block === null || block === undefined) continue;
        if (block.type === "text") {
          let text = sanitize(block.text ?? "");
          if (config.stripNoiseXml) text = stripNoiseXml(text, patterns);
          if (text.length === 0) continue;
          surviving += 1;
          header = roleHeader("user");
          const kept = truncateTokens(text, effective.userTextTokens, seqRef(node.seq));
          pushEntry(node.seq, `${header}${kept.text}`, "text");
        } else if (block.type === "image") {
          stats.images += 1;
          surviving += 1;
          header = roleHeader("user");
          pushEntry(node.seq, `${header}[image] (${seqRef(node.seq)})`, "media");
        } else if (block.type === "document") {
          stats.documents += 1;
          surviving += 1;
          header = roleHeader("user");
          pushEntry(node.seq, `${header}[document] (${seqRef(node.seq)})`, "media");
        } else {
          const text = sanitize(block.text ?? "");
          if (text.length === 0) continue;
          surviving += 1;
          header = roleHeader("user");
          const kept = truncateTokens(text, effective.userTextTokens, seqRef(node.seq));
          pushEntry(node.seq, `${header}${kept.text}`, "text");
        }
      }
      if (surviving === 0) {
        stats.noiseElided += 1;
        pushEntry(
          node.seq,
          `${roleHeader("user")}* [user message elided: noise-only] (${seqRef(node.seq)})`,
          "note",
        );
      }
    }
  }
  return { entries, stats };
}

// Per-budget elision floors: conversation text keeps a meaningful minimum
// even when the total cap forces heavy rescaling, while tool one-liners and
// result excerpts may collapse to near-nothing first.
const BUDGET_FLOORS = {
  textTokens: 32,
  userTextTokens: 32,
  toolCallTokens: 8,
  toolResultExcerptTokens: 8,
} as const;

// Entry kinds dropped by the first (low-value) elision pass.
const LOW_VALUE_KINDS: ReadonlySet<CompileEntryKind> = new Set(["result", "tool", "media", "note"]);

// Scale ONLY the conversation-text budgets toward a total cap, never below
// the per-key floor. Tool-call rows stay one-liners at their configured
// budget: conversation shrinks first, tool rows are sacrificed whole by the
// elision pass, so tool calls can never squeeze the dialogue out.
function scaleBudgets(budgets: CompileBudgets, factor: number): CompileBudgets {
  return {
    ...budgets,
    textTokens: Math.max(BUDGET_FLOORS.textTokens, Math.floor(budgets.textTokens * factor)),
    userTextTokens: Math.max(
      BUDGET_FLOORS.userTextTokens,
      Math.floor(budgets.userTextTokens * factor),
    ),
  };
}

// Render the provenance range of one dropped-entry list. The list is never
// empty at the call sites; the fallback only satisfies the type checker.
function seqRangeOf(dropped: readonly CompileEntry[]): string {
  const first = dropped[0];
  const last = dropped[dropped.length - 1];
  if (first === undefined || last === undefined) return "seq ?";
  return first.seq === last.seq ? `seq ${first.seq}` : `seqs ${first.seq}-${last.seq}`;
}

// Mutable working copy of the counters: `CompileStats` is readonly for
// callers, but the cap pass adjusts totals as it elides.
type MutableStats = { -readonly [Key in keyof CompileStats]: CompileStats[Key] };

export type CompileRegionResult = {
  readonly entries: CompileEntry[];
  readonly stats: CompileStats;
  readonly capped: boolean;
};

// Compile a region to completion under the total checkpoint cap: budgets are
// rescaled toward `config.maxTokens` up to four attempts, then the oldest
// low-value rows (tool/result/media/note) are front-elided first, and only
// then the oldest remaining entries — so the conversation's words survive
// elision before its logs do. The newest entries always survive.
export function compileRegion(
  nodes: readonly CompileNode[],
  config: CompilerConfig,
): CompileRegionResult {
  const baseBudgets: CompileBudgets = {
    textTokens: config.textTokens,
    userTextTokens: config.userTextTokens,
    toolCallTokens: config.toolCallTokens,
    toolResultExcerptTokens: config.toolResultExcerptTokens,
  };
  let budgets: CompileBudgets = baseBudgets;
  let compiled = compileNodes(nodes, config, budgets);
  let attempts = 0;
  const maxAttempts = 4;
  while (compiled.stats.tokens > config.maxTokens && attempts < maxAttempts) {
    budgets = scaleBudgets(budgets, (config.maxTokens / compiled.stats.tokens) * 0.95);
    compiled = compileNodes(nodes, config, budgets);
    attempts += 1;
  }
  const entries = [...compiled.entries];
  const stats: MutableStats = { ...compiled.stats };
  let capped = false;
  if (stats.tokens > config.maxTokens) {
    // Phase A: drop the oldest low-value rows (tool/result/media/note)
    // anywhere in the list first, so conversation text and prior-checkpoint
    // knowledge survive elision before the logs do.
    const toolRows: CompileEntry[] = [];
    while (entries.length > 1 && stats.tokens > config.maxTokens) {
      const index = entries.findIndex(
        (entry, position) => position < entries.length - 1 && LOW_VALUE_KINDS.has(entry.kind),
      );
      if (index === -1) break;
      const dropped = entries.splice(index, 1)[0];
      if (dropped === undefined) break;
      stats.tokens -= estimateEntryTokens(dropped.text);
      toolRows.push(dropped);
    }
    if (toolRows.length > 0) {
      capped = true;
      stats.elidedToolRows += toolRows.length;
      const firstToolRow = toolRows[0];
      const marker: CompileEntry = {
        seq: firstToolRow?.seq ?? 0,
        text: `[${toolRows.length} tool/result entries elided: ${seqRangeOf(toolRows)}]`,
        kind: "note",
      };
      entries.unshift(marker);
      stats.tokens += estimateEntryTokens(marker.text);
    }
    const elided: CompileEntry[] = [];
    const droppedCheckpoints: CompileEntry[] = [];
    while (entries.length > 1 && stats.tokens > config.maxTokens) {
      const dropped = entries.shift();
      if (dropped === undefined) break;
      stats.tokens -= estimateEntryTokens(dropped.text);
      elided.push(dropped);
      if (dropped.kind === "checkpoint") droppedCheckpoints.push(dropped);
    }
    if (elided.length > 0) {
      capped = true;
      stats.elidedRows += elided.length;
      // Dropped prior checkpoints never vanish silently: each leaves a
      // single `[checkpoint N]` line the agent can restore in full via
      // recall(type:"checkpoint", id:"N").
      const firstElided = elided[0];
      const markerLines = [`[${elided.length} earlier entries elided: ${seqRangeOf(elided)}]`];
      for (const dropped of droppedCheckpoints) {
        const ordinal = config.checkpointOrdinals?.get(dropped.seq);
        const ref = ordinal === undefined ? `@ seq ${dropped.seq}` : String(ordinal);
        markerLines.push(`[checkpoint ${ref}]`);
      }
      const marker: CompileEntry = {
        seq: firstElided?.seq ?? 0,
        text: markerLines.join("\n"),
        kind: "note",
      };
      entries.unshift(marker);
      stats.tokens += estimateEntryTokens(marker.text);
    }
    if (stats.tokens > config.maxTokens && entries.length === 1) {
      capped = true;
      const only = entries[0];
      if (only !== undefined) {
        const hard = truncateTokens(only.text, Math.max(8, config.maxTokens - 4), "total cap");
        entries[0] = { seq: only.seq, text: hard.text, kind: only.kind };
        stats.tokens = estimateEntryTokens(hard.text);
      }
    }
  }
  return { entries, stats, capped };
}

// Normalize one compiled entry to its text: entries are `{ seq, text }`
// pairs, but a custom compile hook may supply plain strings.
export function entryText(entry: string | { readonly text: string }): string {
  return typeof entry === "string" ? entry : entry.text;
}

// Join compiled entries with separators that keep tool runs compact:
// consecutive `tool` rows join with a single newline (no blank line), while
// every other boundary keeps the blank line that separates entry groups.
// Strings (guide, header, elision markers) behave like `text` entries.
export function joinCompiledEntries(entries: readonly (string | CompileEntry)[]): string {
  let out = "";
  let previousKind: CompileEntryKind | undefined;
  for (const entry of entries) {
    const kind: CompileEntryKind = typeof entry === "string" ? "text" : entry.kind;
    if (out.length > 0) out += previousKind === "tool" && kind === "tool" ? "\n" : "\n\n";
    out += typeof entry === "string" ? entry : entry.text;
    previousKind = kind;
  }
  return out;
}

// Frame compiled entries as the durable replacement checkpoint content:
// the shared preamble, the recall guide, then one tagged block (guide first,
// then the optional intro line, the optional header line, the entries, and
// the optional retention footer). Prior-checkpoint text copied verbatim
// nests inside harmlessly.
export function frameCheckpoint(
  entries: readonly (string | CompileEntry)[],
  headerLine: string | null,
  introLine: string | null,
  footerLine: string | readonly string[] | null,
  framing: CheckpointFraming,
): { readonly type: "text"; readonly text: string }[] {
  const body: (string | CompileEntry)[] = [framing.recallGuide];
  if (introLine !== null) body.push(introLine);
  if (headerLine !== null) body.push(headerLine);
  for (const entry of entries) body.push(entry);
  // `footerLine` accepts one line or an ordered list, so callers can append
  // several trailing notes without concatenating them into one paragraph.
  if (footerLine !== null) {
    if (typeof footerLine === "string") body.push(footerLine);
    else {
      for (const line of footerLine) body.push(line);
    }
  }
  return [
    { type: "text", text: `${framing.preamble}\n\n${framing.openTag}` },
    { type: "text", text: joinCompiledEntries(body) },
    { type: "text", text: framing.closeTag },
  ];
}
