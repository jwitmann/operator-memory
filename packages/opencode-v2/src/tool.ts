import { execFile } from "node:child_process";
import { join } from "node:path";
import { InvalidSearchPatternError } from "@jwitmann/vcc-brain-core/context/search";
import {
  DEFAULT_RETENTION,
  pruneOmissions,
  readOmission,
} from "@jwitmann/vcc-brain-core/context/store";
import { isRecord } from "@jwitmann/vcc-brain-core/utils";
import type { Context } from "@opencode/plugin/promise/plugin";

import {
  classifySnapshotStore,
  formatRecallReply,
  formatSearchReply,
  readCompactionSnapshot,
  recallFromSnapshot,
  resolveRecallSelections,
  searchSnapshot,
} from "./compaction-snapshot.ts";

export type ReadOmittedDeps = {
  // ~/.vcc-brain/state (legacy ~/.operator/state also checked); the adapter computes it from the user home.
  readonly stateDirectory: string;
};

const OMISSION_ID_PATTERN = /^omitted-\d+$/;

function isOmissionID(contentID: string): boolean {
  return OMISSION_ID_PATTERN.test(contentID);
}

// Registers vcc-brain-read_omitted: recovers a trimmed payload from the
// omission store by content ID. The omission notices left in context name
// these IDs; without this tool they would be dead references. Registered
// under a flat hyphenated name: OpenCode's namespace() declaration is
// description-only (the effective name comes from options.namespace, which
// we never set), so a bare name is what the model has always called —
// prefixing it makes the four tools collision-proof and identical on every
// host (colons break OpenAI-protocol gateways, so `vcc-brain:` never
// existed as a callable name).
export async function registerReadOmittedTool(
  context: Context,
  deps: ReadOmittedDeps,
): Promise<void> {
  await context.tool.transform(editor => {
    editor.add({
      name: "vcc-brain-read_omitted",
      // Directly callable: without codemode:false the tool lives only in
      // the execute sandbox (tools.*), never as a native function call.
      options: { codemode: false },
      description:
        "Read original tool input or output content omitted by VCC Brain trimming or compaction. "
        + "This reads the snapshot of previously executed tool I/O; contents should be expected "
        + "to be stale. Only use it when stale content is strictly required and similar "
        + "information cannot be obtained via new tool calls.",
      input: {
        type: "object",
        properties: {
          contentID: {
            type: "string",
            description: "Omitted content ID. E.g.: omitted-001.",
          },
        },
        required: ["contentID"],
      },
      execute: async (input, toolContext) => {
        if (typeof input !== "object" || input === null || !("contentID" in input)) {
          return { content: "Missing required input: contentID." };
        }
        const contentID = (input as { contentID: unknown }).contentID;
        if (typeof contentID !== "string") {
          return { content: "Missing required input: contentID." };
        }
        if (!isOmissionID(contentID)) {
          return { content: `Invalid content ID: ${contentID}.` };
        }

        const stored = await readOmission(
          join(deps.stateDirectory, "omitted"),
          toolContext.sessionID,
          contentID,
        );
        if (!stored.ok) {
          return { content: `Could not read omitted content for Content ID: ${contentID}.` };
        }
        return {
          content: stored.value ?? `No omitted content found for Content ID: ${contentID}`,
        };
      },
    });
  });
}

// Registers vcc-brain-prune: enforces the retention policy on the current
// session's omission store (age, count, and byte caps from
// DEFAULT_RETENTION unless overridden). Payloads omitted from context stay
// recoverable through vcc-brain-read_omitted only while retained; receipts
// keep their content IDs regardless, and pruning never touches receipts.
// Flat hyphenated name, same as the other tools (see above).
export async function registerPruneTool(context: Context, deps: ReadOmittedDeps): Promise<void> {
  await context.tool.transform(editor => {
    editor.add({
      name: "vcc-brain-prune",
      // Directly callable (see above).
      options: { codemode: false },
      description:
        "Prune the current session's omitted tool input and output store "
        + "by age, count, and size. Recover pruned payloads first if they are "
        + "still needed: pruning deletes the files vcc-brain-read_omitted serves.",
      input: {
        type: "object",
        properties: {
          maxAgeDays: {
            type: "number",
            description: "Drop payloads older than this many days.",
          },
          maxPayloads: {
            type: "number",
            description: "Keep at most this many payloads, newest first.",
          },
          maxBytes: {
            type: "number",
            description: "Keep at most this many payload bytes, newest first.",
          },
        },
      },
      execute: async (input, toolContext) => {
        const options = asPruneOptions(input);
        const pruned = await pruneOmissions(
          join(deps.stateDirectory, "omitted"),
          toolContext.sessionID,
          {
            maxAgeMs: options.maxAgeDays * 24 * 60 * 60 * 1000,
            maxPayloads: options.maxPayloads,
            maxBytes: options.maxBytes,
          },
          Date.now(),
        );
        if (!pruned.ok) {
          return { content: "Could not prune omitted content for this session." };
        }
        return {
          content:
            `Pruned ${pruned.value.removed.length} payload(s), `
            + `freed ${pruned.value.freedBytes} byte(s), `
            + `${pruned.value.remaining} remaining.`,
        };
      },
    });
  });
}

function asPruneOptions(input: unknown): {
  readonly maxAgeDays: number;
  readonly maxPayloads: number;
  readonly maxBytes: number;
} {
  const record = typeof input === "object" && input !== null ? input : {};
  return {
    maxAgeDays: readNonNegativeNumber(record, "maxAgeDays", DEFAULT_RETENTION.maxAgeMs / 86400000),
    maxPayloads: readNonNegativeNumber(record, "maxPayloads", DEFAULT_RETENTION.maxPayloads),
    maxBytes: readNonNegativeNumber(record, "maxBytes", DEFAULT_RETENTION.maxBytes),
  };
}

function readNonNegativeNumber(record: object, key: string, fallback: number): number {
  if (!(key in record)) {
    return fallback;
  }
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Registers vcc-brain-recall: restores the exact original content of compacted
// history from the per-session snapshot by seq selection, tool-result
// reference, or checkpoint ordinal. The checkpoint guide names this tool, so
// a compiled summary's `(seq N)` pointers stay dereferenceable.
// Flat hyphenated name, same as the other tools (see above).
export async function registerRecallTool(context: Context, deps: ReadOmittedDeps): Promise<void> {
  await context.tool.transform(editor => {
    editor.add({
      name: "vcc-brain-recall",
      // Directly callable (see above).
      options: { codemode: false },
      description:
        "Restore exact original content compacted away by VCC Brain instant-compaction. "
        + 'Takes a reference type and id: type "seq" with a seq selection like "3-7"; '
        + 'type "result" with a tool-result seq like "3"; type "checkpoint" with an '
        + 'ordinal like "1" (1 = oldest). Only works after the first compaction in this session.',
      input: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description: "Reference type: seq, result, or checkpoint.",
          },
          id: {
            type: "string",
            description: 'Type-dependent reference. E.g.: "3-7", "3", "1".',
          },
        },
        required: ["type", "id"],
      },
      execute: async (input, toolContext) => {
        if (
          !isRecord(input)
          || (input.type !== "seq" && input.type !== "result" && input.type !== "checkpoint")
        ) {
          return {
            content: "Missing or invalid input: type must be one of seq, result, checkpoint.",
          };
        }
        if (typeof input.id !== "string" || input.id.trim() === "") {
          return { content: "Missing required input: id." };
        }
        const read = await readCompactionSnapshot(
          join(deps.stateDirectory, "context-snapshot"),
          toolContext.sessionID,
        );
        const classified = classifySnapshotStore(read);
        if (classified.status === "failed") {
          return { content: "Could not read compaction snapshot for this session." };
        }
        if (classified.status === "empty") {
          return {
            content:
              "No compaction snapshot yet for this session. Recall is available after the first compaction.",
          };
        }
        const resolved = resolveRecallSelections(classified.messages, input.type, input.id);
        if (resolved.errors.length > 0 || resolved.selections.length === 0) {
          return {
            content: resolved.errors.length > 0 ? resolved.errors.join("; ") : "Nothing to recall.",
          };
        }
        const recalled = recallFromSnapshot(classified.messages, resolved.selections);
        return { content: formatRecallReply(input.type, input.id, recalled) };
      },
    });
  });
}

// Registers vcc-brain-search: keyword/regex search over the compacted
// session history in the per-session snapshot. Hits carry `(seq N)` pointers
// that vcc-brain-recall restores in full.
// Flat hyphenated name, same as the other tools (see above).
export async function registerSearchTool(context: Context, deps: ReadOmittedDeps): Promise<void> {
  await context.tool.transform(editor => {
    editor.add({
      name: "vcc-brain-search",
      // Directly callable (see above).
      options: { codemode: false },
      description:
        "Search this session's compacted history by keyword or regex. "
        + "Returns matching events with (seq N) pointers; use vcc-brain-recall to "
        + "restore any hit's full original content. Only works after the first compaction in this session.",
      input: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: 'Keyword or regex to search for. E.g.: "login".',
          },
        },
        required: ["pattern"],
      },
      execute: async (input, toolContext) => {
        if (!isRecord(input) || typeof input.pattern !== "string" || input.pattern.trim() === "") {
          return { content: "Missing required input: pattern." };
        }
        const read = await readCompactionSnapshot(
          join(deps.stateDirectory, "context-snapshot"),
          toolContext.sessionID,
        );
        const classified = classifySnapshotStore(read);
        if (classified.status === "failed") {
          return { content: "Could not read compaction snapshot for this session." };
        }
        if (classified.status === "empty") {
          return {
            content:
              "No compaction snapshot yet for this session. Search is available after the first compaction.",
          };
        }
        try {
          const found = searchSnapshot(classified.messages, input.pattern);
          return { content: formatSearchReply(input.pattern, found) };
        } catch (error) {
          if (error instanceof InvalidSearchPatternError) {
            return { content: `Invalid search pattern: ${error.source}.` };
          }
          throw error;
        }
      },
    });
  });
}

export type SearchSessionsDeps = {
  // Setup-time project directory (one setup per project directory):
  // passed as `--project` so scope ordering matches this project.
  readonly projectDirectory: string;
};

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

// Registers vcc-brain-search-sessions: keyword search over OTHER sessions
// (cross-session recall), scoped to this project plus mutual peers. Backed
// by a helper-subprocess query call: the same tool-time binding deviation
// the DSH adapter uses, keeping sqlite and session-store access out of the
// plugin bundle. OpenCode results require one
// `vcc-brain-helper recall-cross index` run on this machine first.
export async function registerSearchSessionsTool(
  context: Context,
  deps: SearchSessionsDeps,
): Promise<void> {
  await context.tool.transform(editor => {
    editor.add({
      name: "vcc-brain-search-sessions",
      options: { codemode: false },
      description:
        "Search OTHER sessions (cross-session recall) for keywords, scoped to this project plus mutual peers. "
        + "Returns matching turns with stored session ids (like opencode:ses_... or dsh:<uuid>); "
        + "call vcc-brain-recall-session to restore a session's full turns. "
        + "Use vcc-brain-search (not this tool) for the current conversation. "
        + "OpenCode results require one `vcc-brain-helper recall-cross index` run on this machine first.",
      input: {
        type: "object",
        properties: {
          keywords: {
            type: "string",
            description: "Space-separated keywords to search past sessions for.",
          },
          harness: {
            type: "string",
            description: "Limit results to one harness.",
            enum: ["dsh", "opencode", "all"],
          },
        },
        required: ["keywords"],
      },
      execute: async input => {
        if (
          !isRecord(input)
          || typeof input.keywords !== "string"
          || input.keywords.trim() === ""
        ) {
          return { content: "Missing required input: keywords." };
        }
        const words = input.keywords.trim().split(/\s+/);
        if (words.some(word => word.startsWith("-"))) {
          return { content: "Invalid input: keywords must not start with '-'." };
        }
        const invocation = ["recall-cross", "query", "--project", deps.projectDirectory];
        if (input.harness !== undefined && input.harness !== "") {
          if (input.harness !== "dsh" && input.harness !== "opencode" && input.harness !== "all") {
            return { content: "Invalid input: harness must be one of dsh, opencode, all." };
          }
          invocation.push("--harness", input.harness as string);
        }
        invocation.push(...words);
        try {
          const result = await runHelperBinary(invocation);
          return { content: result.output };
        } catch {
          return { content: "Could not run the recall index. Is vcc-brain-helper installed?" };
        }
      },
    });
  });
}

// Registers vcc-brain-recall-session: restore the full turns of one indexed
// past session by stored id, optionally a single turn by seq. Same
// helper-subprocess backing as the search companion above.
export async function registerRecallSessionTool(context: Context): Promise<void> {
  await context.tool.transform(editor => {
    editor.add({
      name: "vcc-brain-recall-session",
      options: { codemode: false },
      description:
        "Restore the full turns of one indexed past session by its stored session id "
        + "(like opencode:ses_... or dsh:<uuid>), optionally a single turn by sequence number. "
        + "Use vcc-brain-recall (not this tool) for the current conversation.",
      input: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "Stored session id, like opencode:ses_... or dsh:<uuid>.",
          },
          seq: {
            type: "string",
            description: "Optional single turn sequence number to restore.",
          },
        },
        required: ["sessionId"],
      },
      execute: async input => {
        if (
          !isRecord(input)
          || typeof input.sessionId !== "string"
          || input.sessionId.trim() === ""
        ) {
          return { content: "Missing required input: sessionId." };
        }
        if (input.sessionId.trim().startsWith("-")) {
          return { content: "Invalid input: sessionId must not start with '-'." };
        }
        let sequence: string | null = null;
        if (input.seq !== undefined && input.seq !== null && String(input.seq) !== "") {
          if (!/^\d+$/.test(String(input.seq).trim())) {
            return { content: "Invalid input: seq must be a non-negative integer." };
          }
          sequence = String(input.seq).trim();
        }
        const invocation = ["recall-cross", "recall", input.sessionId.trim()];
        if (sequence !== null) {
          invocation.push("--seq", sequence);
        }
        try {
          const result = await runHelperBinary(invocation);
          return { content: result.output };
        } catch {
          return { content: "Could not run the recall index. Is vcc-brain-helper installed?" };
        }
      },
    });
  });
}
