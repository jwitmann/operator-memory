// Model-facing recall/search over the durable DSH session log.
//
// Two complementary entry points over the same log the compaction backend
// compacts, so recovery needs no snapshot file (unlike the opencode adapter,
// whose request view is transient): the log is append-only, and the core
// recall/search modules read it directly through the host's own
// `events`/`deriveEventMessage` accessors.
//
//   - `vcc-brain-recall` — restore exact original content by a typed
//     reference: `seq` for `(seq N)` / `(seqs A-B)` markers, `result` for
//     the `result N` pointer, `checkpoint` for a `[checkpoint N]` ordinal.
//   - `vcc-brain-search` — keyword/regex search returning `(seq N)` pointers
//     that `vcc-brain-recall` restores in full.
//   - `vcc-brain-search-sessions` — keyword search over OTHER sessions via
//     the helper's FTS5 recall index, scoped to this project plus mutual
//     peers; returns session-id pointers that `vcc-brain-recall-session`
//     restores in full.
//   - `vcc-brain-recall-session` — restore the full turns of one indexed
//     session by its stored session id (optionally a single `seq`).
//
// Faithful destructure of the reference `dsh-compaction-vcc/tool` module:
// same tool semantics against the same log shape, same core functions.
// Deliberate deviations, matching the opencode adapter's tool contract:
// hyphenated `vcc-brain-` names (colons break OpenAI-protocol gateways, so
// both adapters register flat hyphenated names; the brain-update counter
// excludes exactly this prefix, so recovery calls never nudge the
// documentation threshold),
// text replies instead of thrown harness errors (defineTool validates the
// argument shapes; semantic failures resolve to a valid canonical value
// carrying the message), core-default budgets with no config keys, and no
// `console` output anywhere.
// The cross-session pair shells to `vcc-brain-helper` via `node:child_process`
// `execFile` (argv array, no shell): the FTS5 index lives in the helper CLI
// process (node) and the DSH host exposes no subprocess service, so the raw
// builtin is the only call path. Failure degrades to text (exit code carried
// in the value); nothing thrown past `defineTool` validation.

import { execFile } from "node:child_process";
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  DEFAULT_MAX_RECALL_TOKENS,
  recallSession,
  resolveRecallReference,
} from "@jwitmann/vcc-brain-core/context/recall";
import {
  DEFAULT_MAX_SEARCH_HITS,
  InvalidSearchPatternError,
  searchSession,
} from "@jwitmann/vcc-brain-core/context/search";
import { isRecord } from "@jwitmann/vcc-brain-core/utils";

/** Stable Loader identity for the bundle row. */
export const name = "tool-recall";

/** Services used by the recall tools: agent-scoped tool registry. */
export const inject = ["tools"];

type ToolScopedContext = {
  readonly effect: (register: () => () => void) => void;
  readonly tools: {
    readonly register: (definition: object) => () => void;
  };
};

/** Register the recall tools (`vcc-brain-recall` + `vcc-brain-search` + `vcc-brain-search-sessions` + `vcc-brain-recall-session`). */
export function apply(context: Context): void {
  const scoped = context as unknown as ToolScopedContext;
  scoped.effect(() => {
    const disposers = [
      scoped.tools.register(defineRecallTool()),
      scoped.tools.register(defineSearchTool()),
      scoped.tools.register(defineSearchSessionsTool()),
      scoped.tools.register(defineRecallSessionTool()),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  });
}

const RECALL_DESCRIPTION =
  "Restore the exact original content of earlier events in THIS conversation by a typed reference. "
  + 'type "seq" with a seq selection like "3-7" restores those events; type "result" with the "result N" '
  + 'pointer from a tool-call one-liner restores that tool result; type "checkpoint" with an ordinal like "1" '
  + '(1 = oldest, as in a "[checkpoint N]" elision line) restores that whole checkpoint. '
  + "The durable log is append-only, so recalled content is always the original tokens, including content "
  + "elided by compaction checkpoints. To find events by keyword or regex instead, use vcc-brain-search.";

const SEARCH_DESCRIPTION =
  "Search THIS conversation's durable event log by keyword or regular expression (case-insensitive). "
  + "Every recorded event is searchable, including content elided by compaction checkpoints. "
  + "Returns the matching events with their (seq N) numbers and the matching lines. "
  + "Then call vcc-brain-recall with a (seq N) pointer to restore any hit's full exact original content.";

type RecallResult = {
  readonly text: string;
  readonly recalled: number;
  readonly missing: number;
  readonly skipped: number;
  readonly truncated: boolean;
  readonly tokens: number;
};

type SearchResult = {
  readonly text: string;
  readonly pattern: string;
  readonly totalMatches: number;
  readonly omitted: number;
  readonly truncated: boolean;
  readonly tokens: number;
};

function emptyRecall(text: string): RecallResult {
  return { text, recalled: 0, missing: 0, skipped: 0, truncated: false, tokens: 0 };
}

function emptySearch(pattern: string, text: string): SearchResult {
  return { text, pattern, totalMatches: 0, omitted: 0, truncated: false, tokens: 0 };
}

function formatRecallReply(type: string, id: string, recalled: RecallResult): string {
  // Local copy of the opencode adapter's snapshot formatter (not shared:
  // core RecallResult differs from the snapshot result type, only the
  // count accessor varies). Header wording stays identical so agents see
  // one surface.
  const label =
    `**vcc-brain-recall ${type} ${id}** (${recalled.recalled} event(s), ${recalled.tokens} tokens`
    + `${recalled.missing > 0 ? `, ${recalled.missing} missing` : ""}`
    + `${recalled.truncated ? ", budget-truncated" : ""})`;
  return `${label}\n\n${recalled.text}`;
}

function formatSearchReply(pattern: string, found: SearchResult): string {
  return `**vcc-brain-search ${pattern}** (${found.totalMatches} matching event(s))\n\n${found.text}`;
}

function readSession(agent: unknown): unknown {
  if (!isRecord(agent)) return null;
  return agent.session ?? null;
}

/** Build the typed `vcc-brain-recall` tool definition. Exported for tests. */
export function defineRecallTool() {
  return defineTool({
    name: "vcc-brain-recall",
    description: RECALL_DESCRIPTION,
    parameters: {
      type: {
        type: "string",
        required: true,
        enum: ["seq", "result", "checkpoint"],
        description:
          'Reference type: "seq" for events by sequence number, "result" for a tool result by its `result N` pointer, "checkpoint" for a whole checkpoint by ordinal or seq.',
      },
      id: {
        type: "string",
        required: true,
        description:
          'Type-dependent reference: "3-7" / "seq 12" for seq; "result 3" or "3" for result; "1" / "checkpoint 1" or "seq 12345" for checkpoint.',
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", required: true },
          recalled: { type: "integer", required: true },
          missing: { type: "integer", required: true },
          skipped: { type: "integer", required: true },
          truncated: { type: "boolean", required: true },
          tokens: { type: "integer", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.text }],
    },
    async execute(args, exec) {
      if (args.type !== "seq" && args.type !== "result" && args.type !== "checkpoint") {
        return emptyRecall(
          "Missing or invalid input: type must be one of seq, result, checkpoint.",
        );
      }
      if (typeof args.id !== "string" || args.id.trim() === "") {
        return emptyRecall("Missing required input: id.");
      }
      const session = readSession(exec.agent);
      if (session === null) {
        return emptyRecall("recall requires a calling agent with a session.");
      }
      try {
        const resolved = resolveRecallReference(session, args.type, args.id);
        if (resolved.errors.length > 0 || resolved.selections.length === 0) {
          return emptyRecall(
            resolved.errors.length > 0 ? resolved.errors.join("; ") : "Nothing to recall.",
          );
        }
        const recalled = recallSession(session, resolved.selections, {
          maxRecallTokens: DEFAULT_MAX_RECALL_TOKENS,
        });
        return {
          text: formatRecallReply(args.type, args.id, recalled),
          recalled: recalled.recalled,
          missing: recalled.missing,
          skipped: recalled.skipped,
          truncated: recalled.truncated,
          tokens: recalled.tokens,
        };
      } catch {
        // The durable log is host-written: a poisoned event (or deriver)
        // must degrade to text, never to a harness error.
        return emptyRecall("Could not read the session log.");
      }
    },
    presentCall: args => ({
      card: "generic",
      title: "Recall events",
      kind: "read",
      rawInput: `${args.type} ${args.id}`,
    }),
  });
}

/** Build the `vcc-brain-search` (grep) tool definition. Exported for tests. */
export function defineSearchTool() {
  return defineTool({
    name: "vcc-brain-search",
    description: SEARCH_DESCRIPTION,
    parameters: {
      pattern: {
        type: "string",
        required: true,
        description:
          "Keyword or regular expression to search for (case-insensitive). Escape regex special characters.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", required: true },
          pattern: { type: "string", required: true },
          totalMatches: { type: "integer", required: true },
          omitted: { type: "integer", required: true },
          truncated: { type: "boolean", required: true },
          tokens: { type: "integer", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.text }],
    },
    async execute(args, exec) {
      if (typeof args.pattern !== "string" || args.pattern.trim() === "") {
        return emptySearch("", "Missing required input: pattern.");
      }
      const session = readSession(exec.agent);
      if (session === null) {
        return emptySearch(args.pattern, "search requires a calling agent with a session.");
      }
      try {
        const found = searchSession(session, args.pattern, {
          maxSearchHits: DEFAULT_MAX_SEARCH_HITS,
          maxRecallTokens: DEFAULT_MAX_RECALL_TOKENS,
        });
        return {
          text: formatSearchReply(args.pattern, found),
          pattern: found.pattern,
          totalMatches: found.totalMatches,
          omitted: found.omitted,
          truncated: found.truncated,
          tokens: found.tokens,
        };
      } catch (error) {
        // Same reply shape as the opencode adapter: only the pattern
        // source, not the core's full reason string.
        if (error instanceof InvalidSearchPatternError) {
          return emptySearch(args.pattern, `Invalid search pattern: ${error.source}.`);
        }
        // The durable log is host-written: a poisoned event (or deriver)
        // must degrade to text, never to a harness error.
        return emptySearch(args.pattern, "Could not read the session log.");
      }
    },
    presentCall: args => ({
      card: "generic",
      title: "Search history",
      kind: "read",
      rawInput: args.pattern,
    }),
  });
}

const SEARCH_SESSIONS_DESCRIPTION =
  "Search OTHER sessions (cross-session recall) for keywords, scoped to this project plus mutual peers. "
  + "Returns matching turns with their stored session ids (like dsh:<uuid> or opencode:ses_...), sequence numbers, and fetch paths. "
  + "Then call vcc-brain-recall-session with a session id to restore that session's full turns. "
  + "Use vcc-brain-search (not this tool) for the current conversation. "
  + "OpenCode results require one `vcc-brain-helper recall-cross index` run on this machine first.";

const RECALL_SESSION_DESCRIPTION =
  "Restore the full turns of one indexed past session by its stored session id (like dsh:<uuid> or opencode:ses_...), "
  + "optionally a single turn by sequence number. "
  + "Use vcc-brain-recall (not this tool) for the current conversation.";

/** Helper CLI binary invoked for cross-session recall (thin adapter: all sqlite lives in the helper). */
export const HELPER_BIN = "vcc-brain-helper";

/** Cooperative timeout for one helper invocation. */
export const HELPER_TIMEOUT_MS = 60_000;

export type HelperRunResult = {
  readonly exitCode: number;
  readonly output: string;
};

/** Spawn the helper CLI and capture its output. Stderr wins on failure; stdout wins on success. Exported for tests. */
export function runHelperBinary(argument_: readonly string[]): Promise<HelperRunResult> {
  return new Promise(resolve => {
    execFile(
      HELPER_BIN,
      [...argument_],
      { timeout: HELPER_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, output: stdout });
          return;
        }
        const exitCode = typeof error.code === "number" ? error.code : 2;
        if (exitCode !== 0 && stderr !== "") {
          resolve({ exitCode, output: stderr });
          return;
        }
        resolve({ exitCode, output: stdout !== "" ? stdout : error.message });
      },
    );
  });
}

function readSessionCwd(agent: unknown): string | null {
  const session = readSession(agent);
  if (!isRecord(session)) return null;
  const header = session.header;
  if (!isRecord(header)) return null;
  return typeof header.cwd === "string" && header.cwd !== "" ? header.cwd : null;
}

function emptySessions(text: string): { text: string; exitCode: number } {
  return { text, exitCode: 0 };
}

/** Build the `vcc-brain-search-sessions` tool definition. Exported for tests. */
export function defineSearchSessionsTool() {
  return defineTool({
    name: "vcc-brain-search-sessions",
    description: SEARCH_SESSIONS_DESCRIPTION,
    parameters: {
      keywords: {
        type: "string",
        required: true,
        description: "Space-separated keywords to search past sessions for.",
      },
      harness: {
        type: "string",
        enum: ["dsh", "opencode", "all"],
        description: "Limit results to one harness (default: all).",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", required: true },
          exitCode: { type: "integer", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.text }],
    },
    async execute(args, exec) {
      if (typeof args.keywords !== "string" || args.keywords.trim() === "") {
        return emptySessions("Missing required input: keywords.");
      }
      const session = readSession(exec.agent);
      if (session === null) {
        return emptySessions("search-sessions requires a calling agent with a session.");
      }
      const words = args.keywords.trim().split(/\s+/);
      if (words.some(word => word.startsWith("-"))) {
        return emptySessions("Invalid input: keywords must not start with '-'.");
      }
      const invocation = ["recall-cross", "query"];
      const cwd = readSessionCwd(exec.agent);
      if (cwd !== null) {
        invocation.push("--project", cwd, "--project-dir", cwd);
      }
      if (args.harness !== undefined && (args.harness as string) !== "") {
        if (args.harness !== "dsh" && args.harness !== "opencode" && args.harness !== "all") {
          return emptySessions(`Invalid input: harness must be one of dsh, opencode, all.`);
        }
        invocation.push("--harness", args.harness);
      }
      invocation.push(...words);
      try {
        const result = await runHelperBinary(invocation);
        return { text: result.output, exitCode: result.exitCode };
      } catch {
        return emptySessions("Could not run the recall index. Is vcc-brain-helper installed?");
      }
    },
    presentCall: args => ({
      card: "generic",
      title: "Search past sessions",
      kind: "read",
      rawInput: args.keywords,
    }),
  });
}

/** Build the `vcc-brain-recall-session` tool definition. Exported for tests. */
export function defineRecallSessionTool() {
  return defineTool({
    name: "vcc-brain-recall-session",
    description: RECALL_SESSION_DESCRIPTION,
    parameters: {
      sessionId: {
        type: "string",
        required: true,
        description: "Stored session id, like dsh:<uuid> or opencode:ses_....",
      },
      seq: {
        type: "string",
        description: "Optional single turn sequence number to restore.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", required: true },
          exitCode: { type: "integer", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.text }],
    },
    async execute(args, exec) {
      if (typeof args.sessionId !== "string" || args.sessionId.trim() === "") {
        return emptySessions("Missing required input: sessionId.");
      }
      if (args.sessionId.trim().startsWith("-")) {
        return emptySessions("Invalid input: sessionId must not start with '-'.");
      }
      if (readSession(exec.agent) === null) {
        return emptySessions("recall-session requires a calling agent with a session.");
      }
      let sequence: string | null = null;
      if (args.seq !== undefined && args.seq !== null && String(args.seq) !== "") {
        if (!/^\d+$/.test(String(args.seq).trim())) {
          return emptySessions("Invalid input: seq must be a non-negative integer.");
        }
        sequence = String(args.seq).trim();
      }
      const invocation = ["recall-cross", "recall", args.sessionId.trim()];
      if (sequence !== null) {
        invocation.push("--seq", sequence);
      }
      try {
        const result = await runHelperBinary(invocation);
        return { text: result.output, exitCode: result.exitCode };
      } catch {
        return emptySessions("Could not run the recall index. Is vcc-brain-helper installed?");
      }
    },
    presentCall: args => ({
      card: "generic",
      title: "Recall past session",
      kind: "read",
      rawInput:
        typeof args.seq === "string" && args.seq !== ""
          ? `${args.sessionId} ${args.seq}`
          : args.sessionId,
    }),
  });
}
