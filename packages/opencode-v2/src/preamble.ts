import { loadMemorySnapshot } from "@jwitmann/operator-core/memory/load";
import { resolveBrainRoots } from "@jwitmann/operator-core/memory/roots";
import { renderPreamble, type RenderedPreamble } from "@jwitmann/operator-core/preamble";

import { failure, type Result, success } from "./utils.ts";

export type PreambleError = {
  readonly message: string;
  readonly cause: unknown;
};

export type LoadPreambleOptions = {
  readonly sessionID: string;
  readonly projectDirectory: string;
  readonly homeDirectory: string;
  readonly cache: Map<string, Promise<Result<RenderedPreamble, PreambleError>>>;
};

export async function loadPreamble(
  options: LoadPreambleOptions,
): Promise<Result<RenderedPreamble, PreambleError>> {
  const cached = options.cache.get(options.sessionID);
  if (cached !== undefined) return cached;

  const pending = readPreamble(options.projectDirectory, options.homeDirectory);
  options.cache.set(options.sessionID, pending);
  return pending;
}

async function readPreamble(
  projectDirectory: string,
  homeDirectory: string,
): Promise<Result<RenderedPreamble, PreambleError>> {
  try {
    const snapshotPromise = loadMemorySnapshot(projectDirectory, homeDirectory, true);
    const roots = await resolveBrainRoots(projectDirectory, homeDirectory);
    return success(
      renderPreamble(await snapshotPromise, {
        shared: roots.sharedDisplay,
        private: roots.privateDisplay,
        user: roots.userDisplay,
        legacyIgnored: {
          private: roots.privateLegacyAlsoExists,
          shared: roots.sharedLegacyAlsoExists,
          user: roots.userLegacyAlsoExists,
        },
      }),
    );
  } catch (cause) {
    return failure({ message: "Operator failed to create the session preamble.", cause });
  }
}
