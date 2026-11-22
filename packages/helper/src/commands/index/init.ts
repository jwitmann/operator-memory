import { Effect, Path } from "effect";

import { inspectPath, PathKindError } from "../../filesystem.ts";
import { PARTITIONS } from "../../lint.ts";
import { renderTable } from "../../output.ts";
import { readTemplate, TemplatePath } from "../../templates.ts";
import type { CliContext } from "../../utils.ts";
import { fileFailure } from "../common.ts";

export const indexInit = Effect.fn("indexInit")((context: CliContext) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const rootKinds = yield* Effect.all(
      PARTITIONS.map(partition => inspectPath(pathService.join(context.cwd, partition.root))),
      { concurrency: "unbounded" },
    );
    const projectExists = rootKinds.some(kind => kind === "directory");
    if (!projectExists) {
      return {
        exitCode: 0,
        output: `Project: ${context.cwd}

✗ Project Brain Missing
${renderTable([["Expected", ".vcc-brain/ and/or .vcc-brain-shared/ (legacy .operator/ and .operator-shared/ also checked)"]])}

For Users: Invoke the Operator Project Setup workflow in your harness to initialize.
For Agents: Run \`operator-helper project init\` and follow the guide in its output.`,
      };
    }

    const rows: string[][] = [];
    for (const partition of PARTITIONS) {
      rows.push(yield* inspectMainIndex(context.cwd, partition.root));
    }
    return {
      exitCode: 0,
      output: `Project: ${context.cwd}\n\n${renderTable(rows)}`,
    };
  }).pipe(
    Effect.catch(error => Effect.succeed(fileFailure(error))),
    Effect.map(result => ({
      ...result,
      output: `${result.output}\n\nFollow the agent instructions below to build or refresh the Project Index.\n\n${readTemplate(TemplatePath.ProjectIndexSetup)}`,
    })),
  ),
);

const inspectMainIndex = Effect.fn("inspectMainIndex")(function* (
  cwd: string,
  partitionRoot: string,
) {
  const pathService = yield* Path.Path;
  const relativePath = `${partitionRoot}/index/index.md`;
  const path = pathService.join(cwd, relativePath);
  const kind = yield* inspectPath(path);
  if (kind !== "missing" && kind !== "file") {
    return yield* new PathKindError({ path, expected: "file", actual: kind });
  }
  return [relativePath, kind === "file" ? "Found" : "Missing"] as [string, string];
});
