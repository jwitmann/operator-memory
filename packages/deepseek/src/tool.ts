// Model-facing recall/search over the durable DSH session log.
//
// Two complementary entry points over the same log the compaction backend
// compacts, so recovery needs no snapshot file (unlike the opencode adapter,
// whose request view is transient): the log is append-only, and the core
// recall/search modules read it directly through the host's own
// `events`/`deriveEventMessage` accessors.
//
//   - `operator-recall` — restore exact original content by a typed
//     reference: `seq` for `(seq N)` / `(seqs A-B)` markers, `result` for
//     the `result N` pointer, `checkpoint` for a `[checkpoint N]` ordinal.
//   - `operator-search` — keyword/regex search returning `(seq N)` pointers
//     that `operator-recall` restores in full.
//
// Faithful destructure of the reference `dsh-compaction-vcc/tool` module:
// same tool semantics against the same log shape, same core functions.
// Deliberate deviations, matching the opencode adapter's tool contract:
// hyphenated `operator-` names (colons break OpenAI-protocol gateways, so
// both adapters register flat hyphenated names; the brain-update counter
// excludes exactly this prefix, so recovery calls never nudge the
// documentation threshold),
// text replies instead of thrown harness errors (defineTool validates the
// argument shapes; semantic failures resolve to a valid canonical value
// carrying the message), core-default budgets with no config keys, and no
// `console` output anywhere.

import {
  DEFAULT_MAX_RECALL_TOKENS,
  recallSession,
  resolveRecallReference,
} from "@aerovato/operator-core/context/recall";
import {
  DEFAULT_MAX_SEARCH_HITS,
  InvalidSearchPatternError,
  searchSession,
} from "@aerovato/operator-core/context/search";
import { isRecord } from "@aerovato/operator-core/utils";
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";

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

/** Register the recall tools (`operator-recall` + `operator-search`). */
export function apply(context: Context): void {
  const scoped = context as unknown as ToolScopedContext;
  scoped.effect(() => {
    const disposers = [
      scoped.tools.register(defineRecallTool()),
      scoped.tools.register(defineSearchTool()),
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
  + "elided by compaction checkpoints. To find events by keyword or regex instead, use operator-search.";

const SEARCH_DESCRIPTION =
  "Search THIS conversation's durable event log by keyword or regular expression (case-insensitive). "
  + "Every recorded event is searchable, including content elided by compaction checkpoints. "
  + "Returns the matching events with their (seq N) numbers and the matching lines. "
  + "Then call operator-recall with a (seq N) pointer to restore any hit's full exact original content.";

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
    `**operator-recall ${type} ${id}** (${recalled.recalled} event(s), ${recalled.tokens} tokens`
    + `${recalled.missing > 0 ? `, ${recalled.missing} missing` : ""}`
    + `${recalled.truncated ? ", budget-truncated" : ""})`;
  return `${label}\n\n${recalled.text}`;
}

function formatSearchReply(pattern: string, found: SearchResult): string {
  return `**operator-search ${pattern}** (${found.totalMatches} matching event(s))\n\n${found.text}`;
}

function readSession(agent: unknown): unknown {
  if (!isRecord(agent)) return null;
  return agent.session ?? null;
}

/** Build the typed `operator-recall` tool definition. Exported for tests. */
export function defineRecallTool() {
  return defineTool({
    name: "operator-recall",
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

/** Build the `operator-search` (grep) tool definition. Exported for tests. */
export function defineSearchTool() {
  return defineTool({
    name: "operator-search",
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
