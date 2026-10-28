import { inputOmissionNotice, outputOmissionNotice } from "./notices.ts";
import {
  countTextTokens,
  isToolCallPart,
  isToolResultPart,
  stringifyToolContent,
  type RequestMessage,
} from "./tokens.ts";
import { isRecord, readString } from "../utils.ts";

// Pure trim planner. Rule bodies ported from Magic Compact prune.ts
// (679a2437), adapted from server-side part mutation to request-view part
// replacement: a tool call rides on an assistant message as a `tool-call`
// part, its result arrives as a separate `tool`-role message holding a
// `tool-result` part linked by call ID. Only completed calls (a tool-result
// exists with a non-error result) are candidates; pending, running, and
// errored calls, user messages, and system/preamble parts are never touched.
//
// The planner performs no I/O: the caller injects `resolveContentID`, which
// allocates (or reuses) the omission-store ID for a payload. Re-trimming is
// idempotent because the store returns the same ID for the same key, so the
// rebuilt replacement is byte-identical on every request.

export type OmissionRequest = {
  readonly key: string;
  readonly content: string;
  // BPE token count of the content, encoded once during the collection walk
  // so receipt accounting never re-encodes payloads.
  readonly tokens: number;
};

// Returns null when no ID can be allocated; the planner then leaves that
// part intact instead of emitting a dead reference.
export type ResolveContentID = (request: OmissionRequest) => string | null;

export type TrimOptions = {
  readonly keepRecentTurns: number;
};

export type PartReplacement = {
  readonly messageIndex: number;
  readonly partIndex: number;
  readonly part: unknown;
};

export type TrimPlan = {
  readonly replacements: readonly PartReplacement[];
};

const DEFAULT_OUTPUT_DESCRIPTION = "Output omitted due to a compaction operation.";

const DEFAULT_LIMIT = { words: 128, chars: 1024 } as const;
const TASK_OUTPUT_LIMIT = { words: 512, chars: 4096 } as const;
const BASH_COMMAND_CHAR_LIMIT = 1024;
const BASH_HEAD_CHAR_LIMIT = 512;

export function planTrim(
  messages: readonly RequestMessage[],
  options: TrimOptions,
  resolveContentID: ResolveContentID,
): TrimPlan {
  const batch = planTrimBatched(messages, options);
  const ids = new Map<string, string>();
  for (const request of batch.requests) {
    const contentID = resolveContentID(request);
    if (contentID !== null) {
      ids.set(request.key, contentID);
    }
  }
  return batch.build(ids);
}

// Single-walk planner. The collection walk evaluates every rule once,
// encoding each omitted payload exactly once; the returned build step maps
// resolved content IDs to part replacements without re-walking the messages.
// A null (or missing) ID leaves that part intact, matching planTrim.
export type TrimBatch = {
  readonly requests: readonly OmissionRequest[];
  readonly build: (ids: ReadonlyMap<string, string>) => TrimPlan;
};

export function planTrimBatched(
  messages: readonly RequestMessage[],
  options: TrimOptions,
): TrimBatch {
  const turns = computeTurns(messages);
  removeTrailingAssistantlessTurn(turns);

  // Keep-tail slicing ported from Magic Compact createTrimPlan: only calls
  // inside the planned turns are candidates; messages outside any turn are
  // never touched.
  const trimEndIndex = Math.max(0, turns.length - Math.max(0, options.keepRecentTurns));
  const trimmable = turns.slice(0, trimEndIndex);

  const calls = indexCalls(messages);
  const trimmableIndexes = new Set<number>();
  for (const turn of trimmable) {
    for (let index = turn.start; index <= turn.end; index++) {
      trimmableIndexes.add(index);
    }
  }

  const omissions: CallOmissions[] = [];
  for (const call of calls) {
    if (!trimmableIndexes.has(call.messageIndex)) {
      continue;
    }
    if (call.resultMessageIndex === null || call.resultIsError) {
      // Pending, running, or errored calls are never touched.
      continue;
    }
    const input = planInputOmission(call);
    const output = planOutputOmission(call);
    if (input !== null || output !== null) {
      omissions.push({ call, input, output });
    }
  }

  const requests: OmissionRequest[] = [];
  for (const omission of omissions) {
    if (omission.input !== null) {
      requests.push({
        key: omission.input.key,
        content: omission.input.content,
        tokens: omission.input.tokens,
      });
    }
    if (omission.output !== null && omission.output.kind === "stored") {
      requests.push({
        key: omission.output.key,
        content: omission.output.content,
        tokens: omission.output.tokens,
      });
    }
  }

  return { requests, build: ids => buildTrimPlan(messages, omissions, ids) };
}

type PendingInput = {
  readonly key: string;
  readonly content: string;
  readonly tokens: number;
  readonly part: (contentID: string) => unknown;
  readonly outputNotice: (contentID: string) => string;
};

type CallOmissions = {
  readonly call: CallIndex;
  readonly input: PendingInput | null;
  readonly output: PendingOutput | null;
};

// --- Turn grouping (ported from Magic Compact plan.ts) ---

type TurnRange = {
  start: number;
  end: number;
  hasAssistant: boolean;
};

function computeTurns(messages: readonly RequestMessage[]): TurnRange[] {
  const turns: TurnRange[] = [];
  let current: TurnRange | null = null;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }

    if (message.role === "user") {
      if (current?.hasAssistant) {
        current = null;
      }
      if (current === null) {
        current = { start: index, end: index, hasAssistant: false };
        turns.push(current);
      }
      current.end = index;
      continue;
    }

    if ((message.role === "assistant" || message.role === "tool") && current !== null) {
      if (message.role === "assistant") {
        current.hasAssistant = true;
      }
      current.end = index;
    }
  }

  return turns;
}

function removeTrailingAssistantlessTurn(turns: TurnRange[]): void {
  const last = turns.at(-1);
  if (last !== undefined && !last.hasAssistant) {
    // The trailing user-only turn may be an unanswered request; it is neither
    // trimmed nor counted against the protected tail.
    turns.pop();
  }
}

// --- Call indexing ---

type CallLocation = {
  readonly messageIndex: number;
  readonly partIndex: number;
  readonly callID: string;
  readonly toolName: string;
  readonly input: unknown;
};

type CallIndex = CallLocation & {
  readonly resultMessageIndex: number | null;
  readonly resultPartIndex: number | null;
  readonly resultValue: unknown;
  readonly resultIsError: boolean;
};

function indexCalls(messages: readonly RequestMessage[]): CallIndex[] {
  const results = new Map<string, { messageIndex: number; partIndex: number }>();

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const content = messages[messageIndex]?.content ?? [];
    for (let partIndex = 0; partIndex < content.length; partIndex++) {
      const part = content[partIndex];
      if (isToolResultPart(part)) {
        results.set(part.id, { messageIndex, partIndex });
      }
    }
  }

  const calls: CallIndex[] = [];
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const content = messages[messageIndex]?.content ?? [];
    for (let partIndex = 0; partIndex < content.length; partIndex++) {
      const part = content[partIndex];
      if (!isToolCallPart(part)) {
        continue;
      }
      const result = results.get(part.id) ?? null;
      const resultPart = result === null ? null : contentAt(messages, result);
      calls.push({
        messageIndex,
        partIndex,
        callID: part.id,
        toolName: part.name,
        input: part.input,
        resultMessageIndex: result?.messageIndex ?? null,
        resultPartIndex: result?.partIndex ?? null,
        resultValue: isToolResultPart(resultPart) ? resultPart.result.value : null,
        resultIsError: isToolResultPart(resultPart) && resultPart.result.type === "error",
      });
    }
  }

  return calls;
}

function contentAt(
  messages: readonly RequestMessage[],
  location: { messageIndex: number; partIndex: number },
): unknown {
  return messages[location.messageIndex]?.content[location.partIndex];
}

// --- Rule evaluation (ported from Magic Compact prune.ts) ---

// Second phase: map resolved content IDs to part replacements. A null or
// missing ID leaves that part intact instead of emitting a dead reference,
// matching the previous two-pass behavior exactly (input and output are
// omitted independently).
function buildTrimPlan(
  messages: readonly RequestMessage[],
  omissions: readonly CallOmissions[],
  ids: ReadonlyMap<string, string>,
): TrimPlan {
  const replacements: PartReplacement[] = [];

  for (const { call, input, output } of omissions) {
    let inputNotice: string | null = null;
    if (input !== null) {
      const contentID = ids.get(input.key) ?? null;
      if (contentID !== null) {
        replacements.push({
          messageIndex: call.messageIndex,
          partIndex: call.partIndex,
          part: input.part(contentID),
        });
        inputNotice = input.outputNotice(contentID);
      }
    }

    if (call.resultMessageIndex === null || call.resultPartIndex === null) {
      continue;
    }

    const originalOutput = stringifyToolContent(call.resultValue);
    let nextOutput = originalOutput;
    let replaced = false;

    if (output !== null) {
      if (output.kind === "direct") {
        nextOutput = output.text;
        replaced = true;
      } else {
        const contentID = ids.get(output.key) ?? null;
        if (contentID !== null) {
          nextOutput = output.text(contentID);
          replaced = true;
        }
      }
    }

    if (inputNotice !== null) {
      nextOutput = `${inputNotice}\n\n${nextOutput}`;
      replaced = true;
    }

    if (replaced) {
      replacements.push({
        messageIndex: call.resultMessageIndex,
        partIndex: call.resultPartIndex,
        part: {
          ...(contentAt(messages, {
            messageIndex: call.resultMessageIndex,
            partIndex: call.resultPartIndex,
          }) as object),
          result: { type: "text", value: nextOutput },
        },
      });
    }
  }

  return { replacements };
}

function planInputOmission(call: CallIndex): PendingInput | null {
  if (!isRecord(call.input)) {
    return null;
  }

  const input = call.input;
  const originalPart = { type: "tool-call", id: call.callID, name: call.toolName, input };

  if (call.toolName === "write") {
    const content = readString(input, "content");
    if (content !== null && exceeds(content, DEFAULT_LIMIT)) {
      return {
        key: `${call.callID}:input`,
        content,
        tokens: countTextTokens(content),
        part: () => ({ ...originalPart, input: { ...input, content: "[Omitted]" } }),
        outputNotice: contentID =>
          inputOmissionNotice(
            "File write contents omitted due to a compaction operation. If necessary, reread file to see current contents.",
            content.length,
            contentID,
          ),
      };
    }
  }

  if (call.toolName === "apply_patch") {
    const content = readString(input, "patchText");
    if (content !== null && exceeds(content, DEFAULT_LIMIT)) {
      return {
        key: `${call.callID}:input`,
        content,
        tokens: countTextTokens(content),
        part: () => ({ ...originalPart, input: { ...input, patchText: "[Omitted]" } }),
        outputNotice: contentID =>
          inputOmissionNotice(
            "Patch text omitted due to compaction operation. If necessary, reread files to see current contents.",
            content.length,
            contentID,
          ),
      };
    }
  }

  if (call.toolName === "bash") {
    const content = readString(input, "command");
    if (content !== null && content.length > BASH_COMMAND_CHAR_LIMIT) {
      const truncated = `${content.slice(0, BASH_HEAD_CHAR_LIMIT)}\n[REST OF COMMAND TRUNCATED]`;
      return {
        key: `${call.callID}:input`,
        content,
        tokens: countTextTokens(content),
        part: () => ({ ...originalPart, input: { ...input, command: truncated } }),
        outputNotice: contentID =>
          inputOmissionNotice(
            "Bash command truncated due to compaction operation.",
            content.length,
            contentID,
          ),
      };
    }
  }

  if (call.toolName === "edit") {
    const oldString = readString(input, "oldString");
    const newString = readString(input, "newString");
    if (oldString !== null && newString !== null) {
      const combined = `${oldString}\n${newString}`;
      if (exceeds(combined, DEFAULT_LIMIT)) {
        return {
          key: `${call.callID}:input`,
          content: combined,
          tokens: countTextTokens(combined),
          part: () => ({
            ...originalPart,
            input: { ...input, oldString: "[Omitted]", newString: "[Omitted]" },
          }),
          outputNotice: contentID =>
            inputOmissionNotice(
              "File edit oldString and newString omitted due to compaction operation. If necessary, reread file to see current contents.",
              combined.length,
              contentID,
            ),
        };
      }
    }
  }

  return null;
}

type PendingOutput =
  | {
      readonly kind: "stored";
      readonly key: string;
      readonly content: string;
      readonly tokens: number;
      readonly text: (contentID: string) => string;
    }
  | { readonly kind: "direct"; readonly text: string };

function planOutputOmission(call: CallIndex): PendingOutput | null {
  const output = stringifyToolContent(call.resultValue);

  if (call.toolName === "question") {
    // Explicit user decisions are always preserved.
    return null;
  }

  if (call.toolName === "todowrite") {
    // Redundant; discarded without caching.
    return { kind: "direct", text: "Successfully updated todos." };
  }

  if (call.toolName === "skill") {
    // Reloadable; discarded without caching.
    return {
      kind: "direct",
      text: "Skill contents omitted due to compaction operation. If necessary, recall skill.",
    };
  }

  if (call.toolName === "read") {
    // File contents are reloadable; always omitted.
    return {
      kind: "stored",
      key: `${call.callID}:output`,
      content: output,
      tokens: countTextTokens(output),
      text: contentID =>
        outputOmissionNotice(
          "Stale read contents omitted due to compaction operation. If necessary, reread to see current contents.",
          output.length,
          contentID,
        ),
    };
  }

  if (call.toolName === "task") {
    if (exceeds(output, TASK_OUTPUT_LIMIT)) {
      return {
        kind: "stored",
        key: `${call.callID}:output`,
        content: output,
        tokens: countTextTokens(output),
        text: contentID =>
          outputOmissionNotice(
            "Task output omitted due to a compaction operation. If necessary, reread output via the operator:read_omitted tool.",
            output.length,
            contentID,
          ),
      };
    }
    return null;
  }

  if (!exceeds(output, DEFAULT_LIMIT)) {
    return null;
  }

  return {
    kind: "stored",
    key: `${call.callID}:output`,
    content: output,
    tokens: countTextTokens(output),
    text: contentID => outputOmissionNotice(DEFAULT_OUTPUT_DESCRIPTION, output.length, contentID),
  };
}

// --- Helpers ---

function exceeds(text: string, limit: { words: number; chars: number }): boolean {
  if (text.length > limit.chars) {
    return true;
  }
  return countWords(text, limit.words) > limit.words;
}

// Counts whitespace-separated runs like trim().split(/\s+/).length, but
// stops past maxWords instead of materializing every word of a huge output.
const WORD_SEPARATOR = /\s/;

function countWords(text: string, maxWords: number): number {
  let count = 0;
  let index = 0;
  while (index < text.length && count <= maxWords) {
    while (index < text.length && WORD_SEPARATOR.test(text[index] ?? "")) {
      index += 1;
    }
    if (index >= text.length) {
      break;
    }
    count += 1;
    while (index < text.length && !WORD_SEPARATOR.test(text[index] ?? "")) {
      index += 1;
    }
  }
  return count;
}
