import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { failure, hasNodeErrorCode, type Result, success } from "./utils.ts";

// Cache-aware preamble refresh: deterministic, local-only. The preamble
// renders a fixed small set of disk files; when those files change
// mid-session the rendered preamble goes stale. Refresh re-renders from
// current disk state, but only when the provider's prompt cache is cold —
// rewriting the request prefix invalidates the cache, so a hot-cache
// refresh burns tokens for nothing. Fingerprint plus cache state, never
// model judgment.

export type FingerprintError = {
  readonly path: string;
  readonly cause: unknown;
};

// Re-rendering below this estimate gains nothing: the preamble itself
// spans a few thousand tokens, so refreshing a smaller context cannot
// pay for its own prefix rewrite.
export const REFRESH_FLOOR_TOKENS = 4000;

// Every disk file the preamble renders: per-partition operator.md
// instructions and catalog.md maps (shared, user, private) plus every
// index/*.md at any depth (shared and private listings use paths plus
// frontmatter; only the main index.md inlines full content). Static
// framework guidance and tenets are code constants. Canonical form:
// sorted `path:mtimeMs` lines, `path:missing` for an absent index root.
// Comparison is plain string equality.
export async function fingerprintPreamble(
  projectDirectory: string,
  homeDirectory: string,
): Promise<Result<string, FingerprintError>> {
  const entries: string[] = [];
  const sharedRoot = join(projectDirectory, ".operator-shared");
  const privateRoot = join(projectDirectory, ".operator");
  const userRoot = join(homeDirectory, ".operator", "user");

  for (const root of [sharedRoot, privateRoot, userRoot]) {
    for (const file of ["operator.md", "catalog.md"]) {
      const entry = await fingerprintFile(join(root, file));
      if (!entry.ok) {
        return entry;
      }
      entries.push(entry.value);
    }
  }

  for (const root of [sharedRoot, privateRoot]) {
    const indexEntries = await fingerprintIndex(join(root, "index"));
    if (!indexEntries.ok) {
      return indexEntries;
    }
    entries.push(...indexEntries.value);
  }

  entries.sort();
  return success(entries.join("\n"));
}

// Cold when no step finished yet (nothing cached) or the latest step
// reports zero cache reads. Provider cache reports are bimodal in
// practice — exactly zero versus tens of thousands — so an exact zero
// is the threshold, not an epsilon.
export function isCacheCold(tokens: { readonly cacheRead: number } | null): boolean {
  return tokens === null || tokens.cacheRead === 0;
}

async function fingerprintFile(path: string): Promise<Result<string, FingerprintError>> {
  try {
    const info = await stat(path);
    return success(`${path}:${info.mtimeMs}`);
  } catch (cause) {
    if (hasNodeErrorCode(cause, "ENOENT")) {
      return success(`${path}:missing`);
    }
    return failure({ path, cause });
  }
}

async function fingerprintIndex(
  indexRoot: string,
): Promise<Result<readonly string[], FingerprintError>> {
  try {
    await stat(indexRoot);
  } catch (cause) {
    if (hasNodeErrorCode(cause, "ENOENT")) {
      return success([`${indexRoot}:missing`]);
    }
    return failure({ path: indexRoot, cause });
  }

  const paths: string[] = [];
  const collected = await collectIndexFiles(indexRoot, paths);
  if (!collected.ok) {
    return collected;
  }
  const entries: string[] = [];
  for (const path of paths) {
    const entry = await fingerprintFile(path);
    if (!entry.ok) {
      return entry;
    }
    entries.push(entry.value);
  }
  return success(entries);
}

async function collectIndexFiles(
  directory: string,
  paths: string[],
): Promise<Result<void, FingerprintError>> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    return failure({ path: directory, cause });
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectIndexFiles(path, paths);
      if (!nested.ok) {
        return nested;
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      paths.push(path);
    }
  }
  return success(undefined);
}
