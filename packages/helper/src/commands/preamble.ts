import { loadMemorySnapshot } from "@jwitmann/vcc-brain-core/memory/load";
import { resolveBrainRoots } from "@jwitmann/vcc-brain-core/memory/roots";
import { renderPreamble } from "@jwitmann/vcc-brain-core/preamble";
import { Effect } from "effect";

import type { CliContext } from "../utils.ts";

export const preamble = Effect.fn("preamble")(function* (context: CliContext) {
  const snapshot = yield* Effect.promise(() => loadMemorySnapshot(context.cwd, context.home, true));
  const roots = yield* Effect.promise(() => resolveBrainRoots(context.cwd, context.home));
  return {
    exitCode: 0,
    output: renderPreamble(snapshot, {
      shared: roots.sharedDisplay,
      private: roots.privateDisplay,
      user: roots.userDisplay,
      legacyIgnored: {
        private: roots.privateLegacyAlsoExists,
        shared: roots.sharedLegacyAlsoExists,
        user: roots.userLegacyAlsoExists,
      },
    }).content,
  };
});
