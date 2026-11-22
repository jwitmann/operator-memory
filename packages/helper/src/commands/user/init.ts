import { Effect, Path, Result } from "effect";

import { ensurePrivateDirectory, writeTextIfMissing } from "../../filesystem.ts";
import { renderTable } from "../../output.ts";
import { readTemplate, TemplatePath } from "../../templates.ts";
import type { CliContext } from "../../utils.ts";
import { fileErrorMessage, fileFailure } from "../common.ts";
import { resolveEffectivePartition } from "../project/brain-roots.ts";
import { USER_FILES, USER_LEGACY_ROOT, USER_ROOT } from "./common.ts";

export const userInit = Effect.fn("userInit")((context: CliContext) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    // .vcc-brain first, fallback to .operator (see resolveEffectivePartition).
    const effective = yield* resolveEffectivePartition(
      context.home,
      ".vcc-brain/user",
      ".operator/user",
      USER_ROOT,
      USER_LEGACY_ROOT,
    );
    const root = effective.absoluteRoot;
    const displayRoot = effective.displayRoot;
    yield* ensurePrivateDirectory(pathService.dirname(root));

    const templates = {
      "operator.md": readTemplate(TemplatePath.UserOperator),
      "catalog.md": readTemplate(TemplatePath.UserCatalog),
    } satisfies Record<(typeof USER_FILES)[number], string>;

    const rows: string[][] = [];
    let failed = false;
    for (const file of USER_FILES) {
      const written = yield* writeTextIfMissing(pathService.join(root, file), templates[file]).pipe(
        Effect.result,
      );
      if (Result.isFailure(written)) {
        failed = true;
        rows.push(["Failed", `${displayRoot}/${file}: ${fileErrorMessage(written.failure)}`]);
      } else {
        rows.push([
          written.success === "created" ? "Created" : "Preserved",
          `${displayRoot}/${file}`,
        ]);
      }
    }

    return {
      exitCode: failed ? 1 : 0,
      output: `✓ User Partition Initialized${effective.usingLegacy ? ` (reusing legacy ${USER_LEGACY_ROOT})` : ""}\n${renderTable(rows)}`,
    };
  }).pipe(
    Effect.catch(error => Effect.succeed(fileFailure(error))),
    Effect.map(result => ({
      ...result,
      output: `${result.output}\n\nFollow the agent instructions below to complete User Setup.\n\n${readTemplate(TemplatePath.UserSetup)}`,
    })),
  ),
);
