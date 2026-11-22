import { Effect, Path } from "effect";

import { inspectPath, PathKindError, readText, writeText } from "../../filesystem.ts";
import { PARTITIONS } from "../../lint.ts";
import { computeTreeHash, stampFrontmatter } from "../../tree-hash.ts";
import type { CliContext } from "../../utils.ts";
import { getErrorMessage } from "../../utils.ts";
import { fileFailure } from "../common.ts";

export const indexStamp = Effect.fn("indexStamp")((context: CliContext) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const mains: string[] = [];
    for (const partition of PARTITIONS) {
      const relativePath = `${partition.root}/index/index.md`;
      const kind = yield* inspectPath(pathService.join(context.cwd, relativePath));
      if (kind === "missing") {
        continue;
      }
      if (kind !== "file") {
        return yield* new PathKindError({ path: relativePath, expected: "file", actual: kind });
      }
      mains.push(relativePath);
    }
    if (mains.length === 0) {
      return {
        exitCode: 1,
        output: `Project: ${context.cwd}\n\n✗ No main index found. Run \`vcc-brain-helper index init\` and follow the guide to build one first.`,
      };
    }
    const tree = yield* computeTreeHash(context.cwd);
    const stampedAt = new Date().toISOString();
    const lines = [`Project: ${context.cwd}`, ""];
    for (const relativePath of mains) {
      const absolutePath = pathService.join(context.cwd, relativePath);
      const content = yield* readText(absolutePath);
      const stamped = stampFrontmatter(content, {
        treeHash: tree.hash,
        stampedAt,
        commit: tree.commit,
      });
      if (stamped === null) {
        return {
          exitCode: 1,
          output: `Project: ${context.cwd}\n\n✗ ${relativePath}: missing or malformed frontmatter. Fix it, then re-run \`index stamp\`.`,
        };
      }
      yield* writeText(absolutePath, stamped);
      lines.push(`✓ ${relativePath} stamped ${tree.hash.slice(0, 12)}`);
    }
    return { exitCode: 0, output: lines.join("\n") };
  }).pipe(
    Effect.catch(error =>
      Effect.succeed(
        error instanceof PathKindError
          ? fileFailure(error)
          : { exitCode: 1, output: `✗ ${getErrorMessage(error)}` },
      ),
    ),
  ),
);
