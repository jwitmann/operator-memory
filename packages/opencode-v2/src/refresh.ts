import {
  fingerprintPreamble,
  isCacheCold,
  REFRESH_FLOOR_TOKENS,
} from "@aerovato/operator-core/preamble-refresh";
import { appendReceipt, type RefreshReceipt } from "@aerovato/operator-core/context/receipts";
import { join } from "node:path";

import { loadPreamble, type LoadPreambleOptions } from "./preamble.ts";
import {
  isContextStale,
  sessionRuntime,
  type ContextManagementDeps,
  type ContextRuntime,
} from "./runtime.ts";
import type { PreambleRefreshConfig } from "./refresh-config.ts";

// Cache-aware preamble refresh, evaluated per request inside the preamble
// hook after the cached preamble loads. A fingerprint move means the Brain
// changed on disk since the last render; the refresh still waits for a
// cold provider cache (prefix rewrites invalidate the cache) and a
// non-trivial estimate, unless a compaction just flushed the cache anyway.

export type RefreshDeps = Pick<
  ContextManagementDeps,
  "stateDirectory" | "isBrainAvailable" | "isCurrent"
> & {
  readonly config: PreambleRefreshConfig;
};

export type RefreshOutcome =
  | { readonly refreshed: true; readonly content: string }
  | { readonly refreshed: false; readonly failed: boolean };

export async function maybeRefreshPreamble(
  deps: RefreshDeps,
  runtime: ContextRuntime,
  sessionID: string,
  projectDirectory: string,
  homeDirectory: string,
  cache: LoadPreambleOptions["cache"],
): Promise<RefreshOutcome> {
  const idle: RefreshOutcome = { refreshed: false, failed: false };
  if (!deps.config.enabled || isContextStale(deps) || !deps.isBrainAvailable(sessionID)) {
    return idle;
  }
  const session = sessionRuntime(runtime, sessionID);

  const fingerprinted = await fingerprintPreamble(projectDirectory, homeDirectory);
  if (!fingerprinted.ok) {
    // Cannot tell whether anything changed; skip silently and retry next
    // request rather than re-rendering blindly.
    return idle;
  }
  const fingerprint = fingerprinted.value;

  // A requested-but-never-needed post-compaction refresh expires here: it
  // only ever bypasses the estimate floor for the first evaluation after
  // the compaction, never later requests.
  const postCompaction = session.preambleRefreshPending;
  session.preambleRefreshPending = false;
  if (session.preambleFingerprint === null) {
    session.preambleFingerprint = fingerprint;
    return idle;
  }
  if (fingerprint === session.preambleFingerprint) {
    return idle;
  }
  if (!isCacheCold(session.lastStepTokens)) {
    return idle;
  }
  if (!postCompaction && (session.lastEstimate ?? Infinity) < REFRESH_FLOOR_TOKENS) {
    return idle;
  }

  cache.delete(sessionID);
  const rendered = await loadPreamble({ sessionID, projectDirectory, homeDirectory, cache });
  if (!rendered.ok || !rendered.value.loaded) {
    return { refreshed: false, failed: true };
  }

  session.preambleFingerprint = fingerprint;
  const receipt: RefreshReceipt = {
    kind: "refresh",
    reason: postCompaction ? "post-compaction" : "brain-changed",
    at: new Date().toISOString(),
  };
  // Best-effort audit trail: a lost receipt never fails the request.
  await appendReceipt(join(deps.stateDirectory, "context-log"), sessionID, receipt);

  return { refreshed: true, content: rendered.value.content };
}
