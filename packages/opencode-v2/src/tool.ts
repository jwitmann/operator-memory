import {
  DEFAULT_RETENTION,
  pruneOmissions,
  readOmission,
} from "@aerovato/operator-core/context/store";
import type { Context } from "@opencode/plugin/promise/plugin";
import { join } from "node:path";

export type ReadOmittedDeps = {
  // ~/.operator/state; the adapter computes it from the user home.
  readonly stateDirectory: string;
};

const OMISSION_ID_PATTERN = /^omitted-\d+$/;

function isOmissionID(contentID: string): boolean {
  return OMISSION_ID_PATTERN.test(contentID);
}

// Registers operator:read_omitted: recovers a trimmed payload from the
// omission store by content ID. The omission notices left in context name
// these IDs; without this tool they would be dead references.
export async function registerReadOmittedTool(
  context: Context,
  deps: ReadOmittedDeps,
): Promise<void> {
  await context.tool.transform(editor => {
    editor.namespace({
      name: "operator",
      description: "Operator Memory context management tools.",
    });
    editor.add({
      name: "read_omitted",
      description:
        "Read original tool input or output content omitted by Operator trimming or compaction. "
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

// Registers operator:prune: enforces the retention policy on the current
// session's omission store (age, count, and byte caps from
// DEFAULT_RETENTION unless overridden). Payloads omitted from context stay
// recoverable through operator:read_omitted only while retained; receipts
// keep their content IDs regardless, and pruning never touches receipts.
export async function registerPruneTool(context: Context, deps: ReadOmittedDeps): Promise<void> {
  await context.tool.transform(editor => {
    editor.namespace({
      name: "operator",
      description: "Operator Memory context management tools.",
    });
    editor.add({
      name: "prune",
      description:
        "Prune the current session's omitted tool input and output store "
        + "by age, count, and size. Recover pruned payloads first if they are "
        + "still needed: pruning deletes the files operator:read_omitted serves.",
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
