import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, type FileSystem, Layer, type Path } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";

import { lintProjectIndexes } from "../src/lint.ts";
import { GitError, type GitRunner } from "../src/git.ts";
import { makeGitRunnerLayer } from "./mocks/git-runner.ts";

const services = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  makeGitRunnerLayer(() => Effect.fail(new GitError({ message: "no git" }))),
);

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "operator-helper-lint-"));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

test("returns no findings when index roots are absent", async () => {
  expect(await run(lintProjectIndexes(project))).toEqual([]);
});

test("enforces the Private title when only the Private main index exists", async () => {
  seed({
    ".vcc-brain/index/index.md": "---\ndescription: Main\nread_if: Always\n---\n# Project Index",
  });

  const result = await run(lintProjectIndexes(project));
  expect(result).toContainEqual({
    error: false,
    path: ".vcc-brain/index/index.md",
    message: 'Main index title should explicitly state "Private"',
  });
});

test("requires the literal partition name in each main title", async () => {
  seed({
    ".vcc-brain-shared/index/index.md":
      "---\ndescription: Main\nread_if: Always\n---\n# Public Project Index",
    ".vcc-brain/index/index.md":
      "---\ndescription: Main\nread_if: Always\n---\n# Personal Project Index",
  });

  const result = await run(lintProjectIndexes(project));
  expect(result.map(finding => finding.message)).toEqual([
    'Main index title should explicitly state "Shared"',
    'Main index title should explicitly state "Private"',
    "Index was never stamped — run `index stamp` after refreshing the index.",
    "Index was never stamped — run `index stamp` after refreshing the index.",
  ]);
  expect(result.map(finding => finding.path)).toEqual([
    ".vcc-brain-shared/index/index.md",
    ".vcc-brain/index/index.md",
    ".vcc-brain-shared/index/index.md",
    ".vcc-brain/index/index.md",
  ]);
});

test("checks nested metadata, Shared references, and non-Markdown files", async () => {
  seed({
    ".vcc-brain-shared/index/nested/api.md": "# API\n.vcc-brain/private.md",
    ".vcc-brain-shared/index/data.json": "{}",
  });

  const result = await run(lintProjectIndexes(project));
  expect(result.map(finding => finding.message)).toEqual([
    "Non-Markdown file in index tree",
    "Missing YAML frontmatter",
    "Shared index references private path (.vcc-brain/ or .operator/)",
  ]);
});

test("accepts valid partition-specific main titles", async () => {
  seed({
    ".vcc-brain-shared/index/index.md":
      "---\ndescription: Shared\nread_if: Always\n---\n# Shared Project Index",
    ".vcc-brain/index/index.md":
      "---\ndescription: Private\nread_if: Always\n---\n# Private Project Index",
  });

  expect(await run(lintProjectIndexes(project))).toEqual([
    {
      error: false,
      path: ".vcc-brain-shared/index/index.md",
      message: "Index was never stamped — run `index stamp` after refreshing the index.",
    },
    {
      error: false,
      path: ".vcc-brain/index/index.md",
      message: "Index was never stamped — run `index stamp` after refreshing the index.",
    },
  ]);
});

test("warns on incomplete stamps", async () => {
  seed({
    ".vcc-brain/index/index.md":
      "---\ndescription: Private\nread_if: Always\ntree_hash: abc\n---\n# Private Project Index",
  });

  expect(await run(lintProjectIndexes(project))).toEqual([
    {
      error: false,
      path: ".vcc-brain/index/index.md",
      message: "Index stamp is incomplete — run `index stamp` to rewrite it.",
    },
  ]);
});

test("reports tree-hash failures as errors", async () => {
  seed({
    ".vcc-brain/index/index.md":
      '---\ndescription: Private\nread_if: Always\ntree_hash: abc\nstamped_at: "t"\nstamped_commit: null\n---\n# Private Project Index',
  });
  const gitFails = Layer.mergeAll(
    NodeFileSystem.layer,
    NodePath.layer,
    makeGitRunnerLayer(arguments_ =>
      arguments_.includes("ls-files")
        ? Effect.fail(new GitError({ message: "corrupt" }))
        : Effect.succeed("true\n"),
    ),
  );
  const result = await Effect.runPromise(
    lintProjectIndexes(project).pipe(Effect.provide(gitFails)),
  );
  expect(result).toEqual([
    {
      error: true,
      path: ".vcc-brain/index/index.md",
      message: "Failed to compute tree hash: corrupt",
    },
  ]);
});

function seed(files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(project, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
}

function run<A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | GitRunner.Service>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(services)));
}
