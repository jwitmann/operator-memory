import { Effect, Path } from "effect";

import { inspectPath, PathKindError, type PathKind } from "../../filesystem.ts";

export type EffectivePartition = {
  readonly absoluteRoot: string;
  readonly displayRoot: string;
  readonly usingLegacy: boolean;
  readonly primaryKind: PathKind;
  readonly legacyKind: PathKind;
  readonly bothDirectories: boolean;
  readonly primaryObstructed: boolean;
};

type ProbedKind = {
  readonly kind: PathKind;
  readonly uncertain: boolean;
};

// A candidate whose stat itself fails (for example ENOTDIR because an
// ancestor is a file, or a transient IO error) cannot be classified. It is
// treated as present so the real error surfaces downstream when the path is
// actually touched (ensureDirectory, listFiles, readOptionalText), instead of
// being misreported as missing. PathKindError (a successful stat with an
// unexpected type) keeps failing loudly.
const kindOf = Effect.fn("kindOf")(function* (absolute: string) {
  const kind = yield* inspectPath(absolute).pipe(
    Effect.map((kind): ProbedKind => ({ kind, uncertain: false })),
    Effect.catchIf(
      (error): error is Exclude<typeof error, PathKindError> => !(error instanceof PathKindError),
      () => Effect.succeed({ kind: "directory", uncertain: true } as const),
    ),
  );
  return kind;
});

// .vcc-brain first, fallback to .operator: reuse legacy only when primary is
// absent. A primary that exists in any non-directory form (file, other) is an
// obstruction: legacy is used when it is a directory, and the obstruction is
// reported through primaryObstructed so callers can warn.
export const resolveEffectivePartition = Effect.fn("resolveEffectivePartition")(function* (
  cwd: string,
  primary: string,
  legacy: string,
  primaryDisplay: string = primary,
  legacyDisplay: string = legacy,
) {
  const pathService = yield* Path.Path;
  const primaryAbsolute = pathService.join(cwd, primary);
  const legacyAbsolute = pathService.join(cwd, legacy);
  const primaryProbed = yield* kindOf(primaryAbsolute);
  const legacyProbed = yield* kindOf(legacyAbsolute);
  const useLegacy = primaryProbed.kind !== "directory" && legacyProbed.kind === "directory";
  return {
    absoluteRoot: useLegacy ? legacyAbsolute : primaryAbsolute,
    displayRoot: useLegacy ? legacyDisplay : primaryDisplay,
    usingLegacy: useLegacy,
    primaryKind: primaryProbed.kind,
    legacyKind: legacyProbed.kind,
    bothDirectories:
      primaryProbed.kind === "directory"
      && legacyProbed.kind === "directory"
      && !primaryProbed.uncertain
      && !legacyProbed.uncertain,
    primaryObstructed:
      primaryProbed.kind !== "missing"
      && primaryProbed.kind !== "directory"
      && legacyProbed.kind === "directory",
  } satisfies EffectivePartition;
});
