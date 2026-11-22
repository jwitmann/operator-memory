import { Effect, Path, Result } from "effect";

import {
  ensureDirectory,
  inspectPath,
  PathKindError,
  writeTextIfMissing,
} from "../../filesystem.ts";
import { ensureGlobalIgnore } from "../../git.ts";
import { renderTable } from "../../output.ts";
import { readTemplate, TemplatePath } from "../../templates.ts";
import type { CliContext } from "../../utils.ts";
import { fileErrorMessage, fileFailure } from "../common.ts";
import { resolveEffectivePartition } from "./brain-roots.ts";
import {
  CORE_FILES,
  PRIVATE_LEGACY_ROOT,
  PRIVATE_ROOT,
  SHARED_LEGACY_ROOT,
  SHARED_ROOT,
} from "./common.ts";

export const projectInit = Effect.fn("projectInit")((context: CliContext) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const ignored = yield* ensureGlobalIgnore(context.home, context.xdgConfigHome);

    // .vcc-brain first, fallback to .operator (see resolveEffectivePartition).
    const effective = yield* resolveEffectivePartition(
      context.cwd,
      PRIVATE_ROOT,
      PRIVATE_LEGACY_ROOT,
    );
    const privateRoot = effective.absoluteRoot;
    const privateDisplay = effective.displayRoot;
    // .vcc-brain first, fallback to .operator (see resolveEffectivePartition).
    const effectiveShared = yield* resolveEffectivePartition(
      context.cwd,
      SHARED_ROOT,
      SHARED_LEGACY_ROOT,
    );
    const sharedRoot = effectiveShared.absoluteRoot;
    const sharedDisplay = effectiveShared.displayRoot;
    yield* ensureDirectory(privateRoot);

    const templates = {
      "operator.md": readTemplate(TemplatePath.ProjectOperator),
      "index/index.md": readTemplate(TemplatePath.ProjectIndex),
      "catalog.md": readTemplate(TemplatePath.ProjectCatalog),
    } satisfies Record<(typeof CORE_FILES)[number], string>;

    const lines = ["✓ Project Private Initialized"];
    if (effective.usingLegacy) {
      lines.push(`ℹ Reusing legacy ${PRIVATE_LEGACY_ROOT}/ (no ${PRIVATE_ROOT}/ yet).`);
    }
    if (effective.primaryObstructed) {
      lines.push(
        `⚠ ${PRIVATE_ROOT}/ is obstructed (${effective.primaryKind}); using legacy ${PRIVATE_LEGACY_ROOT}/ until it is repaired.`,
      );
    }
    const privateRows: string[][] = [];
    let failed = false;
    for (const file of CORE_FILES) {
      const written = yield* writeTextIfMissing(
        pathService.join(privateRoot, file),
        templates[file],
      ).pipe(Effect.result);
      if (Result.isFailure(written)) {
        failed = true;
        privateRows.push([
          "Failed",
          `${privateDisplay}/${file}: ${fileErrorMessage(written.failure)}`,
        ]);
      } else {
        privateRows.push([
          written.success === "created" ? "Created" : "Preserved",
          `${privateDisplay}/${file}`,
        ]);
      }
    }
    const configResult = yield* writeTextIfMissing(
      pathService.join(privateRoot, "config.json"),
      readTemplate(TemplatePath.ProjectConfig),
    ).pipe(Effect.result);
    if (Result.isFailure(configResult)) {
      failed = true;
      privateRows.push([
        "Failed",
        `${privateDisplay}/config.json: ${fileErrorMessage(configResult.failure)}`,
      ]);
    } else {
      privateRows.push([
        configResult.success === "created" ? "Created" : "Preserved",
        `${privateDisplay}/config.json`,
      ]);
    }
    lines.push(renderTable(privateRows));

    const sharedKind =
      sharedDisplay === SHARED_ROOT ? effectiveShared.primaryKind : effectiveShared.legacyKind;
    if (sharedKind === "missing") {
      lines.push("", "⚠ Project Shared Not Initialized");
    } else if (sharedKind !== "directory") {
      failed = true;
      lines.push(
        "",
        "✗ Project Shared Failed",
        fileErrorMessage(
          new PathKindError({ path: sharedRoot, expected: "directory", actual: sharedKind }),
        ),
      );
    } else {
      lines.push("", "✓ Project Shared Found");
      const sharedRows: string[][] = [];
      const readmeResult = yield* writeTextIfMissing(
        pathService.join(sharedRoot, "README.md"),
        readTemplate(TemplatePath.ProjectSharedReadme),
      ).pipe(Effect.result);
      if (Result.isFailure(readmeResult)) {
        failed = true;
        sharedRows.push([
          "Failed",
          `${sharedDisplay}/README.md: ${fileErrorMessage(readmeResult.failure)}`,
        ]);
      } else {
        sharedRows.push([
          readmeResult.success === "created" ? "Created" : "Preserved",
          `${sharedDisplay}/README.md`,
        ]);
      }

      for (const file of CORE_FILES) {
        const path = pathService.join(sharedRoot, file);
        const kind = yield* inspectPath(path);
        if (kind === "file" || kind === "missing") {
          sharedRows.push([kind === "file" ? "Present" : "Missing", `${sharedDisplay}/${file}`]);
        } else {
          failed = true;
          sharedRows.push([
            "Failed",
            `${sharedDisplay}/${file}: ${fileErrorMessage(new PathKindError({ path, expected: "file", actual: kind }))}`,
          ]);
        }
      }
      lines.push(renderTable(sharedRows));
    }
    lines.push(
      "",
      `✓ Global Git Ignore ${ignored === "configured" ? "Configured" : "Already Configured"}`,
    );

    return { exitCode: failed ? 1 : 0, output: lines.join("\n") };
  }).pipe(
    Effect.catch(error => Effect.succeed(fileFailure(error))),
    Effect.map(result => ({
      ...result,
      output: `${result.output}\n\nFollow the agent instructions below to complete Project Setup.\n\n${readTemplate(TemplatePath.ProjectSetup)}`,
    })),
  ),
);
