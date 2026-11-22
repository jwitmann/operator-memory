import { Effect, Path } from "effect";

import { listFiles, PathKindError, readOptionalText } from "../../filesystem.ts";
import { renderTable } from "../../output.ts";
import type { CliContext } from "../../utils.ts";
import { resolveEffectivePartition } from "../project/brain-roots.ts";
import { BRAIN_INSTRUCTIONS_FILENAME, USER_LEGACY_ROOT, USER_ROOT } from "./common.ts";

const INIT_HINT = [
  "For Users: Run `/vcc-brain:user-init` in your harness to initialize.",
  "For Agents: Run `vcc-brain-helper user init` and follow the guide in its output.",
];

export const userStatus = Effect.fn("userStatus")(function* (context: CliContext) {
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
  const kind = effective.usingLegacy ? effective.legacyKind : effective.primaryKind;

  if (kind === "missing") {
    return {
      exitCode: 0,
      output: [
        `User Partition: ${displayRoot} (legacy ${USER_LEGACY_ROOT} also checked)`,
        "",
        "⚠ User Partition Missing",
        renderTable([["Expected Location", `${displayRoot}/`]]),
        "",
        ...INIT_HINT,
      ].join("\n"),
    };
  }
  if (kind !== "directory") {
    return yield* new PathKindError({
      path: root,
      expected: "directory",
      actual: kind,
    });
  }

  const rows: string[][] = [];
  let missingCore = false;
  for (const [file, label] of [
    [BRAIN_INSTRUCTIONS_FILENAME, "User Instructions"],
    ["catalog.md", "User Catalog"],
  ] as const) {
    const content = yield* readOptionalText(pathService.join(root, file));
    if (content === null) {
      missingCore = true;
    }
    rows.push([
      label,
      content === null
        ? `Missing (${displayRoot}/${file})`
        : `${displayRoot}/${file} (${Buffer.byteLength(content)} bytes)`,
    ]);
  }

  const files = yield* listFiles(root);
  const freeform = files.filter(
    file => file.relativePath !== BRAIN_INSTRUCTIONS_FILENAME && file.relativePath !== "catalog.md",
  );
  rows.push(["Freeform Content", `${freeform.length} files`]);

  const lines = [`User Partition: ${displayRoot}`, "", "✓ User Partition Found", renderTable(rows)];
  if (effective.bothDirectories) {
    lines.push(
      "",
      "⚠ Both ~/.vcc-brain/user/ and legacy ~/.operator/user/ exist; legacy is ignored — merge anything still needed, then remove it.",
    );
  }
  if (effective.primaryObstructed) {
    lines.push(
      "",
      `⚠ ~/.vcc-brain/user/ is obstructed (${effective.primaryKind}); using legacy ~/.operator/user/ until it is repaired.`,
    );
  }
  if (missingCore) {
    lines.push("", ...INIT_HINT);
  }

  return { exitCode: 0, output: lines.join("\n") };
});
