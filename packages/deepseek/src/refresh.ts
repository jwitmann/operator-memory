import { join } from "node:path";
import { appendReceipt } from "@aerovato/operator-core/context/receipts";
import {
  fingerprintPreamble,
  isCacheCold,
  REFRESH_FLOOR_TOKENS,
} from "@aerovato/operator-core/preamble-refresh";
import type { PreambleRefreshConfig } from "./config.ts";
import {
  reportReceiptFailureOnce,
  type DshDeps,
  type DshRuntime,
  isDshStale,
  sessionRuntime,
} from "./runtime.ts";

// Cache-aware preamble refresh, evaluated inside the assemble hook after the
// cached preamble loads. DSH-native differences from the opencode port:
// - The cold-cache check reads the host's provider cache usage observed on
//   assistant/message, not a step-event payload.
// - The estimate floor reads the host-measured `lastEstimate` from
//   tokenMeter instead of running a tokenizer pass over the request.
// A fingerprint move means the Brain changed on disk since the last render.
// A post-compaction move skips both gates: compaction flushed the cache by
// construction.

export type RefreshDeps = Pick<
  DshDeps,
  "stateDirectory" | "isBrainAvailable" | "isCurrent" | "reportReceiptFailure"
> & {
  readonly config: PreambleRefreshConfig;
};

export type RefreshOutcome =
  | { readonly refreshed: true; readonly content: string }
  | { readonly refreshed: false; readonly failed: boolean };

export async function maybeRefreshPreamble(
  deps: RefreshDeps,
  runtime: DshRuntime,
  sessionId: string,
  projectDirectory: string,
  homeDirectory: string,
  reload: () => Promise<{ ok: boolean; content: string }>,
): Promise<RefreshOutcome> {
  const idle: RefreshOutcome = { refreshed: false, failed: false };
  if (!deps.config.enabled || isDshStale(deps) || !deps.isBrainAvailable(sessionId)) return idle;
  const session = sessionRuntime(runtime, sessionId);

  const fingerprinted = await fingerprintPreamble(projectDirectory, homeDirectory);
  if (!fingerprinted.ok) return idle;
  const fingerprint = fingerprinted.value;

  const postCompaction = session.preambleRefreshPending;
  session.preambleRefreshPending = false;
  if (session.preambleFingerprint === null) {
    session.preambleFingerprint = fingerprint;
    return idle;
  }
  if (fingerprint === session.preambleFingerprint) return idle;

  if (!postCompaction) {
    if (!isCacheCold({ cacheRead: session.lastStepCacheRead ?? 0 })) {
      return idle;
    }
    if ((session.lastEstimate ?? 0) < REFRESH_FLOOR_TOKENS) return idle;
  }

  const rendered = await reload();
  if (!rendered.ok) return { refreshed: false, failed: true };

  session.preambleFingerprint = fingerprint;
  const written = await appendReceipt(join(deps.stateDirectory, "context-log"), sessionId, {
    kind: "refresh",
    reason: postCompaction ? "post-compaction" : "brain-changed",
    at: new Date().toISOString(),
  });
  if (!written.ok) reportReceiptFailureOnce(runtime, deps, sessionId, "refresh");
  return { refreshed: true, content: rendered.content };
}
