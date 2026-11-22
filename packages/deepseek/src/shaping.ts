import { buildCompactionPrompt } from "@jwitmann/operator-core/context/compaction";
import type { Context } from "@deepseek-ai/cordis";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";

import { type DshDeps, isDshStale } from "./runtime.ts";

// Brain partition roots, least to most authoritative, exactly as the
// preamble renders them. Shared with the receipt label path (canonical
// definition lives in core; re-exported here for the existing import path).
export { DEFAULT_BRAIN_PATHS } from "@jwitmann/operator-core/memory/roots";

// Compaction shaping via the `llm/stream` waterfall, keyed on
// `options.purpose === 'compaction'`.
//
// Deviation from the opencode adapters (documented per the wiring handoff):
// DSH exposes no prompt-shaping hook on the compaction seam. The backend
// (`dsh-compaction-basic/summarizer.ts`) builds its own
// COMPACTION_INSTRUCTION + replayed messages and calls `ctx.llm.stream()`
// directly with `purpose: 'compaction'`. This wrapper is the only
// non-surgical interception point.
//
// Delivery mirrors the opencode port's separate-message push
// (`event.system.push` in `compaction.ts`): the guidance lands as its own
// trailing user message AFTER the host instruction, leaving the
// instruction block byte-identical. Merging into the instruction was
// rejected after live A/B runs: the concatenated block carries two
// competing output schemas and the summarizer returned empty output on
// consecutive shaped runs while unshaped runs on the same history
// succeeded. Appending preserves the prefix-cache alignment the
// summarizer is built around (all prior messages stay verbatim; only the
// tail grows) and keeps one directive per message.
// All mutations are defensive: a host-frozen structure returns false
// instead of throwing, so direct callers inherit the no-throw contract
// (the waterfall wrapper adds its own guard as well).

export type ShapingDeps = Pick<DshDeps, "isBrainAvailable" | "isCurrent"> & {
  readonly enabled: boolean;
  readonly brainPaths: readonly string[];
  // Optional per-project enablement for the sync hook, which cannot do IO:
  // reads the mtime cache warmed by the async sites. `undefined` = session
  // unknown, fall back to the profile `enabled`.
  readonly configForSession?: (sessionId: string) => { readonly enabled: boolean } | undefined;
};

function isEnabledForSession(deps: ShapingDeps, sessionId: string): boolean {
  if (deps.configForSession === undefined) return deps.enabled;
  return deps.configForSession(sessionId)?.enabled ?? deps.enabled;
}

export function registerCompactionShaping(context: Context, deps: ShapingDeps): void {
  context.on(
    "llm/stream",
    (
      options: GenerateOptions,
      next: () => AsyncIterable<StreamChunk>,
    ): AsyncIterable<StreamChunk> => {
      if (isDshStale(deps)) return next();
      try {
        shapeCompactionRequest(options, deps);
      } catch {
        // Leave the request untouched; summarization proceeds unshaped.
      }
      return next();
    },
  );
}

// Exported for tests. Mutates the trailing instruction message in place;
// no-ops on any shape it does not recognize. All mutations are attempted
// defensively: a host-frozen structure returns false instead of throwing,
// so direct callers inherit the no-throw contract (the waterfall wrapper
// adds its own guard as well).
export function shapeCompactionRequest(options: unknown, deps: ShapingDeps): boolean {
  if (typeof options !== "object" || options === null) return false;
  const record = options as Record<string, unknown>;
  if (record.purpose !== "compaction") return false;
  // Fail closed without a session identity: shaping is Brain-gated, and
  // with no session there is no gate to consult.
  const sessionId = record.sessionId;
  if (typeof sessionId !== "string" || !deps.isBrainAvailable(sessionId)) return false;
  if (!isEnabledForSession(deps, sessionId)) return false;

  try {
    return shapeMessages(record, deps);
  } catch {
    return false;
  }
}

function shapeMessages(record: Record<string, unknown>, deps: ShapingDeps): boolean {
  const messages = record.messages;
  if (!Array.isArray(messages) || messages.length === 0) return false;
  // DSH has no trim port and no omission store, so the core template's
  // default recovery sentence (omission notices + a tool that does not
  // exist here) would mislead the summarizer. The durable log is the
  // recovery path instead: checkpoint markers address compacted spans.
  const guidance = buildCompactionPrompt({
    brainPaths: [...deps.brainPaths],
    recoveryRule:
      "Checkpoint markers delimit compacted spans; the agent recovers elided\n"
      + "  content from the durable session log with the operator-recall\n"
      + "  (seq, result, or checkpoint reference) and operator-search tools.",
  });
  messages.push({ role: "user", content: [{ type: "text", text: guidance }] });
  return true;
}
