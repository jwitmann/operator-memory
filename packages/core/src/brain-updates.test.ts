import { expect, test } from "vitest";

import {
  countCompletedToolCalls,
  EMPTY_BRAIN_UPDATE_ACTIVITY_STATE,
  evaluateBrainUpdateActivity,
} from "./brain-updates.ts";
import type { RequestMessage } from "./context/tokens.ts";

type Part = Record<string, unknown>;

function toolCall(id: string, options?: { readonly namespace?: string }): Part {
  return {
    type: "tool-call",
    id,
    name: "read",
    ...(options?.namespace === undefined ? {} : { namespace: options.namespace }),
    input: { filePath: `/${id}.txt` },
  };
}

function toolResult(id: string, options?: { readonly namespace?: string }): Part {
  return {
    type: "tool-result",
    id,
    name: "read",
    ...(options?.namespace === undefined ? {} : { namespace: options.namespace }),
    result: { type: "text", value: `content ${id}` },
  };
}

function errorResult(id: string): Part {
  return {
    type: "tool-result",
    id,
    name: "read",
    result: { type: "error", value: `failed ${id}` },
  };
}

function historyFor(ids: readonly string[]): RequestMessage[] {
  return [
    { role: "assistant", content: ids.map(id => toolCall(id)) },
    { role: "tool", content: ids.map(id => toolResult(id)) },
  ];
}

function sequentialHistory(count: number): RequestMessage[] {
  return historyFor(Array.from({ length: count }, (_, index) => `toolu_${index}`));
}

const THRESHOLD = 25;

test("counts completed non-operator calls once per call ID", () => {
  const messages: RequestMessage[] = [
    {
      role: "assistant",
      content: [
        toolCall("completed"),
        toolCall("completed"),
        toolCall("pending"),
        toolCall("internal", { namespace: "operator" }),
        toolCall("failed"),
        { type: "tool-call", id: 7, name: "read", input: {} },
      ],
    },
    {
      role: "tool",
      content: [
        toolResult("completed"),
        toolResult("internal", { namespace: "operator" }),
        errorResult("failed"),
        { type: "tool-result", id: "malformed", name: "read", result: { type: "text" } },
      ],
    },
  ];

  expect(countCompletedToolCalls(messages)).toBe(2);
});

test("the first observation seeds the baseline without firing", () => {
  const baseline = sequentialHistory(100);
  const decision = evaluateBrainUpdateActivity(
    EMPTY_BRAIN_UPDATE_ACTIVITY_STATE,
    "fingerprint-one",
    countCompletedToolCalls(baseline),
    THRESHOLD,
  );

  expect(decision.crossed).toBe(false);
  expect(decision.completedSinceBaseline).toBe(0);
  expect(decision.state).toEqual({
    fingerprint: "fingerprint-one",
    baselineCompletedCalls: 100,
    reminded: false,
  });
});

test("stays quiet below the threshold", () => {
  const seeded = evaluateBrainUpdateActivity(
    EMPTY_BRAIN_UPDATE_ACTIVITY_STATE,
    "fingerprint-one",
    countCompletedToolCalls(sequentialHistory(100)),
    THRESHOLD,
  ).state;

  const below = evaluateBrainUpdateActivity(
    seeded,
    "fingerprint-one",
    countCompletedToolCalls(sequentialHistory(124)),
    THRESHOLD,
  );

  expect(below.crossed).toBe(false);
  expect(below.completedSinceBaseline).toBe(24);
});

test("reports the crossing once, then stays quiet", () => {
  const seeded = evaluateBrainUpdateActivity(
    EMPTY_BRAIN_UPDATE_ACTIVITY_STATE,
    "fingerprint-one",
    countCompletedToolCalls(sequentialHistory(100)),
    THRESHOLD,
  ).state;

  const crossed = evaluateBrainUpdateActivity(
    seeded,
    "fingerprint-one",
    countCompletedToolCalls(sequentialHistory(125)),
    THRESHOLD,
  );
  expect(crossed.crossed).toBe(true);
  expect(crossed.completedSinceBaseline).toBe(25);

  const repeated = evaluateBrainUpdateActivity(
    crossed.state,
    "fingerprint-one",
    countCompletedToolCalls(sequentialHistory(140)),
    THRESHOLD,
  );
  expect(repeated.crossed).toBe(false);
  expect(repeated.state.reminded).toBe(true);
});

test("a fingerprint move resets the baseline without firing", () => {
  const seeded = evaluateBrainUpdateActivity(
    EMPTY_BRAIN_UPDATE_ACTIVITY_STATE,
    "fingerprint-one",
    countCompletedToolCalls(sequentialHistory(100)),
    THRESHOLD,
  ).state;
  const crossed = evaluateBrainUpdateActivity(
    seeded,
    "fingerprint-one",
    countCompletedToolCalls(sequentialHistory(125)),
    THRESHOLD,
  ).state;

  const current = sequentialHistory(140);
  const reset = evaluateBrainUpdateActivity(
    crossed,
    "fingerprint-two",
    countCompletedToolCalls(current),
    THRESHOLD,
  );

  expect(reset.crossed).toBe(false);
  expect(reset.completedSinceBaseline).toBe(0);
  expect(reset.state).toEqual({
    fingerprint: "fingerprint-two",
    baselineCompletedCalls: 140,
    reminded: false,
  });
});

test("shrinking history rebaselines without firing", () => {
  const seeded = evaluateBrainUpdateActivity(
    EMPTY_BRAIN_UPDATE_ACTIVITY_STATE,
    "fingerprint-one",
    countCompletedToolCalls(sequentialHistory(100)),
    THRESHOLD,
  ).state;

  const shrunk = evaluateBrainUpdateActivity(
    seeded,
    "fingerprint-one",
    countCompletedToolCalls(sequentialHistory(12)),
    THRESHOLD,
  );

  expect(shrunk.crossed).toBe(false);
  expect(shrunk.completedSinceBaseline).toBe(0);
  expect(shrunk.state.baselineCompletedCalls).toBe(12);
});
