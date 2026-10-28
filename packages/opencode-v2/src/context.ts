import { appendReceipt, type TrimReceipt } from "@aerovato/operator-core/context/receipts";
import { storeOmissions } from "@aerovato/operator-core/context/store";
import { evaluateTrigger, exceedsThresholds } from "@aerovato/operator-core/context/triggers";
import { planTrimBatched, type TrimPlan } from "@aerovato/operator-core/context/trim";
import { estimateContextTokens, type RequestMessage } from "@aerovato/operator-core/context/tokens";
import type { Context } from "@opencode/plugin/promise/plugin";
import { join } from "node:path";

import { toTriggerConfig } from "./context-config.ts";
import {
  ensureRefusalReceipt,
  ensureSessionHydrated,
  isContextStale,
  reportReceiptFailureOnce,
  resolveWindowTokens,
  sessionRuntime,
  type ContextManagementDeps,
  type ContextRuntime,
} from "./runtime.ts";

// Registers the session "context" hook: estimate the request, evaluate the
// ratio and hard-cap triggers, apply the trim plan as transient part
// replacements, write the receipt, and request compaction when the estimate
// is still over threshold after trimming. All logic lives in core; this
// module only wires host inputs to core functions.

export function registerContextHook(
  context: Context,
  deps: ContextManagementDeps,
  runtime: ContextRuntime,
): void {
  context.session.hook("context", async event => {
    if (isContextStale(deps)) {
      return;
    }
    const sessionID = event.sessionID;
    const config = deps.config;

    await ensureSessionHydrated(deps.stateDirectory, runtime, sessionID);
    if (!deps.isBrainAvailable(sessionID)) {
      await ensureRefusalReceipt(deps.stateDirectory, runtime, sessionID, deps);
      return;
    }
    const session = sessionRuntime(runtime, sessionID);

    const estimatedTokens = estimateContextTokens(session.estimator, event.messages);
    const windowTokens = await resolveWindowTokens(context, session, event.model);
    session.lastEstimate = estimatedTokens;
    session.lastMessageCount = event.messages.length;

    // Trim applies on every over-threshold request: hook mutations are
    // transient, so each request re-applies the same trim deterministically.
    // Only the receipt and the compaction request are deduplicated.
    if (!exceedsThresholds(estimatedTokens, windowTokens ?? 0, config)) {
      return;
    }

    const trimResult = await trimRequest(sessionID, event.messages, deps);
    for (const replacement of trimResult.plan.replacements) {
      const message = event.messages[replacement.messageIndex];
      if (message !== undefined) {
        (message.content as unknown[])[replacement.partIndex] = replacement.part;
      }
    }

    // A reload may have landed during the awaits above: re-check before
    // recording dedup state or writing receipts in the shared runtime.
    if (isContextStale(deps)) {
      return;
    }

    const decision = evaluateTrigger(
      session.triggerState,
      "request",
      estimatedTokens,
      windowTokens ?? 0,
      toTriggerConfig(config),
    );
    session.triggerState = decision.state;
    // The request path only produces ratio and hard-cap triggers; the
    // task-complete trigger belongs to the event path.
    if (decision.fire === null || decision.fire === "task-complete") {
      return;
    }
    const fired = decision.fire;

    const receipt: TrimReceipt = {
      kind: "trim",
      trigger: fired,
      at: new Date().toISOString(),
      tokens: estimatedTokens,
      removed: trimResult.removedTokens,
      omissions: trimResult.omissionCount,
    };
    const written = await appendReceipt(
      join(deps.stateDirectory, "context-log"),
      sessionID,
      receipt,
    );
    if (!written.ok) {
      reportReceiptFailureOnce(runtime, deps, sessionID, "trim");
    }

    const estimateAfterTrim = estimatedTokens - trimResult.removedTokens;
    if (exceedsThresholds(estimateAfterTrim, windowTokens ?? 0, config)) {
      deps.requestCompaction(sessionID, fired);
    }
  });
}

type TrimOutcome = {
  readonly plan: TrimPlan;
  readonly removedTokens: number;
  readonly omissionCount: number;
};

// Single collection walk plus one batch store call: one index read, one
// append, each payload stringified and encoded exactly once. The build step
// maps resolved IDs to replacements without re-walking the messages.
async function trimRequest(
  sessionID: string,
  messages: readonly RequestMessage[],
  deps: ContextManagementDeps,
): Promise<TrimOutcome> {
  const batch = planTrimBatched(messages, { keepRecentTurns: deps.config.keepRecentTurns });

  const omittedRoot = join(deps.stateDirectory, "omitted");
  const stored = await storeOmissions(omittedRoot, sessionID, batch.requests);

  // The store is best-effort: payloads that cannot be persisted stay in
  // context instead of failing the request. A failed whole-batch store
  // resolves nothing, so the build leaves every part intact.
  const ids = stored.ok ? stored.value.ids : new Map<string, string>();
  const fresh = stored.ok ? stored.value.stored : new Set<string>();

  let omissionCount = 0;
  let removedTokens = 0;
  for (const request of batch.requests) {
    if (fresh.has(request.key)) {
      omissionCount += 1;
      removedTokens += request.tokens;
    }
  }

  return { plan: batch.build(ids), removedTokens, omissionCount };
}
