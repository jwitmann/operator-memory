// Brain-update activity measurement: deterministic, harness-agnostic
// counting of completed tool work since the last Brain fingerprint move.
// This module never reads the Brain, never writes it, and never decides
// what counts as durable knowledge. Callers combine it with the existing
// preamble fingerprint; the configured threshold stays with the caller.
import { isToolCallPart, isToolResultPart, type RequestMessage } from "./context/tokens.ts";

export type BrainUpdateActivityState = {
  // Null until the first observation for this session. The first fingerprint
  // seeds the baseline from the calls already in history, so measuring work
  // cannot fire on activity that predates it.
  readonly fingerprint: string | null;
  // Completed calls observed when the current fingerprint baseline started.
  readonly baselineCompletedCalls: number;
  // Whether this fingerprint era already reminded once. There is no re-arm:
  // later calls stay quiet until the Brain moves.
  readonly reminded: boolean;
};

export const EMPTY_BRAIN_UPDATE_ACTIVITY_STATE: BrainUpdateActivityState = {
  fingerprint: null,
  baselineCompletedCalls: 0,
  reminded: false,
};

export type BrainUpdateActivityDecision = {
  readonly state: BrainUpdateActivityState;
  readonly completedSinceBaseline: number;
  readonly crossed: boolean;
};

// One completed unit of tool work: a valid tool call with a matching
// completed result. Error results still count because a failure can produce
// a durable lesson; pending, running, or unpaired calls do not. Calls under
// Operator's own namespace are helper I/O, not agent work, and are excluded.
export function countCompletedToolCalls(messages: readonly RequestMessage[]): number {
  const completedIDs = new Set<string>();
  for (const message of messages) {
    for (const part of message.content) {
      if (isToolResultPart(part) && !isOperatorTool(part)) {
        completedIDs.add(part.id);
      }
    }
  }

  const completedCallIDs = new Set<string>();
  for (const message of messages) {
    for (const part of message.content) {
      if (isToolCallPart(part) && !isOperatorTool(part) && completedIDs.has(part.id)) {
        completedCallIDs.add(part.id);
      }
    }
  }
  return completedCallIDs.size;
}

// Advances one fingerprint era. Callers pass a validated positive-integer
// threshold; a changed fingerprint restarts measurement because the Brain
// itself moved. A shrinking history restarts the baseline because compaction
// or continuation replaced the measured messages. Both cases stay quiet:
// only genuinely new work since the current baseline can cross.
export function evaluateBrainUpdateActivity(
  state: BrainUpdateActivityState,
  fingerprint: string,
  completedCalls: number,
  threshold: number,
): BrainUpdateActivityDecision {
  if (state.fingerprint === null || state.fingerprint !== fingerprint) {
    const reset: BrainUpdateActivityState = {
      fingerprint,
      baselineCompletedCalls: completedCalls,
      reminded: false,
    };
    return { state: reset, completedSinceBaseline: 0, crossed: false };
  }

  const baseline =
    completedCalls < state.baselineCompletedCalls ? completedCalls : state.baselineCompletedCalls;
  const sinceBaseline = completedCalls - baseline;
  const crossed = sinceBaseline >= threshold && !state.reminded;
  const next: BrainUpdateActivityState = {
    fingerprint,
    baselineCompletedCalls: baseline,
    reminded: state.reminded || crossed,
  };
  return { state: next, completedSinceBaseline: sinceBaseline, crossed };
}

function isOperatorTool(part: { readonly namespace?: unknown }): boolean {
  return part.namespace === "operator";
}
