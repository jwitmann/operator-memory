import {
  countCompletedToolCalls,
  evaluateBrainUpdateActivity,
} from "@jwitmann/vcc-brain-core/brain-updates";
import {
  appendReceipt,
  type BrainReminderReceipt,
} from "@jwitmann/vcc-brain-core/context/receipts";
import type { RequestMessage } from "@jwitmann/vcc-brain-core/context/tokens";
import { fingerprintPreamble } from "@jwitmann/vcc-brain-core/preamble-refresh";
import { join } from "node:path";

import {
  isContextStale,
  sessionRuntime,
  type ContextManagementDeps,
  type ContextRuntime,
} from "./runtime.ts";
import type { BrainUpdatesConfig } from "./brain-updates-config.ts";

// Deterministic Brain-update nudge, evaluated per request inside the preamble
// hook after refresh. The Brain fingerprint marks the baseline; completed tool
// calls since the last move accumulate against one threshold. A firing request
// appends one static reminder and stays quiet for the rest of that fingerprint
// era. No Brain reads beyond the fingerprint, no Brain writes. Each firing
// also appends one log-only receipt (best-effort, never fails the request)
// so reminder compliance can be measured by joining to the next brain-changed
// refresh in the session log.
export type BrainUpdatesDeps = Pick<ContextManagementDeps, "isBrainAvailable" | "isCurrent"> & {
  readonly config: BrainUpdatesConfig;
  readonly projectDirectory: string;
  readonly homeDirectory: string;
  readonly stateDirectory: string;
};

export async function maybeAppendBrainUpdateReminder(
  deps: BrainUpdatesDeps,
  runtime: ContextRuntime,
  sessionID: string,
  messages: readonly RequestMessage[],
  content: string,
): Promise<string> {
  if (!deps.config.enabled || isContextStale(deps) || !deps.isBrainAvailable(sessionID)) {
    return content;
  }

  const session = sessionRuntime(runtime, sessionID);
  const fingerprinted = await fingerprintPreamble(deps.projectDirectory, deps.homeDirectory);
  if (!fingerprinted.ok) {
    // Cannot tell whether the Brain changed; stay quiet and retry on the next
    // request rather than guessing about staleness.
    return content;
  }

  const decision = evaluateBrainUpdateActivity(
    session.brainUpdateActivity,
    fingerprinted.value,
    countCompletedToolCalls(messages),
    deps.config.toolCallThreshold,
  );

  // A reload landing during the fingerprint read must not let the old
  // generation claim a fresh baseline: it could suppress the live setup's
  // first crossing.
  if (isContextStale(deps)) {
    return content;
  }
  session.brainUpdateActivity = decision.state;
  if (!decision.crossed) {
    return content;
  }

  const receipt: BrainReminderReceipt = {
    kind: "brain-reminder",
    at: new Date().toISOString(),
    threshold: deps.config.toolCallThreshold,
    completedSinceBaseline: decision.completedSinceBaseline,
  };
  // Best-effort audit trail: a lost receipt never fails the request.
  await appendReceipt(join(deps.stateDirectory, "context-log"), sessionID, receipt);

  return `${content}\n\n${brainUpdateReminder(deps.config.toolCallThreshold)}`;
}

function brainUpdateReminder(toolCallThreshold: number): string {
  return `<vcc-brain-brain-update-reminder>
You have completed ${toolCallThreshold} tool calls without a Brain change.
Before continuing, record any durable decisions, contracts, or lessons in the
appropriate Brain partition. Do not write transient task progress or restate
implementation. If nothing durable has emerged, make no Brain edits.
</vcc-brain-brain-update-reminder>`;
}
