import { buildCompactionPrompt } from "@aerovato/operator-core/context/compaction";
import { appendReceipt, type CompactReceipt } from "@aerovato/operator-core/context/receipts";
import { estimateContextTokens, type RequestMessage } from "@aerovato/operator-core/context/tokens";
import type { Context } from "@opencode/plugin/promise/plugin";
import { join } from "node:path";

import {
  ensureRefusalReceipt,
  ensureSessionHydrated,
  isContextStale,
  PENDING_CAUSE_TTL_MS,
  sessionRuntime,
  type ContextManagementDeps,
  type ContextRuntime,
} from "./runtime.ts";

// Shapes the host compaction request with Brain-referencing instructions on
// the system prompt. Messages go through intact: the host replaces the
// request-view history with exactly the summary it produces. Overriding via
// `result` without `metadata.keepID` substitutes a content-free note for the
// history (observed live on v2.0.22); with `metadata.keepID` the host
// persists the supplied summary verbatim, rebuilds the tail from the kept ID,
// and makes no model call (proven live on v2.3.2 — see the opencode-vcc-port
// probe, `probe-results/compaction-result-override.jsonl`). Excluding a
// "protected tail" from the request still preserves nothing: hidden from the
// summarizer, it drops from view (v2.0.22 finding, not re-probed).

export const DEFAULT_BRAIN_PATHS = ["~/.operator/user", ".operator", ".operator-shared"];

export type CompactionHookDeps = Omit<ContextManagementDeps, "requestCompaction"> & {
  readonly brainPaths: readonly string[];
};

export function registerCompactionHook(
  context: Context,
  deps: CompactionHookDeps,
  runtime: ContextRuntime,
): void {
  context.session.hook("compaction", async event => {
    if (isContextStale(deps)) {
      return;
    }
    const sessionID = event.sessionID;
    await ensureSessionHydrated(deps.stateDirectory, runtime, sessionID);
    // A reload may have landed during hydration: re-check before consuming
    // the pending cause or writing the receipt.
    if (isContextStale(deps)) {
      return;
    }
    if (!deps.isBrainAvailable(sessionID)) {
      await ensureRefusalReceipt(deps.stateDirectory, runtime, sessionID);
      return;
    }
    const session = sessionRuntime(runtime, sessionID);
    // The host honored a compaction attempt (ours or its own): the failure
    // backoff served its purpose, and a later failure re-arms it from
    // scratch. The ended event clears independently for attempts that never
    // reach this hook.
    session.lastCompactionFailure = null;

    const estimatedTokens = estimateContextTokens(
      session.estimator,
      event.messages as readonly RequestMessage[],
    );

    event.system.push({
      type: "text",
      text: buildCompactionPrompt({ brainPaths: deps.brainPaths }),
    });

    // The cause is recorded by our own compaction requesters; a host-initiated
    // compaction carries none and is labeled manual, as is a stale entry from
    // a requested-but-never-executed compaction past its TTL.
    const pending = runtime.pendingCauses.get(sessionID);
    const cause =
      pending !== undefined && Date.now() - pending.at <= PENDING_CAUSE_TTL_MS
        ? pending.cause
        : "manual";
    runtime.pendingCauses.delete(sessionID);

    const receipt: CompactReceipt = {
      kind: "compact",
      trigger: cause,
      at: new Date().toISOString(),
      summarized: Math.max(0, estimatedTokens),
    };
    await appendReceipt(join(deps.stateDirectory, "context-log"), sessionID, receipt);
  });
}
