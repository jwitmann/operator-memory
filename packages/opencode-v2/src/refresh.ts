import {
  fingerprintPreamble,
  isCacheCold,
  REFRESH_FLOOR_TOKENS,
} from "@aerovato/operator-core/preamble-refresh";
import { appendReceipt, type RefreshReceipt } from "@aerovato/operator-core/context/receipts";
import { estimateContextTokens, type RequestMessage } from "@aerovato/operator-core/context/tokens";
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
// non-trivial estimate. A post-compaction fingerprint move skips both
// gates: compaction flushed the cache by construction.

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
  messages: readonly RequestMessage[],
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
  // only ever bypasses the cold-cache and estimate-floor gates for the
  // first evaluation after the compaction, never later requests. The
  // bypass is sound because compaction flushed the cache by construction,
  // so the gates have nothing left to protect.
  const postCompaction = session.preambleRefreshPending;
  session.preambleRefreshPending = false;
  if (session.preambleFingerprint === null) {
    session.preambleFingerprint = fingerprint;
    return idle;
  }
  if (fingerprint === session.preambleFingerprint) {
    return idle;
  }
  // Compaction flushed the cache by construction, so when it just ran the
  // fingerprint move alone suffices: both gates are bypassed, but only for
  // this first evaluation, so the bypass can never mislabel a much later
  // change.
  if (!postCompaction && !isCacheCold(session.lastStepTokens)) {
    return idle;
  }
  // The estimate is measured here, on the current request: the floor must
  // judge the request that would carry the refreshed prefix, not the
  // previous one (a small edit request routinely precedes the refresh).
  // Measuring costs one tokenizer pass, but only on requests whose
  // fingerprint already moved and whose cache is cold — the rare case.
  if (!postCompaction) {
    const estimate = estimateContextTokens(session.estimator, messages);
    if (estimate < REFRESH_FLOOR_TOKENS) {
      return idle;
    }
  }

  cache.delete(sessionID);
  const rendered = await loadPreamble({ sessionID, projectDirectory, homeDirectory, cache });
  if (!rendered.ok || !rendered.value.loaded) {
    // Evict the failed render: the next request's initial load must attempt
    // a genuinely fresh render (which doubles as the retry) instead of
    // throwing the cached failure out of the preamble hook.
    cache.delete(sessionID);
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

export type PreambleRefreshDeps = Pick<
  ContextManagementDeps,
  "stateDirectory" | "isBrainAvailable" | "isCurrent"
> & {
  readonly config: PreambleRefreshConfig;
  readonly reportFailure: (sessionID: string) => void;
  readonly failureNotices: Set<string>;
};

// Owns the preamble hook's refresh branch: the refresh decision and render,
// the estimate measurement for the floor, and the failure notice. Returns
// the content the hook pushes: fresh on refresh, cached otherwise.
export async function refreshPreambleContent(
  deps: PreambleRefreshDeps,
  runtime: ContextRuntime,
  sessionID: string,
  projectDirectory: string,
  homeDirectory: string,
  cache: LoadPreambleOptions["cache"],
  messages: readonly unknown[],
  cachedContent: string,
): Promise<string> {
  // Record the request size where the messages are already in hand: step
  // anchoring counts only what arrived since this count, so without the
  // context hook it must be maintained here (no tokenizer pass involved).
  const session = sessionRuntime(runtime, sessionID);
  session.lastMessageCount = messages.length;
  const outcome = await maybeRefreshPreamble(
    deps,
    runtime,
    sessionID,
    projectDirectory,
    homeDirectory,
    cache,
    messages as readonly RequestMessage[],
  );
  if (!outcome.refreshed) {
    if (outcome.failed && !deps.failureNotices.has(sessionID)) {
      deps.failureNotices.add(sessionID);
      deps.reportFailure(sessionID);
    }
    return cachedContent;
  }
  return outcome.content;
}
