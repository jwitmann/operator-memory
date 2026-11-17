import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_BRAIN_UPDATES_CONFIG } from "../src/brain-updates-config.ts";
import { DEFAULT_CONTEXT_MANAGEMENT_CONFIG } from "../src/context-config.ts";
import { parseProjectConfig, resolveProjectConfig } from "../src/project-config.ts";
import { DEFAULT_PREAMBLE_REFRESH_CONFIG } from "../src/refresh-config.ts";

const BASE = {
  contextManagement: { ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG, enabled: true },
  brainUpdates: { ...DEFAULT_BRAIN_UPDATES_CONFIG, enabled: true },
  preambleRefresh: { ...DEFAULT_PREAMBLE_REFRESH_CONFIG, enabled: true },
};

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "operator-opencode-project-config-"));
  dirs.push(dir);
  return dir;
}

describe("parseProjectConfig", () => {
  it("returns the base with a warning for a non-object root", () => {
    const outcome = parseProjectConfig([1], BASE);
    expect(outcome.config).toEqual(BASE);
    expect(outcome.warnings).toHaveLength(1);
  });

  it("merges present fields over the base and inherits the rest", () => {
    const outcome = parseProjectConfig(
      { contextManagement: { ratio: 0.5 }, brainUpdates: { toolCallThreshold: 10 } },
      BASE,
    );
    expect(outcome.warnings).toEqual([]);
    expect(outcome.config.contextManagement.ratio).toBe(0.5);
    expect(outcome.config.contextManagement.enabled).toBe(true);
    expect(outcome.config.brainUpdates.toolCallThreshold).toBe(10);
    expect(outcome.config.preambleRefresh).toEqual(BASE.preambleRefresh);
  });

  it("honors a project-level disable over opencode.json", () => {
    const outcome = parseProjectConfig({ brainUpdates: { enabled: false } }, BASE);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.config.brainUpdates.enabled).toBe(false);
    expect(outcome.config.brainUpdates.toolCallThreshold).toBe(25);
  });

  it("falls back per block on validation failure and warns", () => {
    const outcome = parseProjectConfig(
      { brainUpdates: { toolCallThreshold: -2 }, preambleRefresh: { enabled: true } },
      BASE,
    );
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.config.brainUpdates).toEqual(BASE.brainUpdates);
    expect(outcome.config.preambleRefresh.enabled).toBe(true);
  });

  it("ignores unknown keys", () => {
    const outcome = parseProjectConfig({ contextManagement: { enabled: true, future: 1 } }, BASE);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.config.contextManagement.enabled).toBe(true);
  });
});

describe("resolveProjectConfig", () => {
  it("returns the base when no project file exists", async () => {
    const dir = await makeProject();
    const outcome = await resolveProjectConfig(dir, BASE);
    expect(outcome).toEqual({ config: BASE, warnings: [] });
  });

  it("merges a valid project file over the base", async () => {
    const dir = await makeProject();
    await mkdir(join(dir, ".operator"), { recursive: true });
    await writeFile(
      join(dir, ".operator", "config.json"),
      JSON.stringify({ contextManagement: { enabled: false } }),
    );
    const outcome = await resolveProjectConfig(dir, BASE);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.config.contextManagement.enabled).toBe(false);
    expect(outcome.config.contextManagement.ratio).toBe(0.8);
  });

  it("warns and falls back on invalid JSON", async () => {
    const dir = await makeProject();
    await mkdir(join(dir, ".operator"), { recursive: true });
    await writeFile(join(dir, ".operator", "config.json"), "{not json");
    const outcome = await resolveProjectConfig(dir, BASE);
    expect(outcome.config).toEqual(BASE);
    expect(outcome.warnings).toHaveLength(1);
  });
});
