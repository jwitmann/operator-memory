import { USER_DISPLAY, USER_LEGACY_DISPLAY } from "@jwitmann/operator-core/memory/roots";

export const USER_ROOT = USER_DISPLAY;
export const USER_LEGACY_ROOT = USER_LEGACY_DISPLAY;
export const USER_PATH = `${USER_DISPLAY}/operator.md`;
export const USER_CATALOG_PATH = `${USER_DISPLAY}/catalog.md`;

export const USER_FILES = ["operator.md", "catalog.md"] as const;
