import { evaluateBrainUpdateActivity } from "@aerovato/operator-core/brain-updates";
import { appendReceipt, type BrainReminderReceipt } from "@aerovato/operator-core/context/receipts";
import { fingerprintPreamble } from "@aerovato/operator-core/preamble-refresh";
import { join } from "node:path";
import type { BrainUpdatesConfig } from "./config.ts";
import {
  countSessionCompletedCalls,
  type DshDeps,
  type DshRuntime,
  isDshStale,
  reportReceiptFailureOnce,
  sessionRuntime,
} from "./runtime.ts";

// Deterministic Brain-update nudge, evaluated inside the assemble hook after
// refresh. DSH-native difference from the opencode port: completed work is
// counted from the session's tool/call + tool/result join (tracked by the
// session/event observer) instead of scanning request messages — the durable
// log is the source of truth, so pairing is exact and costs no tokenizer
// pass. Otherwise identical semantics: the Brain fingerprint marks the
// baseline, crossings remind once per fingerprint era, no Brain writes. Each
// firing also appends one log-only receipt (best-effort, never fails the
// request) so reminder compliance can be measured by joining to the next
// brain-changed refresh in the session log.

export type BrainUpdatesDeps = Pick<
  DshDeps,
  "isBrainAvailable" | "isCurrent" | "reportReceiptFailure"
> & {
  readonly config: BrainUpdatesConfig;
  readonly projectDirectory: string;
  readonly homeDirectory: string;
  readonly stateDirectory: string;
};

export async function maybeAppendBrainUpdateReminder(
  deps: BrainUpdatesDeps,
  runtime: DshRuntime,
  sessionId: string,
  content: string,
  precomputedFingerprint?: string | null,
): Promise<string> {
  if (!deps.config.enabled || isDshStale(deps) || !deps.isBrainAvailable(sessionId)) {
    return content;
  }

  const session = sessionRuntime(runtime, sessionId);
  // Shared-fingerprint fast path (see maybeRefreshPreamble): `null` means
  // the shared computation failed upstream — stay quiet without re-statting.
  // `undefined` preserves standalone use (compute internally).
  let fingerprint: string;
  if (precomputedFingerprint !== undefined) {
    if (precomputedFingerprint === null) return content;
    fingerprint = precomputedFingerprint;
  } else {
    const fingerprinted = await fingerprintPreamble(deps.projectDirectory, deps.homeDirectory);
    if (!fingerprinted.ok) return content;
    fingerprint = fingerprinted.value;
  }

  const decision = evaluateBrainUpdateActivity(
    session.brainUpdateActivity,
    fingerprint,
    countSessionCompletedCalls(session),
    deps.config.toolCallThreshold,
  );

  if (isDshStale(deps)) return content;
  session.brainUpdateActivity = decision.state;
  if (!decision.crossed) return content;

  const receipt: BrainReminderReceipt = {
    kind: "brain-reminder",
    at: new Date().toISOString(),
    threshold: deps.config.toolCallThreshold,
    completedSinceBaseline: decision.completedSinceBaseline,
  };
  // Best-effort audit trail: a lost receipt is reported once, never fails
  // the request.
  const written = await appendReceipt(join(deps.stateDirectory, "context-log"), sessionId, receipt);
  if (!written.ok) reportReceiptFailureOnce(runtime, deps, sessionId, "brain-reminder");

  return `${content}\n\n${brainUpdateReminder(deps.config.toolCallThreshold)}`;
}

function brainUpdateReminder(toolCallThreshold: number): string {
  return `<operator-brain-update-reminder>
You have completed ${toolCallThreshold} tool calls without a Brain change.
Before continuing, record any durable decisions, contracts, or lessons in the
appropriate Brain partition. Do not write transient task progress or restate
implementation. If nothing durable has emerged, make no Brain edits.
</operator-brain-update-reminder>`;
}
