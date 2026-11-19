import { buildCompactionPrompt } from "@aerovato/operator-core/context/compaction";
import { appendReceipt, type CompactReceipt } from "@aerovato/operator-core/context/receipts";
import { estimateContextTokens, type RequestMessage } from "@aerovato/operator-core/context/tokens";
import type { Context } from "@opencode/plugin/promise/plugin";
import { join } from "node:path";

import {
  compileCompaction,
  DEFAULT_VCC_KEEP_MESSAGES,
  resolveVccCompilerConfig,
} from "./compaction-compiler.ts";
import { rememberSnapshot } from "./compaction-snapshot.ts";

import {
  ensureRefusalReceipt,
  ensureSessionHydrated,
  isContextStale,
  PENDING_CAUSE_TTL_MS,
  reportReceiptFailureOnce,
  sessionRuntime,
  type ContextManagementDeps,
  type ContextRuntime,
} from "./runtime.ts";

// Deterministic instant-compaction first, shaped model compaction as
// fallback. The hook compiles the request messages with the VCC region
// compiler and, when the framed checkpoint is smaller than the request and a
// keepID tail pointer exists, persists it verbatim via `event.result` with
// no model call (proven live on v2.3.2 — see the opencode-vcc-port probe,
// `probe-results/compaction-result-override.jsonl`). Otherwise the hook
// shapes the host compaction request with Brain-referencing instructions on
// the system prompt and the host summarizes. Overriding via `result`
// without `metadata.keepID` substitutes a content-free note for the history
// (observed live on v2.0.22); excluding a "protected tail" from the request
// still preserves nothing: hidden from the summarizer, it drops from view
// (v2.0.22 finding, not re-probed).

export const DEFAULT_BRAIN_PATHS = ["~/.operator/user", ".operator", ".operator-shared"];

export type CompactionHookDeps = Omit<ContextManagementDeps, "requestCompaction"> & {
  readonly brainPaths: readonly string[];
  // Preamble refresh runs its own opt-in switch; the compaction hook only
  // arms the post-compaction re-render when refresh is enabled.
  readonly refreshEnabled: boolean;
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
      await ensureRefusalReceipt(deps.stateDirectory, runtime, sessionID, deps);
      return;
    }
    const session = sessionRuntime(runtime, sessionID);
    // The host honored a compaction attempt (ours or its own): the failure
    // backoff served its purpose, and a later failure re-arms it from
    // scratch. The ended event clears independently for attempts that never
    // reach this hook.
    session.lastCompactionFailure = null;
    if (deps.refreshEnabled) {
      // Compaction flushed the cache, so the next preamble check refreshes
      // on a fingerprint move without the cold-cache and floor gates.
      session.preambleRefreshPending = true;
    }

    const estimatedTokens = estimateContextTokens(
      session.estimator,
      event.messages as readonly RequestMessage[],
    );

    // The cause is recorded by our own compaction requesters; a host-initiated
    // compaction carries none and is labeled manual, as is a stale entry from
    // a requested-but-never-executed compaction past its TTL.
    const pending = runtime.pendingCauses.get(sessionID);
    const cause =
      pending !== undefined && Date.now() - pending.at <= PENDING_CAUSE_TTL_MS
        ? pending.cause
        : "manual";
    runtime.pendingCauses.delete(sessionID);

    // Deterministic override first: when the compiler produces a smaller
    // checkpoint with a keepID tail pointer, persist it verbatim with no
    // model call. Otherwise fall back to shaping the host's own summary.
    const vcc = compileCompaction(
      event.messages as readonly unknown[],
      resolveVccCompilerConfig(),
      DEFAULT_VCC_KEEP_MESSAGES,
      Math.max(0, estimatedTokens),
    );
    const receipt: CompactReceipt =
      vcc === undefined
        ? {
            kind: "compact",
            trigger: cause,
            at: new Date().toISOString(),
            summarized: Math.max(0, estimatedTokens),
            engine: "shaped",
            summaryTokens: null,
          }
        : {
            kind: "compact",
            trigger: cause,
            at: new Date().toISOString(),
            summarized: Math.max(0, estimatedTokens),
            engine: "vcc",
            summaryTokens: vcc.summaryTokens,
          };
    if (vcc !== undefined) {
      event.result = { summary: vcc.summary, metadata: { keepID: vcc.keepID } };
    } else {
      event.system.push({
        type: "text",
        text: buildCompactionPrompt({ brainPaths: deps.brainPaths }),
      });
    }
    const written = await appendReceipt(
      join(deps.stateDirectory, "context-log"),
      sessionID,
      receipt,
    );
    if (!written.ok) {
      reportReceiptFailureOnce(runtime, deps, sessionID, "compact");
    }
    // Snapshot refresh: the context hook maintains the snapshot on every
    // turn, and this call is growth-guarded, so an unchanged conversation
    // skips the rewrite at zero I/O cost. It runs unconditionally (rather
    // than skipping when the guard is non-null, as the oracle does) so a
    // failed per-turn write heals here, at the moment freshness matters
    // most. Best-effort like the rest: a failed write is never fatal —
    // the tools reply that recall is unavailable. A reload may have landed
    // during the receipt write above: re-check before the disk write, and
    // again before touching shared state.
    if (isContextStale(deps)) {
      return;
    }
    const remembered = await rememberSnapshot(
      join(deps.stateDirectory, "context-snapshot"),
      sessionID,
      event.messages as readonly unknown[],
      new Date().toISOString(),
      session.snapshotSeen,
    );
    if (isContextStale(deps)) {
      return;
    }
    session.snapshotSeen = remembered.seen;
  });
}
