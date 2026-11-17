import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseBrainUpdatesBlock, type BrainUpdatesConfig } from "./brain-updates-config.ts";
import { parseContextManagementBlock, type ContextManagementConfig } from "./context-config.ts";
import { parsePreambleRefreshBlock, type PreambleRefreshConfig } from "./refresh-config.ts";
import { failure, success, type Result } from "./utils.ts";

// Optional per-project override: `<project>/.operator/config.json`, same
// block and key names as the `operator` blocks in opencode.json (without the
// `operator` wrapper). Present fields merge over the already parsed
// opencode.json config; absent file or absent blocks inherit it.
//
// Precedence, lowest first: defaults < opencode.json (global, then project)
// < `.operator/config.json`. Per-block fallback: an invalid block warns and
// keeps the opencode.json block while valid sibling blocks still merge; a
// non-object root or unparsable content warns and keeps everything.
// Resolution is setup-time (one setup per project directory); absent or
// unreadable files fall back silently.

export const PROJECT_CONFIG_RELATIVE_PATH = join(".operator", "config.json");

export type ProjectFileConfigs = {
  readonly contextManagement: ContextManagementConfig;
  readonly brainUpdates: BrainUpdatesConfig;
  readonly preambleRefresh: PreambleRefreshConfig;
};

export type ProjectConfigOutcome = {
  readonly config: ProjectFileConfigs;
  readonly warnings: readonly string[];
};

export function projectConfigPath(projectDirectory: string): string {
  return join(projectDirectory, PROJECT_CONFIG_RELATIVE_PATH);
}

export async function resolveProjectConfig(
  projectDirectory: string,
  base: ProjectFileConfigs,
): Promise<ProjectConfigOutcome> {
  let text: string;
  try {
    text = await readFile(projectConfigPath(projectDirectory), "utf8");
  } catch {
    return { config: base, warnings: [] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { config: base, warnings: ["the project config is not valid JSON"] };
  }
  return parseProjectConfig(raw, base);
}

// Exported for tests. Unknown keys are ignored, as in the options parser.
export function parseProjectConfig(raw: unknown, base: ProjectFileConfigs): ProjectConfigOutcome {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { config: base, warnings: ["the project config must be an object"] };
  }
  const input = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const contextBlock = readProjectBlock(input, "contextManagement");
  const brainBlock = readProjectBlock(input, "brainUpdates");
  const refreshBlock = readProjectBlock(input, "preambleRefresh");
  for (const block of [contextBlock, brainBlock, refreshBlock]) {
    if (!block.ok) warnings.push(block.error.message);
  }
  const contextManagement =
    contextBlock.ok && contextBlock.value !== null
      ? parseContextManagementBlock(contextBlock.value, base.contextManagement)
      : null;
  const brainUpdates =
    brainBlock.ok && brainBlock.value !== null
      ? parseBrainUpdatesBlock(brainBlock.value, base.brainUpdates)
      : null;
  const preambleRefresh =
    refreshBlock.ok && refreshBlock.value !== null
      ? parsePreambleRefreshBlock(refreshBlock.value, base.preambleRefresh)
      : null;
  if (contextManagement !== null && !contextManagement.ok) {
    warnings.push(contextManagement.error.message);
  }
  if (brainUpdates !== null && !brainUpdates.ok) {
    warnings.push(brainUpdates.error.message);
  }
  if (preambleRefresh !== null && !preambleRefresh.ok) {
    warnings.push(preambleRefresh.error.message);
  }
  return {
    config: {
      contextManagement: contextManagement?.ok ? contextManagement.value : base.contextManagement,
      brainUpdates: brainUpdates?.ok ? brainUpdates.value : base.brainUpdates,
      preambleRefresh: preambleRefresh?.ok ? preambleRefresh.value : base.preambleRefresh,
    },
    warnings,
  };
}

type BlockError = { readonly message: string };

function readProjectBlock(
  input: Record<string, unknown>,
  key: string,
): Result<Record<string, unknown> | null, BlockError> {
  const section = input[key];
  if (section === null || section === undefined) return success(null);
  if (typeof section !== "object" || Array.isArray(section)) {
    return failure({ message: `The project config "${key}" option must be an object.` });
  }
  return success(section as Record<string, unknown>);
}
