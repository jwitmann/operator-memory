import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import { hasNodeErrorCode } from "../utils.ts";

export const PROJECT_PRIVATE_ROOT = ".vcc-brain";
export const PROJECT_PRIVATE_LEGACY_ROOT = ".operator";
export const PROJECT_SHARED_ROOT = ".vcc-brain-shared";
export const PROJECT_SHARED_LEGACY_ROOT = ".operator-shared";
export const USER_HOME_ROOT = ".vcc-brain";
export const USER_HOME_LEGACY_ROOT = ".operator";

export const USER_DISPLAY = `~/${USER_HOME_ROOT}/user`;
export const USER_LEGACY_DISPLAY = `~/${USER_HOME_LEGACY_ROOT}/user`;

export const PROJECT_CONFIG_FILE = "config.json";
export const BRAIN_INSTRUCTIONS_FILENAME = "vcc-brain.md";
const BRAIN_INSTRUCTIONS_LEGACY_FILENAME = "operator.md";
export const PROJECT_CONFIG_PRIMARY_RELATIVE_PATH = join(PROJECT_PRIVATE_ROOT, PROJECT_CONFIG_FILE);
export const PROJECT_CONFIG_LEGACY_RELATIVE_PATH = join(
  PROJECT_PRIVATE_LEGACY_ROOT,
  PROJECT_CONFIG_FILE,
);

export const DEFAULT_BRAIN_PATHS = [USER_DISPLAY, PROJECT_PRIVATE_ROOT, PROJECT_SHARED_ROOT];

export type ResolvedBrainRoots = {
  readonly privateRoot: string;
  readonly sharedRoot: string;
  readonly userRoot: string;
  readonly privateDisplay: string;
  readonly sharedDisplay: string;
  readonly userDisplay: string;
  readonly privateLegacyAlsoExists: boolean;
  readonly sharedLegacyAlsoExists: boolean;
  readonly userLegacyAlsoExists: boolean;
};

// Inner instructions-file twin of the brain-root policy: vcc-brain.md wins
// when present, legacy operator.md is read when the new name is absent
// (unmigrated brains). Any other failure keeps the primary path so the
// loader surfaces the real error instead of a misleading legacy one.
export async function resolveInstructionsPath(root: string): Promise<string> {
  const primary = join(root, BRAIN_INSTRUCTIONS_FILENAME);
  try {
    await stat(primary);
    return primary;
  } catch (cause) {
    return hasNodeErrorCode(cause, "ENOENT")
      ? join(root, BRAIN_INSTRUCTIONS_LEGACY_FILENAME)
      : primary;
  }
}

// Pure precedence policy shared by the async and sync resolvers below:
// primary wins whenever it exists, legacy is reused only when primary is
// absent, and a missing primary is created by init flows.
export function pickPrimary(primaryExists: boolean, legacyExists: boolean): boolean {
  return primaryExists || !legacyExists;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (cause) {
    // A missing path falls back to the legacy root; any other failure
    // (permissions, IO) counts as present so the loader surfaces the real
    // error instead of a misleading "missing" diagnosis.
    return !hasNodeErrorCode(cause, "ENOENT");
  }
}

export async function resolveBrainRoots(
  projectDirectory: string,
  homeDirectory: string,
): Promise<ResolvedBrainRoots> {
  const privatePrimary = join(projectDirectory, PROJECT_PRIVATE_ROOT);
  const privateLegacy = join(projectDirectory, PROJECT_PRIVATE_LEGACY_ROOT);
  const sharedPrimary = join(projectDirectory, PROJECT_SHARED_ROOT);
  const sharedLegacy = join(projectDirectory, PROJECT_SHARED_LEGACY_ROOT);
  const userPrimary = join(homeDirectory, USER_HOME_ROOT, "user");
  const userLegacy = join(homeDirectory, USER_HOME_LEGACY_ROOT, "user");

  const [privatePrimaryExists, privateLegacyExists] = await Promise.all([
    pathExists(privatePrimary),
    pathExists(privateLegacy),
  ]);
  const [sharedPrimaryExists, sharedLegacyExists] = await Promise.all([
    pathExists(sharedPrimary),
    pathExists(sharedLegacy),
  ]);
  const [userPrimaryExists, userLegacyExists] = await Promise.all([
    pathExists(userPrimary),
    pathExists(userLegacy),
  ]);

  const usePrivatePrimary = pickPrimary(privatePrimaryExists, privateLegacyExists);
  const useSharedPrimary = pickPrimary(sharedPrimaryExists, sharedLegacyExists);
  const useUserPrimary = pickPrimary(userPrimaryExists, userLegacyExists);

  return {
    privateRoot: usePrivatePrimary ? privatePrimary : privateLegacy,
    sharedRoot: useSharedPrimary ? sharedPrimary : sharedLegacy,
    userRoot: useUserPrimary ? userPrimary : userLegacy,
    privateDisplay: usePrivatePrimary ? PROJECT_PRIVATE_ROOT : PROJECT_PRIVATE_LEGACY_ROOT,
    sharedDisplay: useSharedPrimary ? PROJECT_SHARED_ROOT : PROJECT_SHARED_LEGACY_ROOT,
    userDisplay: useUserPrimary ? USER_DISPLAY : USER_LEGACY_DISPLAY,
    privateLegacyAlsoExists: privatePrimaryExists && privateLegacyExists,
    sharedLegacyAlsoExists: sharedPrimaryExists && sharedLegacyExists,
    userLegacyAlsoExists: userPrimaryExists && userLegacyExists,
  };
}

// Candidate project-config files in precedence order: primary first, legacy
// fallback. Shared by the opencode-v2 and deepseek adapters so both resolve
// the same files in the same order.
export function projectConfigPaths(projectDirectory: string): readonly string[] {
  return [
    join(projectDirectory, PROJECT_CONFIG_PRIMARY_RELATIVE_PATH),
    join(projectDirectory, PROJECT_CONFIG_LEGACY_RELATIVE_PATH),
  ];
}

// Sync twin of the brain-root policy for setup-time call sites that do their
// own IO (adapter setup, which cannot await). Existence comes from blocking
// existsSync; a throwing stat proves nothing, so it falls through to the
// legacy probe instead of letting an uncertain primary win by default.
export function resolveStateDirectory(homeDirectory: string): string {
  const primary = join(homeDirectory, USER_HOME_ROOT, "state");
  const legacy = join(homeDirectory, USER_HOME_LEGACY_ROOT, "state");
  let primaryExists = false;
  try {
    primaryExists = existsSync(primary);
  } catch {
    primaryExists = false;
  }
  if (primaryExists) {
    return primary;
  }
  try {
    if (existsSync(legacy)) {
      return legacy;
    }
  } catch {
    return legacy;
  }
  return primary;
}
