import { mkdtemp, mkdir, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_VCC_BRAIN_DEEPSEEK_CONFIG,
  parseProjectConfig,
  type VccBrainDeepseekConfig,
} from "../src/config.ts";
import { cachedProjectConfig, resolveProjectConfig } from "../src/project-config.ts";

const PROFILE: VccBrainDeepseekConfig = {
  contextManagement: {
    enabled: true,
    ratio: 0.8,
    hardCapTokens: 250000,
    keepRecentTurns: 3,
    compactOnComplete: true,
    compactFloorTokens: 32000,
  },
  brainUpdates: { enabled: true, toolCallThreshold: 25 },
  preambleRefresh: { enabled: true },
};

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vcc-brain-project-config-"));
  dirs.push(dir);
  return dir;
}

async function writeConfig(dir: string, raw: string): Promise<void> {
  await mkdir(join(dir, ".operator"), { recursive: true });
  await writeFile(join(dir, ".operator", "config.json"), raw);
}

describe("parseProjectConfig", () => {
  it("returns the base with no warnings for a non-object root", () => {
    const outcome = parseProjectConfig([1, 2], PROFILE);
    expect(outcome.config).toEqual(PROFILE);
    expect(outcome.warnings).toHaveLength(1);
  });

  it("merges present fields over the base and inherits the rest", () => {
    const outcome = parseProjectConfig(
      { contextManagement: { enabled: true, ratio: 0.5 } },
      DEFAULT_VCC_BRAIN_DEEPSEEK_CONFIG,
    );
    expect(outcome.warnings).toEqual([]);
    expect(outcome.config.contextManagement.enabled).toBe(true);
    expect(outcome.config.contextManagement.ratio).toBe(0.5);
    expect(outcome.config.contextManagement.hardCapTokens).toBe(250000);
    expect(outcome.config.brainUpdates).toEqual(DEFAULT_VCC_BRAIN_DEEPSEEK_CONFIG.brainUpdates);
  });

  it("honors a project-level disable over an enabled profile", () => {
    const outcome = parseProjectConfig({ contextManagement: { enabled: false } }, PROFILE);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.config.contextManagement.enabled).toBe(false);
    expect(outcome.config.contextManagement.ratio).toBe(0.8);
  });

  it("falls back per block on validation failure and warns", () => {
    const outcome = parseProjectConfig(
      { contextManagement: { ratio: 7 }, brainUpdates: { enabled: true } },
      PROFILE,
    );
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.config.contextManagement).toEqual(PROFILE.contextManagement);
    expect(outcome.config.brainUpdates.enabled).toBe(true);
  });

  it("ignores unknown keys", () => {
    const outcome = parseProjectConfig(
      { contextManagement: { enabled: true, future: 1 }, unknown: {} },
      DEFAULT_VCC_BRAIN_DEEPSEEK_CONFIG,
    );
    expect(outcome.warnings).toEqual([]);
    expect(outcome.config.contextManagement.enabled).toBe(true);
  });
});

describe("resolveProjectConfig", () => {
  it("returns the profile config when no project file exists, without warning", async () => {
    const dir = await makeProject();
    const warnings: string[] = [];
    const resolved = await resolveProjectConfig(dir, PROFILE, message => {
      warnings.push(message);
    });
    expect(resolved).toEqual(PROFILE);
    expect(warnings).toEqual([]);
  });

  it("merges a valid project file and serves the cache synchronously", async () => {
    const dir = await makeProject();
    await writeConfig(dir, JSON.stringify({ contextManagement: { ratio: 0.5 } }));
    const warnings: string[] = [];
    const resolved = await resolveProjectConfig(dir, PROFILE, message => {
      warnings.push(message);
    });
    expect(warnings).toEqual([]);
    expect(resolved.contextManagement.ratio).toBe(0.5);
    expect(resolved.contextManagement.enabled).toBe(true);
    expect(cachedProjectConfig(dir, DEFAULT_VCC_BRAIN_DEEPSEEK_CONFIG)).toEqual(resolved);
  });

  it("warns once per content on invalid JSON and falls back to the profile", async () => {
    const dir = await makeProject();
    await writeConfig(dir, "{not json");
    const warnings: string[] = [];
    const warn = (message: string) => {
      warnings.push(message);
    };
    const first = await resolveProjectConfig(dir, PROFILE, warn);
    const second = await resolveProjectConfig(dir, PROFILE, warn);
    expect(first).toEqual(PROFILE);
    expect(second).toEqual(PROFILE);
    expect(warnings).toHaveLength(1);
  });

  it("picks up edits on content moves", async () => {
    const dir = await makeProject();
    await writeConfig(dir, JSON.stringify({ contextManagement: { ratio: 0.5 } }));
    const silent = () => {};
    expect((await resolveProjectConfig(dir, PROFILE, silent)).contextManagement.ratio).toBe(0.5);
    await writeConfig(dir, JSON.stringify({ contextManagement: { ratio: 0.3 } }));
    // Force a distinct mtime stamp so the cache cannot serve the old entry.
    const path = join(dir, ".operator", "config.json");
    const future = new Date(Date.now() + 5000);
    await utimes(path, future, future);
    expect((await resolveProjectConfig(dir, PROFILE, silent)).contextManagement.ratio).toBe(0.3);
  });
});
