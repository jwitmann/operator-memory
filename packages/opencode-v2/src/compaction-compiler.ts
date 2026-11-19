// Deterministic instant-compaction for the OpenCode adapter: project the
// compaction hook's request messages into compiler nodes, compile them with
// the core VCC region compiler, and frame an override summary with a keepID
// tail pointer. Proven against the host by the opencode-vcc-port live probe
// (override with `metadata.keepID` persists verbatim with no model call on
// opencode v2.3.2). When no keepID exists at/after the cut, or the framed
// checkpoint is not smaller than the request it replaces, this module
// abstains (returns undefined) and the caller falls back to shaped model
// compaction — never a broken summary.

import {
  COMPILER_REV,
  compileNoisePatterns,
  compileRegion,
  DEFAULT_CHECKPOINT_FRAMING,
  DEFAULT_ELIDABLE_SOURCE_LABELS,
  DEFAULT_ELIDED_BODY_NOTE,
  DEFAULT_ELIDED_SOURCE_NOTE,
  DEFAULT_MEMORY_BLOCK_JOINER,
  DEFAULT_MEMORY_FILE_CLOSE,
  DEFAULT_MEMORY_MARKER_WINDOW,
  DEFAULT_MEMORY_ROLE_HEAD,
  DEFAULT_MEMORY_SNAPSHOT_MARKERS,
  DEFAULT_NOISE_PATTERNS,
  DEFAULT_SYSTEM_REMINDER_BODY_MARKERS,
  DEFAULT_SYSTEM_REMINDER_PROOF_WINDOW,
  estimateEntryTokens,
  frameCheckpoint,
  type CompileContentBlock,
  type CompileNode,
  type CompilerConfig,
  type CompileStats,
} from "@aerovato/operator-core/context/compiler";
import { isRecord } from "@aerovato/operator-core/utils";

// Engine defaults: verbatim from the probe's DEFAULT_PLUGIN_CONFIG (itself
// from dsh-compaction-vcc@0.7.4 `src/index.js`). No OpenCode noise XML is
// known, so the pattern list stays empty while tag-unwrapping stays on.
export const DEFAULT_VCC_MAX_TOKENS = 8192;
export const DEFAULT_VCC_TEXT_TOKENS = 8192;
export const DEFAULT_VCC_USER_TEXT_TOKENS = 16384;
export const DEFAULT_VCC_TOOL_CALL_TOKENS = 128;
export const DEFAULT_VCC_TOOL_RESULT_EXCERPT_TOKENS = 256;
export const DEFAULT_VCC_KEEP_MESSAGES = 6;

// Resolve the compiler config from engine defaults. The OpenCode tool
// catalog needs no key-field overrides today: read/edit/write, glob, grep,
// and bash are already covered by the core defaults, and anything else
// renders name-only. Elision stays off (no memory plugin re-injects on this
// host) and debug stays off; both ride config for future use. The recall
// guide names the operator tools (not bare `recall`/`search`): they are the
// agent-callable recovery surface on this host.
export function resolveVccCompilerConfig(): CompilerConfig {
  return {
    textTokens: DEFAULT_VCC_TEXT_TOKENS,
    userTextTokens: DEFAULT_VCC_USER_TEXT_TOKENS,
    toolCallTokens: DEFAULT_VCC_TOOL_CALL_TOKENS,
    toolResultExcerptTokens: DEFAULT_VCC_TOOL_RESULT_EXCERPT_TOKENS,
    maxTokens: DEFAULT_VCC_MAX_TOKENS,
    includeReasoning: false,
    stripNoiseXml: true,
    noisePatterns: compileNoisePatterns(DEFAULT_NOISE_PATTERNS),
    toolKeyFields: {},
    toolArgTools: [],
    hideTools: [],
    elideCheckpointInjectedBodies: false,
    elideSourceKinds: [],
    elideSourceLabels: DEFAULT_ELIDABLE_SOURCE_LABELS,
    memorySnapshotMarkers: DEFAULT_MEMORY_SNAPSHOT_MARKERS,
    memoryFileClose: DEFAULT_MEMORY_FILE_CLOSE,
    memoryBlockJoiner: DEFAULT_MEMORY_BLOCK_JOINER,
    memoryRoleHead: DEFAULT_MEMORY_ROLE_HEAD,
    memoryMarkerWindow: DEFAULT_MEMORY_MARKER_WINDOW,
    systemReminderBodyMarkers: DEFAULT_SYSTEM_REMINDER_BODY_MARKERS,
    systemReminderProofWindow: DEFAULT_SYSTEM_REMINDER_PROOF_WINDOW,
    elidedSourceNote: DEFAULT_ELIDED_SOURCE_NOTE,
    elidedBodyNote: DEFAULT_ELIDED_BODY_NOTE,
    framing: {
      ...DEFAULT_CHECKPOINT_FRAMING,
      recallGuide:
        'RECALL: append-only log — nothing is lost. `operator:recall` restores original content: type "seq", id "3-7"; "result", id "3"; "checkpoint", id "1" (`[checkpoint N]` = dropped). `operator:search` finds by keyword.',
    },
    checkpointOrdinals: null,
    debug: false,
    debugSink: null,
  };
}

// Stringify one tool-call input for a one-liner or a recall projection:
// strings pass through, everything else JSON-encodes, unserializable
// values collapse to empty.
export function stringifyToolInput(input: unknown): string {
  if (input === undefined || input === null) return "";
  try {
    return typeof input === "string" ? input : (JSON.stringify(input) ?? "");
  } catch {
    return "";
  }
}

// Classify a media part as an image/document label (bytes are never stored
// or compiled). Accepts OpenCode parts (`part.media.*`) and cleaned snapshot
// parts (`part.mediaType`).
export function mediaLabel(part: {
  readonly media?: unknown;
  readonly mediaType?: unknown;
}): string {
  const media = part.media;
  const mime = isRecord(media) ? (media.mediaType ?? media.mime) : part.mediaType;
  return typeof mime === "string" && mime.startsWith("image/") ? "image" : "document";
}

// Project one OpenCode tool-result value to plain text for a text block.
export function projectResultValue(result: unknown): string {
  if (result === null || result === undefined) return "";
  if (typeof result !== "object") return String(result);
  if (!isRecord(result)) return String(result);
  const value = result.value;
  switch (result.type) {
    case "text":
      return typeof value === "string" ? value : String(value);
    case "error":
      return `[error] ${String(value)}`;
    case "content": {
      if (!Array.isArray(value)) return String(value);
      return value
        .map(block => {
          if (block === null || block === undefined) return "";
          if (!isRecord(block)) return `[${String(block)}]`;
          if (block.type === "text") {
            const text = block.text;
            return typeof text === "string" ? text : "";
          }
          if (block.type === "file") {
            const name = block.name;
            const uri = block.uri;
            return `[file ${typeof name === "string" ? name : typeof uri === "string" ? uri : "attachment"}]`;
          }
          return `[${String(block.type)}]`;
        })
        .filter(text => text.length > 0)
        .join("\n");
    }
    default: {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value) ?? String(value);
      } catch {
        return String(value);
      }
    }
  }
}

// Map one content part to a compiler block, or null to drop it. The
// `compaction`/`effort` control blocks never reach the summary.
function toBlock(part: unknown): CompileContentBlock | null {
  if (part === null || part === undefined) return null;
  const record = isRecord(part) ? part : null;
  const type = record?.type;
  switch (type) {
    case "text": {
      const text = record?.text;
      return { type: "text", text: typeof text === "string" ? text : "" };
    }
    case "reasoning": {
      const text = record?.text;
      return { type: "reasoning", text: typeof text === "string" ? text : "" };
    }
    case "tool-call": {
      const input = record?.input;
      const id = record?.id;
      const name = record?.name;
      return {
        type: "tool-call",
        id: typeof id === "string" ? id : "",
        name: typeof name === "string" ? name : "unknown",
        arguments: stringifyToolInput(input),
      };
    }
    case "tool-result":
      return { type: "text", text: projectResultValue(record?.result) };
    case "media": {
      return { type: mediaLabel(isRecord(record) ? record : {}) };
    }
    case "compaction":
    case "effort":
      return null;
    default:
      return { type: String(type) };
  }
}

// Map one request message to a compiler node, or null to skip it. A prior
// checkpoint (assistant message carrying only a compaction block) re-enters
// as a `compact-checkpoint` user message so the new summary compiles on top
// of the old one instead of beside it.
export function toCompilerNode(message: unknown, seq: number): CompileNode | null {
  if (!isRecord(message)) return null;
  const content = message.content;
  if (!Array.isArray(content)) return null;
  if (message.role === "system") return null;
  if (message.role === "assistant") {
    const live = content.filter(block => block !== null && block !== undefined);
    if (live.length === 1) {
      const only = live[0];
      if (isRecord(only) && only.type === "compaction") {
        const text = only.text;
        if (typeof text !== "string" || text.length === 0) return null;
        return {
          seq,
          message: {
            role: "user",
            content: [{ type: "text", text }],
            source: { kind: "compact-checkpoint" },
          },
        };
      }
    }
    const blocks: CompileContentBlock[] = [];
    for (const part of content) {
      const block = toBlock(part);
      if (block !== null) blocks.push(block);
    }
    return { seq, message: { role: "assistant", content: blocks } };
  }
  if (message.role === "tool") {
    const first = content.find(
      part => part !== null && part !== undefined && isRecord(part) && part.type === "tool-result",
    );
    const blocks: CompileContentBlock[] = [];
    for (const part of content) {
      const block = toBlock(part);
      if (block !== null) blocks.push(block);
    }
    const toolCallId = isRecord(first) ? first.id : undefined;
    if (typeof toolCallId === "string" && toolCallId !== "") {
      return { seq, message: { role: "tool", content: blocks, toolCallId } };
    }
    return { seq, message: { role: "tool", content: blocks } };
  }
  if (message.role === "user") {
    const blocks: CompileContentBlock[] = [];
    for (const part of content) {
      const block = toBlock(part);
      if (block !== null) blocks.push(block);
    }
    return { seq, message: { role: "user", content: blocks } };
  }
  return null;
}

// Pick the keepID: id of the first tailed message (scan forward past id-less
// messages from the cut point). Returns undefined when no id exists at/after
// the cut — the hook must abstain, never emit a broken summary.
export function pickKeepID(messages: readonly unknown[], keepMessages: number): string | undefined {
  const list = Array.isArray(messages) ? messages : [];
  const keep =
    Number.isFinite(keepMessages) && keepMessages > 0
      ? Math.max(1, Math.floor(keepMessages))
      : DEFAULT_VCC_KEEP_MESSAGES;
  const cut = Math.max(0, list.length - keep);
  for (let index = cut; index < list.length; index += 1) {
    const candidate = list[index];
    const id = isRecord(candidate) ? candidate.id : undefined;
    if (typeof id === "string" && id !== "") return id;
  }
  return undefined;
}

export type CompiledCompaction = {
  readonly summary: string;
  readonly keepID: string;
  readonly stats: CompileStats;
  readonly capped: boolean;
  readonly summaryTokens: number;
};

// Project one compaction request into compiler nodes, assigning durable seqs
// by kept count (first kept message = seq 1). Skipped messages (system
// prompt, empty checkpoint shells, unknown roles) consume no seq — the
// snapshot side (`toSnapshotEvents`) uses the same rule, so checkpoint
// `(seq N)` pointers address the same events recall and search read.
export function toCompactionNodes(messages: readonly unknown[]): CompileNode[] {
  const list = Array.isArray(messages) ? messages : [];
  const nodes: CompileNode[] = [];
  for (const message of list) {
    const node = toCompilerNode(message, nodes.length + 1);
    if (node !== null) nodes.push(node);
  }
  return nodes;
}

// Compile one compaction request deterministically. Returns undefined to
// abstain when no keepID exists at/after the cut, or when the framed
// checkpoint is not smaller than the request it replaces (the shrink
// guarantee) — the hook falls back to shaped model compaction in both cases.
export function compileCompaction(
  messages: readonly unknown[],
  config: CompilerConfig,
  keepMessages: number,
  requestTokens: number,
): CompiledCompaction | undefined {
  const list = Array.isArray(messages) ? messages : [];
  const nodes = toCompactionNodes(list);
  const keepID = pickKeepID(list, keepMessages);
  if (keepID === undefined) return undefined;
  const region = compileRegion(nodes, config);
  const headerLine = `[vcc-compaction ${COMPILER_REV}: ${nodes.length} messages -> ${region.entries.length} entries]`;
  const footerLine = region.capped ? [`[cap enforced at ${config.maxTokens} entry tokens]`] : null;
  const summary = frameCheckpoint(region.entries, headerLine, null, footerLine, config.framing)
    .map(block => block.text)
    .join("\n\n");
  const summaryTokens = estimateEntryTokens(summary);
  if (summaryTokens >= requestTokens) return undefined;
  return { summary, keepID, stats: region.stats, capped: region.capped, summaryTokens };
}
