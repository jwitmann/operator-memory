import { Effect, Path, Result } from "effect";

import { listFiles, PathKindError, readOptionalText, type PathKind } from "../../filesystem.ts";
import { checkGlobalIgnore, hasTrackedPrivateFiles } from "../../git.ts";
import { renderTable } from "../../output.ts";
import type { CliContext } from "../../utils.ts";
import {
  BRAIN_INSTRUCTIONS_FILENAME,
  CORE_FILES,
  PRIVATE_LEGACY_ROOT,
  PRIVATE_ROOT,
  SHARED_LEGACY_ROOT,
  SHARED_ROOT,
} from "./common.ts";
import { resolveEffectivePartition } from "./brain-roots.ts";

export const projectStatus = Effect.fn("projectStatus")(function* (context: CliContext) {
  const privateStatus = yield* inspectEffectivePartition(
    context.cwd,
    PRIVATE_ROOT,
    PRIVATE_LEGACY_ROOT,
    false,
  );
  const sharedStatus = yield* inspectEffectivePartition(
    context.cwd,
    SHARED_ROOT,
    SHARED_LEGACY_ROOT,
    true,
  );
  const ignored = yield* checkGlobalIgnore(context.home, context.xdgConfigHome);
  const tracked = yield* hasTrackedPrivateFiles(context.cwd).pipe(Effect.result);
  const lines = [
    `Project: ${context.cwd}`,
    "",
    ...privateStatus.lines,
    "",
    ...sharedStatus.lines,
    "",
    `${ignored ? "✓" : "✗"} Global Git Ignore ${ignored ? "Contains" : "Missing"} .vcc-brain/ (legacy .operator/ and .operator-shared/ also checked)`,
  ];

  const privateFilesAreTracked = Result.isSuccess(tracked) && tracked.success;
  if (Result.isSuccess(tracked)) {
    if (!tracked.success) {
      lines.push("✓ Project Private Is Not Tracked");
    } else {
      lines.push("✗ Project Private Has Tracked Files");
    }
  } else {
    lines.push("✗ Unable To Inspect Tracked Private Files", `    ${tracked.failure.message}`);
  }

  if (!privateStatus.exists && !sharedStatus.exists) {
    lines.push(
      "",
      "✗ Project Brain Missing",
      "",
      "For Users: Run `/vcc-brain:project-init` in your harness to initialize.",
      "For Agents: Run `vcc-brain-helper project init` and follow the guide in its output.",
    );
  }

  return {
    exitCode: !ignored || Result.isFailure(tracked) || privateFilesAreTracked ? 1 : 0,
    output: lines.join("\n"),
  };
});

type PartitionStatus = {
  readonly exists: boolean;
  readonly lines: string[];
};

const inspectEffectivePartition = Effect.fn("inspectEffectivePartition")(function* (
  cwd: string,
  primary: string,
  legacy: string,
  shared: boolean,
) {
  const effective = yield* resolveEffectivePartition(cwd, primary, legacy);
  const status = yield* inspectPartition(
    cwd,
    effective.displayRoot,
    effective.absoluteRoot,
    effective.usingLegacy ? effective.legacyKind : effective.primaryKind,
    shared,
  );
  if (!status.exists) {
    return status;
  }
  const lines = [...status.lines];
  if (effective.bothDirectories) {
    lines.push(
      `⚠ Both ${primary}/ and legacy ${legacy}/ exist; legacy is ignored — merge anything still needed, then remove it.`,
    );
  }
  if (effective.primaryObstructed) {
    lines.push(
      `⚠ ${primary}/ is obstructed (${effective.primaryKind}); using legacy ${legacy}/ until it is repaired.`,
    );
  }
  return { exists: status.exists, lines } satisfies PartitionStatus;
});

const inspectPartition = Effect.fn("inspectPartition")(function* (
  cwd: string,
  root: string,
  absoluteRoot: string,
  kind: PathKind,
  shared: boolean,
) {
  const label = shared ? "Project Shared" : "Project Private";
  if (kind === "missing") {
    return {
      exists: false,
      lines: [`⚠ ${label} Missing`, renderTable([["Expected Location", `${root}/`]])],
    } satisfies PartitionStatus;
  }
  if (kind !== "directory") {
    return yield* new PathKindError({
      path: absoluteRoot,
      expected: "directory",
      actual: kind,
    });
  }

  const lines = [`✓ ${label} Found`];
  const rows: string[][] = [];
  for (const [file, name] of [
    [BRAIN_INSTRUCTIONS_FILENAME, "VCC Brain Instructions"],
    ["index/index.md", "Project Index"],
    ["catalog.md", "Partition Catalog"],
  ] as const) {
    rows.push(yield* describeFile(cwd, root, file, name));
  }

  const files = yield* listFiles(absoluteRoot);
  const excluded = new Set<string>(CORE_FILES);
  const freeform = files.filter(
    file => !excluded.has(file.relativePath) && !file.relativePath.startsWith("index/"),
  );
  rows.push(["Freeform Content", `${freeform.length} files`]);
  lines.push(renderTable(rows));
  return { exists: true, lines } satisfies PartitionStatus;
});

const describeFile = Effect.fn("describeFile")(function* (
  cwd: string,
  root: string,
  file: string,
  label: string,
) {
  const pathService = yield* Path.Path;
  const content = yield* readOptionalText(pathService.join(cwd, root, file));
  return [
    label,
    content === null
      ? `Missing (${root}/${file})`
      : `${root}/${file} (${Buffer.byteLength(content)} bytes)`,
  ] as [string, string];
});
