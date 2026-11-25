import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";

import { loadMemorySnapshot } from "@jwitmann/vcc-brain-core/memory/load";
import { resolveBrainRoots } from "@jwitmann/vcc-brain-core/memory/roots";
import { renderPreamble } from "@jwitmann/vcc-brain-core/preamble";

import { runCli } from "../src/cli.ts";
import { GitError } from "../src/git.ts";
import { NpmRegistry } from "../src/npm-registry.ts";
import { readTemplate, TemplatePath } from "../src/templates.ts";
import type { CliContext, CliResult } from "../src/utils.ts";
import { makeGitRunnerLayer } from "./mocks/git-runner.ts";

let directory: string;
let context: CliContext;
let configuredIgnore: string | null = null;
let tracked: ReadonlyArray<string> = [];
const gitLayer = makeGitRunnerLayer(arguments_ => {
  if (arguments_.includes("core.excludesFile")) {
    return configuredIgnore === null
      ? Effect.fail(new GitError({ message: "unset" }))
      : Effect.succeed(configuredIgnore);
  }
  return Effect.succeed(tracked.join("\n"));
});
const child = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
);
const registry = Layer.succeed(
  NpmRegistry.Service,
  NpmRegistry.Service.of({ latestVersion: () => Effect.succeed("1.2.3") }),
);
const services = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, child, gitLayer, registry);

beforeEach(() => {
  directory = fs.mkdtempSync(join(tmpdir(), "vcc-brain-helper-cli-"));
  context = {
    cwd: join(directory, "project"),
    home: join(directory, "home"),
    xdgConfigHome: null,
    version: "1.2.3",
  };
  fs.mkdirSync(context.cwd, { recursive: true });
  mockGit([], null);
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

test("routes help, version, and invalid commands", async () => {
  const help = await executeCli(["help"], context);
  expect(help.output).toMatch(/^user status\s+Show User Partition status$/m);
  expect(help.output).toMatch(/^project init\s+Initialize project partitions and print/m);
  expect(help.output).toMatch(/^index init\s+Show Project Index status and print/m);
  expect(help.output).not.toMatch(/^index status\s/m);
  expect(help.output).not.toMatch(/^user guide\s/m);
  expect(help.output).toMatch(/^index lint\s+Check Project Index structure/m);
  expect(help.output).toMatch(/^index stamp\s+Stamp Project Index/m);
  expect(help.output).toMatch(/^memory check\s+Check that all VCC Brain memory/m);
  expect(help.output).toMatch(/^preamble\s+Render the VCC Brain preamble/m);
  expect(help.output).toMatch(/^install codex\s+Install or update the Codex plugin/m);
  expect(help.output).toMatch(/^install opencode\s+Install or update the OpenCode plugin/m);
  expect(help.output).not.toMatch(/^install opencode-v2\s/m);
  expect(help.output).toMatch(/^install pi\s+Install or update the Pi plugin/m);
  expect(help.output).not.toContain("templates index");
  expect((await executeCli(["--help"], context)).exitCode).toBe(2);
  expect((await executeCli(["-h"], context)).exitCode).toBe(2);
  expect((await executeCli(["--version"], context)).exitCode).toBe(2);
  expect((await executeCli(["-v"], context)).exitCode).toBe(2);
  expect((await executeCli(["bad", "command"], context)).exitCode).toBe(2);
});

test("formats help as plaintext", async () => {
  const help = (await executeCli(["help"], context)).output;
  expect(help).toContain("VCC Brain Helper");
  expect(help).toContain("COMMANDS\n\n");
  expect(help).toMatch(/^user status\s+Show User Partition status$/m);
  expect(help).not.toContain("FLAGS");
  expect(help).not.toContain("\u001B");
});

test("reports, initializes, preserves, and guides the user partition", async () => {
  const missing = await executeCli(["user", "status"], context);
  expect(missing.output).toContain("⚠ User Partition Missing");

  const initialized = await executeCli(["user", "init"], context);
  expect(initialized.exitCode).toBe(0);
  expect(initialized.output).toContain(
    "✓ User Partition Initialized\nCreated  ~/.vcc-brain/user/vcc-brain.md\nCreated  ~/.vcc-brain/user/catalog.md",
  );
  expect(initialized.output).toContain("# User Setup");
  expect(fs.readFileSync(resolvePath("/home/.vcc-brain/user/vcc-brain.md"), "utf8")).toBe(
    readTemplate(TemplatePath.UserVccBrain),
  );
  expect(fs.readFileSync(resolvePath("/home/.vcc-brain/user/catalog.md"), "utf8")).toBe(
    readTemplate(TemplatePath.UserCatalog),
  );
  if (process.platform !== "win32") {
    expect(fs.statSync(resolvePath("/home/.vcc-brain")).mode & 0o777).toBe(0o700);
  }

  const status = await executeCli(["user", "status"], context);
  expect(status.exitCode).toBe(0);
  expect(status.output).toContain("✓ User Partition Found");
  expect(status.output).toContain("User Instructions");
  expect(status.output).toContain("User Catalog");
  expect(status.output).toContain("~/.vcc-brain/user/catalog.md (");
  expect(status.output).toContain("Freeform Content");
  expect(status.output).not.toContain("/vcc-brain:user-init");

  fs.writeFileSync(resolvePath("/home/.vcc-brain/user/vcc-brain.md"), "custom");
  expect((await executeCli(["user", "init"], context)).output).toContain("Preserved");
  expect(fs.readFileSync(resolvePath("/home/.vcc-brain/user/vcc-brain.md"), "utf8")).toBe("custom");

  fs.rmSync(resolvePath("/home/.vcc-brain/user/catalog.md"));
  const incomplete = await executeCli(["user", "status"], context);
  expect(incomplete.exitCode).toBe(0);
  expect(incomplete.output).toContain("Missing (~/.vcc-brain/user/catalog.md)");
  expect(incomplete.output).toContain("/vcc-brain:user-init");

  expect(await executeCli(["user", "guide"], context)).toEqual({ exitCode: 0, output: "" });
});

test("reports a user instruction path obstruction", async () => {
  fs.mkdirSync(resolvePath("/home/.vcc-brain/user/vcc-brain.md"), { recursive: true });
  const result = await executeCli(["user", "status"], context);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("Expected a file, found directory");
});

test("prints the user setup guide when initialization cannot create its root", async () => {
  seed({ "/home/.vcc-brain": "blocked" });

  const result = await executeCli(["user", "init"], context);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("Expected a directory, found file");
  expect(result.output).toContain("# User Setup");
});

test.runIf(process.platform !== "win32")("restricts an existing user VCC Brain root", async () => {
  fs.mkdirSync(resolvePath("/home/.vcc-brain"), { recursive: true, mode: 0o755 });
  fs.chmodSync(resolvePath("/home/.vcc-brain"), 0o755);

  await executeCli(["user", "init"], context);

  expect(fs.statSync(resolvePath("/home/.vcc-brain")).mode & 0o777).toBe(0o700);
});

test("initializes Private content without creating the Shared partition", async () => {
  const result = await executeCli(["project", "init"], context);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Created  .vcc-brain/index/index.md");
  expect(result.output).toContain("Project Shared Not Initialized");
  expect(result.output).toContain("# Project Setup");
  expect(fs.readFileSync(resolvePath("/project/.vcc-brain/vcc-brain.md"), "utf8")).toBe(
    readTemplate(TemplatePath.ProjectVccBrain),
  );
  expect(fs.existsSync(resolvePath("/project/.vcc-brain-shared"))).toBe(false);
  expect(fs.readFileSync(resolvePath("/home/.config/git/ignore"), "utf8")).toContain(".vcc-brain/");

  fs.writeFileSync(resolvePath("/project/.vcc-brain/vcc-brain.md"), "custom");
  const repeated = await executeCli(["project", "init"], context);
  expect(repeated.output).toContain("Preserved  .vcc-brain/vcc-brain.md");
  expect(fs.readFileSync(resolvePath("/project/.vcc-brain/vcc-brain.md"), "utf8")).toBe("custom");
  expect(fs.existsSync(resolvePath("/project/.vcc-brain-shared"))).toBe(false);
});

test("reuses a legacy private partition instead of shadowing it", async () => {
  seed({ "/project/.operator/vcc-brain.md": "legacy instructions" });

  const result = await executeCli(["project", "init"], context);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Reusing legacy .operator/");
  expect(result.output).toContain("Preserved  .operator/vcc-brain.md");
  expect(fs.readFileSync(resolvePath("/project/.operator/vcc-brain.md"), "utf8")).toBe(
    "legacy instructions",
  );
  expect(fs.existsSync(resolvePath("/project/.vcc-brain"))).toBe(false);
});

test("migrates a legacy operator.md instead of shadowing it on project init", async () => {
  seed({ "/project/.operator/operator.md": "legacy instructions" });

  const result = await executeCli(["project", "init"], context);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Migrated   .operator/vcc-brain.md");
  expect(result.output).not.toContain("Created   .operator/vcc-brain.md");
  expect(fs.existsSync(resolvePath("/project/.operator/operator.md"))).toBe(false);
  expect(fs.readFileSync(resolvePath("/project/.operator/vcc-brain.md"), "utf8")).toBe(
    "legacy instructions",
  );

  const repeated = await executeCli(["project", "init"], context);
  expect(repeated.exitCode).toBe(0);
  expect(repeated.output).not.toContain("Migrated");
  expect(fs.readFileSync(resolvePath("/project/.operator/vcc-brain.md"), "utf8")).toBe(
    "legacy instructions",
  );
});

test("migrates a legacy inner file inside a primary partition", async () => {
  seed({ "/project/.vcc-brain/operator.md": "carried instructions" });

  const result = await executeCli(["project", "init"], context);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Migrated   .vcc-brain/vcc-brain.md");
  expect(fs.existsSync(resolvePath("/project/.vcc-brain/operator.md"))).toBe(false);
  expect(fs.readFileSync(resolvePath("/project/.vcc-brain/vcc-brain.md"), "utf8")).toBe(
    "carried instructions",
  );
});

test("migrates a legacy user operator.md instead of shadowing it", async () => {
  seed({ "/home/.operator/user/operator.md": "legacy user instructions" });

  const result = await executeCli(["user", "init"], context);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Migrated   ~/.operator/user/vcc-brain.md");
  expect(fs.existsSync(resolvePath("/home/.operator/user/operator.md"))).toBe(false);
  expect(fs.readFileSync(resolvePath("/home/.operator/user/vcc-brain.md"), "utf8")).toBe(
    "legacy user instructions",
  );
});

test("skips the instructions template when migration fails instead of shadowing", async () => {
  fs.mkdirSync(resolvePath("/project/.operator/operator.md"), { recursive: true });

  const result = await executeCli(["project", "init"], context);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("Failed");
  expect(fs.existsSync(resolvePath("/project/.operator/vcc-brain.md"))).toBe(false);
  expect(fs.readFileSync(resolvePath("/project/.operator/catalog.md"), "utf8")).toBe(
    readTemplate(TemplatePath.ProjectCatalog),
  );
});

test("warns when both primary and legacy partitions exist", async () => {
  seed({
    "/project/.vcc-brain/vcc-brain.md": "current",
    "/project/.operator/vcc-brain.md": "legacy",
  });

  const result = await executeCli(["project", "status"], context);
  expect(result.output).toContain("legacy is ignored");
});

test("scaffolds a disabled project config and preserves user edits", async () => {
  const result = await executeCli(["project", "init"], context);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Created  .vcc-brain/config.json");
  const configPath = resolvePath("/project/.vcc-brain/config.json");
  const scaffolded = JSON.parse(fs.readFileSync(configPath, "utf8"));
  expect(scaffolded.contextManagement).toEqual({
    enabled: false,
    ratio: 0.8,
    hardCapTokens: 250000,
    keepRecentTurns: 3,
    compactOnComplete: true,
    compactFloorTokens: 32000,
  });
  expect(scaffolded.brainUpdates).toEqual({ enabled: false, toolCallThreshold: 25 });
  expect(scaffolded.preambleRefresh).toEqual({ enabled: false });

  fs.writeFileSync(configPath, JSON.stringify({ contextManagement: { enabled: true } }));
  const repeated = await executeCli(["project", "init"], context);
  expect(repeated.output).toContain("Preserved  .vcc-brain/config.json");
  expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
    contextManagement: { enabled: true },
  });
});

test("creates and preserves the README in an existing Shared partition", async () => {
  fs.mkdirSync(resolvePath("/project/.vcc-brain-shared"), { recursive: true });

  const initialized = await executeCli(["project", "init"], context);
  expect(initialized.exitCode).toBe(0);
  expect(initialized.output).toContain("Project Shared Found");
  expect(initialized.output).toContain("Created  .vcc-brain-shared/README.md");
  expect(fs.readFileSync(resolvePath("/project/.vcc-brain-shared/README.md"), "utf8")).toBe(
    readTemplate(TemplatePath.ProjectSharedReadme),
  );

  fs.writeFileSync(resolvePath("/project/.vcc-brain-shared/README.md"), "custom");
  const repeated = await executeCli(["project", "init"], context);
  expect(repeated.output).toContain("Preserved  .vcc-brain-shared/README.md");
  expect(fs.readFileSync(resolvePath("/project/.vcc-brain-shared/README.md"), "utf8")).toBe(
    "custom",
  );
});

test("reports Shared partition and file obstructions", async () => {
  fs.writeFileSync(resolvePath("/project/.vcc-brain-shared"), "blocked");
  const blockedRoot = await executeCli(["project", "init"], context);
  expect(blockedRoot.exitCode).toBe(1);
  expect(blockedRoot.output).toContain("Project Shared Failed");
  expect(blockedRoot.output).toContain("Expected a directory, found file");

  fs.rmSync(resolvePath("/project/.vcc-brain-shared"));
  fs.mkdirSync(resolvePath("/project/.vcc-brain-shared/README.md"), { recursive: true });
  fs.mkdirSync(resolvePath("/project/.vcc-brain-shared/catalog.md"), { recursive: true });
  const blockedFiles = await executeCli(["project", "init"], context);
  expect(blockedFiles.exitCode).toBe(1);
  expect(blockedFiles.output).toContain(".vcc-brain-shared/README.md");
  expect(blockedFiles.output).toContain(".vcc-brain-shared/catalog.md");
  expect(blockedFiles.output).toContain("Expected a file, found directory");
});

test("reports detailed project file write failures and continues", async () => {
  fs.mkdirSync(resolvePath("/project/.vcc-brain/vcc-brain.md"), { recursive: true });

  const result = await executeCli(["project", "init"], context);

  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("Failed");
  expect(result.output).toContain(".vcc-brain/vcc-brain.md");
  expect(result.output).toContain("Expected a file, found directory");
  expect(result.output).toContain("# Project Setup");
  expect(fs.readFileSync(resolvePath("/project/.vcc-brain/catalog.md"), "utf8")).toBe(
    readTemplate(TemplatePath.ProjectCatalog),
  );
  expect(fs.readFileSync(resolvePath("/project/.vcc-brain/index/index.md"), "utf8")).toBe(
    readTemplate(TemplatePath.ProjectIndex),
  );
});

test("prints the project setup guide when global ignore setup fails", async () => {
  seed({ "/home/.config": "blocked" });

  const result = await executeCli(["project", "init"], context);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain(resolvePath("/home/.config/git/ignore"));
  expect(result.output).toContain("# Project Setup");
});

test("uses a configured global ignore and appends the exact pattern", async () => {
  const ignore = resolvePath("/custom/ignore");
  seed({ "/custom/ignore": ".operator*\n" });
  mockGit([], `${ignore}\n`);
  const result = await executeCli(["project", "init"], context);
  expect(result.exitCode).toBe(0);
  expect(fs.readFileSync(ignore, "utf8")).toBe(
    ".operator*\n# VCC Brain: Ignore private partition\n.vcc-brain/\n.operator/\n",
  );
});

test("reports project files, freeform content, ignore, and tracked private files", async () => {
  seed({
    "/project/.vcc-brain/vcc-brain.md": "abc",
    "/project/.vcc-brain/index/nested/core.md": "index",
    "/project/.vcc-brain/notes/plan.md": "plan",
    "/project/.vcc-brain-shared/README.md": "readme",
    "/home/.config/git/ignore": ".operator/\n",
  });
  mockGit([".vcc-brain/vcc-brain.md"], null);

  const result = await executeCli(["project", "status"], context);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain(".vcc-brain/vcc-brain.md (3 bytes)");
  expect(result.output.match(/Freeform Content\s+1 files/g)).toHaveLength(2);
  expect(result.output).toContain("Project Private Has Tracked Files");
});

test("renders main index status without listing subindexes", async () => {
  seed({
    "/project/.vcc-brain/index/index.md": "---\ndescription: Main\nread_if: Always\n---\n# Private",
    "/project/.vcc-brain/index/nested/api.md": "# API",
  });

  const result = await executeCli(["index", "status"], context);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain(".vcc-brain-shared/index/index.md  Missing");
  expect(result.output).toContain(".vcc-brain/index/index.md         Found");
  expect(result.output).not.toContain("Description:");
  expect(result.output).not.toContain("Read If:");
  expect(result.output).not.toContain("nested/api.md");
  expect(result.output).toContain("# Project Index Setup");
  expect(await executeCli(["index", "init"], context)).toEqual(result);
});

test("reports a missing Project Brain without creating files", async () => {
  const result = await executeCli(["index", "status"], context);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Project Brain Missing");
  expect(result.output).toContain("# Project Index Setup");
  expect(fs.existsSync(resolvePath("/project/.vcc-brain"))).toBe(false);
});

test("prints the index setup guide when main index inspection fails", async () => {
  fs.mkdirSync(resolvePath("/project/.vcc-brain/index/index.md"), { recursive: true });

  const result = await executeCli(["index", "init"], context);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("Expected a file, found directory");
  expect(result.output).toContain("# Project Index Setup");
});

test("checks full memory loading and reports partition errors independently", async () => {
  const missing = await executeCli(["memory", "check"], context);
  expect(missing.exitCode).toBe(0);
  expect(missing.output).toContain("✓ Shared: Uninitialized");
  expect(missing.output).toContain("✓ User: Uninitialized");
  expect(missing.output).toContain("✓ Private: Uninitialized");
  expect(missing.output).toContain("No memory load failures detected.");

  seed({
    "/project/.vcc-brain-shared/vcc-brain.md": "shared",
    "/home/.vcc-brain/user/vcc-brain.md": "user",
    "/project/.vcc-brain/vcc-brain.md": "private",
  });
  const loaded = await executeCli(["memory", "check"], context);
  expect(loaded.exitCode).toBe(0);
  expect(loaded.output).toContain("✓ Shared: Loaded");
  expect(loaded.output).toContain("✓ User: Loaded");
  expect(loaded.output).toContain("✓ Private: Loaded");
  expect(loaded.output).toContain("No memory load failures detected.");
  expect(loaded.output).not.toContain("\u001B");

  fs.rmSync(resolvePath("/project/.vcc-brain"), { recursive: true });
  fs.rmSync(resolvePath("/project/.vcc-brain-shared"), { recursive: true });
  fs.writeFileSync(resolvePath("/project/.vcc-brain"), "obstructed");
  fs.writeFileSync(resolvePath("/project/.vcc-brain-shared"), "obstructed");
  const failed = await executeCli(["memory", "check"], context);
  expect(failed.exitCode).toBe(1);
  expect(failed.output).toContain("✗ Shared: Error");
  expect(failed.output).toContain("✗ Private: Error");
  expect(failed.output).toContain(resolvePath("/project/.vcc-brain"));
  expect(failed.output).toContain(resolvePath("/project/.vcc-brain-shared"));
  expect(failed.output).not.toContain("No memory load failures detected.");
});

test("memory check accepts loadable partitions with missing core files and invalid index metadata", async () => {
  seed({
    "/project/.vcc-brain/index/index.md": "# Index without frontmatter",
    "/project/.vcc-brain-shared/catalog.md": "",
    "/home/.vcc-brain/user/catalog.md": "",
  });

  const result = await executeCli(["memory", "check"], context);

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("✓ Shared: Loaded");
  expect(result.output).toContain("✓ User: Loaded");
  expect(result.output).toContain("✓ Private: Loaded");
  expect(result.output).toContain("No memory load failures detected.");
});

test("renders the canonical preamble for normal and failed memory loads", async () => {
  seed({
    "/project/.vcc-brain/vcc-brain.md": "private instructions",
    "/home/.vcc-brain/user/vcc-brain.md": "user instructions",
  });
  const loadedSnapshot = await loadMemorySnapshot(context.cwd, context.home, true);
  const loadedRoots = await resolveBrainRoots(context.cwd, context.home);
  expect(await executeCli(["preamble"], context)).toEqual({
    exitCode: 0,
    output: renderPreamble(loadedSnapshot, {
      shared: loadedRoots.sharedDisplay,
      private: loadedRoots.privateDisplay,
      user: loadedRoots.userDisplay,
      legacyIgnored: {
        private: loadedRoots.privateLegacyAlsoExists,
        shared: loadedRoots.sharedLegacyAlsoExists,
        user: loadedRoots.userLegacyAlsoExists,
      },
    }).content,
  });

  fs.rmSync(resolvePath("/project/.vcc-brain"), { recursive: true });
  fs.writeFileSync(resolvePath("/project/.vcc-brain"), "obstructed");
  const failedSnapshot = await loadMemorySnapshot(context.cwd, context.home, true);
  const failedRoots = await resolveBrainRoots(context.cwd, context.home);
  const diagnostic = await executeCli(["preamble"], context);
  expect(diagnostic).toEqual({
    exitCode: 0,
    output: renderPreamble(failedSnapshot, {
      shared: failedRoots.sharedDisplay,
      private: failedRoots.privateDisplay,
      user: failedRoots.userDisplay,
      legacyIgnored: {
        private: failedRoots.privateLegacyAlsoExists,
        shared: failedRoots.sharedLegacyAlsoExists,
        user: failedRoots.userLegacyAlsoExists,
      },
    }).content,
  });
  expect(diagnostic.output).toContain("<vcc-brain-diagnostic>");
});

test("lints frontmatter, shared private references, titles, and non-Markdown files", async () => {
  seed({
    "/project/.vcc-brain-shared/index/index.md":
      '---\ndescription: Shared\nread_if: ""\n---\n# Project Index\n.vcc-brain/private.md',
    "/project/.vcc-brain-shared/index/data.json": "{}",
    "/project/.vcc-brain-shared/index/nested/empty.md":
      '---\ndescription: ""\nread_if: Sometimes\n---\n# Empty',
    "/project/.vcc-brain/index/index.md": "---\ndescription: Private\n---\n# Project Index",
  });

  const result = await executeCli(["index", "lint"], context);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("Empty frontmatter field: read_if");
  expect(result.output).toContain("Empty frontmatter field: description");
  expect(result.output).toContain("Missing frontmatter field: read_if");
  expect(result.output).toContain(
    "Shared index references private path (.vcc-brain/ or .operator/)",
  );
  expect(result.output).toContain("Non-Markdown file in index tree");
  expect(result.output).toContain('Main index title should explicitly state "Shared"');
  expect(result.output).toContain('Main index title should explicitly state "Private"');
});

test("returns success for lint warnings without errors", async () => {
  seed({ "/project/.vcc-brain/index/notes.txt": "notes" });
  const result = await executeCli(["index", "lint"], context);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("⚠ .vcc-brain/index/notes.txt");
});

test("retired guide commands succeed without output or side effects", async () => {
  for (const area of ["user", "project", "index"]) {
    expect(await executeCli([area, "guide"], context)).toEqual({ exitCode: 0, output: "" });
  }
  expect(fs.existsSync(resolvePath("/home/.vcc-brain"))).toBe(false);
});

function mockGit(tracked: string[], configuredIgnore: string | null): void {
  setGitState(tracked, configuredIgnore);
}

function setGitState(trackedFiles: ReadonlyArray<string>, ignorePath: string | null): void {
  tracked = trackedFiles;
  configuredIgnore = ignorePath;
}

function executeCli(arguments_: ReadonlyArray<string>, cliContext: CliContext): Promise<CliResult> {
  return Effect.runPromise(runCli(arguments_, cliContext).pipe(Effect.provide(services)));
}

function seed(files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    const absolutePath = resolvePath(path);
    fs.mkdirSync(dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf8");
  }
}

function resolvePath(path: string): string {
  for (const [root, absoluteRoot] of [
    ["/project", context.cwd],
    ["/home", context.home],
    ["/custom", join(directory, "custom")],
  ] as const) {
    if (path === root || path.startsWith(`${root}/`)) {
      return join(absoluteRoot, path.slice(root.length));
    }
  }
  throw new Error(`Unknown test path: ${path}`);
}
