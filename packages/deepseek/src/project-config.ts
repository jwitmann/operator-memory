import { readFile, stat } from "node:fs/promises";

import { projectConfigPaths } from "@jwitmann/operator-core/memory/roots";

import { parseProjectConfig, type OperatorDeepseekConfig } from "./config.ts";

// Optional per-project override: `<project>/.vcc-brain/config.json` (legacy
// `<project>/.operator/config.json` also checked — see projectConfigPaths),
// same block/key names as the profile plugin config. Absent or unreadable
// files (the common case) silently fall back to the profile config — the hot
// path must not warn per step on transient IO. Unparsable content and
// validation failures are actionable user errors, so they warn once per file
// content and fall back (per block for validation, whole file for bad JSON).
// Resolution is mtime-cached per project directory: repeat resolves pay one
// stat, re-parsing only when the file moves. The synchronous shaping hook
// cannot do IO, so it reads through `cachedProjectConfig` (warmed by the
// async sites); an unwarned session falls back to the profile config, which
// is exactly the pre-override behavior.

type CacheEntry = {
  readonly stamp: string;
  readonly config: OperatorDeepseekConfig;
};

const cache = new Map<string, CacheEntry>();

function stampOf(path: string, mtimeMs: number, size: number): string {
  return `${path}:${mtimeMs}:${size}`;
}

async function findConfigFile(
  projectDirectory: string,
): Promise<{ readonly path: string; readonly mtimeMs: number; readonly size: number } | null> {
  for (const candidate of projectConfigPaths(projectDirectory)) {
    try {
      const st = await stat(candidate);
      return { path: candidate, mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      // Unreadable candidate: try the next one, else fall back silently.
    }
  }
  return null;
}

export async function resolveProjectConfig(
  projectDirectory: string,
  profile: OperatorDeepseekConfig,
  warn: (message: string) => void,
): Promise<OperatorDeepseekConfig> {
  const found = await findConfigFile(projectDirectory);
  if (found === null) {
    cache.delete(projectDirectory);
    return profile;
  }
  const stamp = stampOf(found.path, found.mtimeMs, found.size);
  const cached = cache.get(projectDirectory);
  if (cached !== undefined && cached.stamp === stamp) return cached.config;

  let text: string;
  try {
    text = await readFile(found.path, "utf8");
  } catch {
    cache.delete(projectDirectory);
    return profile;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Unparsable content is an actionable user error: warn once per content
    // (the stamp gate above dedups repeats) and fall back to the profile.
    warnOnce(warn, found.path, "the project config is not valid JSON");
    cache.set(projectDirectory, { stamp, config: profile });
    return profile;
  }
  const outcome = parseProjectConfig(raw, profile);
  if (outcome.warnings.length > 0) {
    warnOnce(warn, found.path, outcome.warnings.join("; "));
  }
  cache.set(projectDirectory, { stamp, config: outcome.config });
  return outcome.config;
}

function warnOnce(warn: (message: string) => void, path: string, detail: string): void {
  try {
    warn(`operator-memory: ignoring invalid project config at ${path}: ${detail}`.slice(0, 500));
  } catch {
    // Logging must never break the hot path.
  }
}

// Synchronous read for hooks that cannot do IO. Returns the last resolved
// config for this directory, or the profile config when never resolved.
export function cachedProjectConfig(
  projectDirectory: string,
  profile: OperatorDeepseekConfig,
): OperatorDeepseekConfig {
  return cache.get(projectDirectory)?.config ?? profile;
}
