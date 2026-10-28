import {
  countCompletedToolCalls,
  evaluateBrainUpdateActivity,
} from "@aerovato/operator-core/brain-updates";
import type { RequestMessage } from "@aerovato/operator-core/context/tokens";
import { fingerprintPreamble } from "@aerovato/operator-core/preamble-refresh";

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
// era. No Brain reads beyond the fingerprint, no Brain writes, no receipts.
export type BrainUpdatesDeps = Pick<ContextManagementDeps, "isBrainAvailable" | "isCurrent"> & {
  readonly config: BrainUpdatesConfig;
  readonly projectDirectory: string;
  readonly homeDirectory: string;
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
