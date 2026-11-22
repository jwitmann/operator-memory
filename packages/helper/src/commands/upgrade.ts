import { Effect } from "effect";

import { upgradeHelper } from "../update.ts";
import type { CliContext } from "../utils.ts";

export const upgrade = Effect.fn("upgrade")(function* (context: CliContext) {
  const result = yield* upgradeHelper(context);
  switch (result.status) {
    case "current":
      return { exitCode: 0, output: `VCC Brain Helper ${context.version} is up to date.` };
    case "updated":
      return { exitCode: 0, output: `VCC Brain Helper updated to ${result.latest}.` };
    case "unknown":
      return {
        exitCode: 1,
        output: `VCC Brain Helper ${result.latest} is available, but the update could not determine whether Bun or npm owns this installation. Update vcc-brain-helper manually using the original installation method.`,
      };
    case "failed":
      return { exitCode: 1, output: result.message };
  }
});
