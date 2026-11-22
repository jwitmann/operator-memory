import { join } from "node:path";

import { hasNodeErrorCode, type Result, success } from "../utils.ts";
import {
  checkOptionalReadableFile,
  readDirectory,
  readOptionalContent,
  type MemoryLoadError,
} from "./common.ts";
import { resolveInstructionsPath } from "./roots.ts";

export type UserPartitionSnapshot = {
  readonly exists: boolean;
  readonly brainInstructions: string | null;
  readonly catalog: string | null;
  readonly observations: string | null;
};

export type UserPartitionStatusSnapshot = {
  readonly exists: boolean;
};

export function loadUserPartition(
  root: string,
  loadFiles: true,
): Promise<Result<UserPartitionSnapshot, MemoryLoadError>>;
export function loadUserPartition(
  root: string,
  loadFiles: false,
): Promise<Result<UserPartitionStatusSnapshot, MemoryLoadError>>;

export async function loadUserPartition(
  root: string,
  loadFiles: boolean,
): Promise<
  | Result<UserPartitionSnapshot, MemoryLoadError>
  | Result<UserPartitionStatusSnapshot, MemoryLoadError>
> {
  if (!loadFiles) {
    const directory = await readDirectory(root);
    if (!directory.ok) {
      return hasNodeErrorCode(directory.error.cause, "ENOENT")
        ? success({ exists: false })
        : directory;
    }

    for (const path of [
      await resolveInstructionsPath(root),
      join(root, "catalog.md"),
      join(root, "observations.md"),
    ]) {
      const file = await checkOptionalReadableFile(path);
      if (!file.ok) {
        return file;
      }
    }
    return success({ exists: true });
  }

  const brainInstructions = await readOptionalContent(await resolveInstructionsPath(root));
  if (!brainInstructions.ok) {
    return brainInstructions;
  }
  const catalog = await readOptionalContent(join(root, "catalog.md"));
  if (!catalog.ok) {
    return catalog;
  }
  const observations = await readOptionalContent(join(root, "observations.md"));
  if (!observations.ok) {
    return observations;
  }
  if (brainInstructions.value !== null || catalog.value !== null || observations.value !== null) {
    return success({
      exists: true,
      brainInstructions: brainInstructions.value,
      catalog: catalog.value,
      observations: observations.value,
    });
  }

  const directory = await readDirectory(root);
  if (!directory.ok) {
    return hasNodeErrorCode(directory.error.cause, "ENOENT")
      ? success({ exists: false, brainInstructions: null, catalog: null, observations: null })
      : directory;
  }
  return success({ exists: true, brainInstructions: null, catalog: null, observations: null });
}
