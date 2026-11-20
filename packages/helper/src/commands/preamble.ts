import { loadMemorySnapshot } from "@jwitmann/operator-core/memory/load";
import { renderPreamble } from "@jwitmann/operator-core/preamble";
import { Effect } from "effect";

import type { CliContext } from "../utils.ts";

export const preamble = Effect.fn("preamble")(function* (context: CliContext) {
  const snapshot = yield* Effect.promise(() => loadMemorySnapshot(context.cwd, context.home, true));
  return { exitCode: 0, output: renderPreamble(snapshot).content };
});
