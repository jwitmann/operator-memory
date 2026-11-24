import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { projectConfigPaths } from "@jwitmann/vcc-brain-core/memory/roots";
import { Effect, FileSystem } from "effect";

import { isRecord } from "../../utils.ts";
import { normalizeProject } from "./dsh.ts";

// Mutual cross-project peers for recall scope. Each project declares peer
// *directories* in `<projectDir>/.vcc-brain/config.json` (`peers: [...]`,
// legacy `.operator/config.json` also checked). A peer counts only when its
// own config lists our directory back (both sides canonicalized with
// realpath) — mutual or nothing. Returns project *names* (cwd basenames,
// the same key ingest stores). Absent/unreadable files, bad JSON, and
// non-array `peers` fall back silently to no peers (fail-closed). Explicit
// CLI `--peer` flags union in as-is; the tools never pass them.
function peerDirsOf(raw: unknown): string[] {
  if (!isRecord(raw)) {
    return [];
  }
  const peers = raw.peers;
  if (!Array.isArray(peers)) {
    return [];
  }
  return peers.filter((peer): peer is string => typeof peer === "string" && peer.trim() !== "");
}

function canonicalDir(dir: string): Effect.Effect<string | null> {
  return Effect.promise((): Promise<string | null> => realpath(dir).catch(() => null));
}

export const readPeerDirs = Effect.fn("readPeerDirs")(function* (projectDir: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  for (const candidate of projectConfigPaths(projectDir)) {
    const text = yield* fileSystem
      .readFileString(candidate)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (text === null) {
      continue;
    }
    try {
      return peerDirsOf(JSON.parse(text) as unknown);
    } catch {
      // Unparsable first-readable file decides: fall back to no peers,
      // like the adapters fall back to the base config. Never fatal.
      return [];
    }
  }
  return [];
});

export const resolveMutualPeers = Effect.fn("resolveMutualPeers")(function* (
  projectDir: string | null,
  explicitPeers: readonly string[],
) {
  const names = new Set<string>(explicitPeers);
  if (projectDir === null || projectDir.trim() === "") {
    return [...names];
  }
  const own = yield* canonicalDir(projectDir);
  if (own === null) {
    return [...names];
  }
  const declared = yield* readPeerDirs(projectDir);
  for (const peer of declared) {
    const peerDir = yield* canonicalDir(resolve(projectDir, peer));
    if (peerDir === null || peerDir === own) {
      continue;
    }
    const back = yield* readPeerDirs(peerDir);
    const mutual: string[] = [];
    for (const entry of back) {
      const canonical = yield* canonicalDir(resolve(peerDir, entry));
      if (canonical !== null) {
        mutual.push(canonical);
      }
    }
    if (mutual.includes(own)) {
      names.add(normalizeProject(peerDir, peerDir));
    }
  }
  return [...names];
});
