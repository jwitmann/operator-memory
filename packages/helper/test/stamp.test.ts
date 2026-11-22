import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, type FileSystem, Layer, type Path } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";

import { indexStamp } from "../src/commands/index/stamp.ts";
import { GitError, type GitRunner } from "../src/git.ts";
import { lintProjectIndexes } from "../src/lint.ts";
import { computeTreeHash, readStampFields, stampFrontmatter } from "../src/tree-hash.ts";
import { makeGitRunnerLayer } from "./mocks/git-runner.ts";

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "operator-helper-stamp-"));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

const MAIN = `---
description: Private
read_if: Always
---
# Private Project Index
`;

test("stampFrontmatter inserts keys and preserves everything else", () => {
  const content = `${MAIN}\nBody text.\n`;
  const stamped = stampFrontmatter(content, {
    treeHash: "abc",
    stampedAt: "2026-11-22T00:00:00.000Z",
    commit: "deadbeef",
  });
  expect(stamped).not.toBeNull();
  expect(stamped).toContain("tree_hash: abc\n");
  expect(stamped).toContain('stamped_at: "2026-11-22T00:00:00.000Z"\n');
  expect(stamped).toContain("stamped_commit: deadbeef\n");
  expect(stamped).toContain("# Private Project Index\n");
  expect(stamped).toContain("Body text.\n");
  expect(readStampFields(stamped ?? "")).toEqual({
    treeHash: "abc",
    stampedAt: "2026-11-22T00:00:00.000Z",
    stampedCommit: "deadbeef",
    complete: true,
  });
});

test("stampFrontmatter replaces existing keys and writes null commits", () => {
  const once =
    '---\ndescription: D\nread_if: R\ntree_hash: old\nstamped_at: "old"\nstamped_commit: old\n---\n# Title\n';
  const twice = stampFrontmatter(once, { treeHash: "new", stampedAt: "now", commit: null });
  expect(twice).not.toBeNull();
  expect(twice).not.toContain("old\n");
  expect(twice).toContain("tree_hash: new\n");
  expect(twice).toContain("stamped_commit: null\n");
  expect(twice).toContain("# Title\n");
  const again = stampFrontmatter(twice ?? "", { treeHash: "new", stampedAt: "now", commit: null });
  expect(again).toEqual(twice);
});

test("stampFrontmatter returns null without a frontmatter block", () => {
  expect(
    stampFrontmatter("# No frontmatter\n", { treeHash: "x", stampedAt: "y", commit: null }),
  ).toBeNull();
  expect(readStampFields("# No frontmatter\n")).toEqual({
    treeHash: null,
    stampedAt: null,
    stampedCommit: null,
    complete: false,
  });
});

test("readStampFields treats an explicit null commit as a complete stamp", () => {
  const stamped = stampFrontmatter(MAIN, {
    treeHash: "abc",
    stampedAt: "2026-11-22T00:00:00.000Z",
    commit: null,
  });
  expect(readStampFields(stamped ?? "")).toEqual({
    treeHash: "abc",
    stampedAt: "2026-11-22T00:00:00.000Z",
    stampedCommit: null,
    complete: true,
  });
});

test("readStampFields parses quoted values and ignores comments", () => {
  const content = `---
description: D
tree_hash: 'abc123' # rotated last week
stamped_at: "2026-11-22T00:00:00.000Z"
stamped_commit: null
read_if: Always
---
# Title
`;
  expect(readStampFields(content)).toEqual({
    treeHash: "abc123",
    stampedAt: "2026-11-22T00:00:00.000Z",
    stampedCommit: null,
    complete: true,
  });
});

test("computeTreeHash ignores content edits but sees structural change", async () => {
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src", "a.ts"), "v1", "utf8");
  const before = await runWalk(computeTreeHash(project));
  writeFileSync(join(project, "src", "a.ts"), "v2 with more content", "utf8");
  expect(await runWalk(computeTreeHash(project))).toEqual(before);
  writeFileSync(join(project, "src", "b.ts"), "new file", "utf8");
  const after = await runWalk(computeTreeHash(project));
  expect(after.hash).not.toEqual(before.hash);
  expect(after.commit).toBeNull();
});

test("computeTreeHash skips brain and build trees", async () => {
  mkdirSync(join(project, ".vcc-brain", "index"), { recursive: true });
  mkdirSync(join(project, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(project, ".vcc-brain", "index", "index.md"), "brain", "utf8");
  writeFileSync(join(project, "node_modules", "dep", "i.js"), "dep", "utf8");
  const before = await runWalk(computeTreeHash(project));
  writeFileSync(join(project, ".vcc-brain", "index", "index.md"), "brain changed", "utf8");
  writeFileSync(join(project, "node_modules", "dep", "i.js"), "dep changed", "utf8");
  expect(await runWalk(computeTreeHash(project))).toEqual(before);
});

test("computeTreeHash prefers git ls-files and records the commit", async () => {
  const result = await runGit(
    computeTreeHash(project),
    {
      probe: "true\n",
      ls: "b/a.ts\0a.ts\0.vcc-brain/index/index.md\0",
      head: "deadbeef\n",
    },
    false,
    false,
  );
  expect(result.commit).toEqual("deadbeef");
  expect(result.hash).toEqual(createHash("sha256").update("a.ts\nb/a.ts", "utf8").digest("hex"));
});

test("computeTreeHash falls back to the walk when git is unavailable", async () => {
  writeFileSync(join(project, "a.ts"), "x", "utf8");
  const result = await runGit(
    computeTreeHash(project),
    { probe: "true\n", ls: "", head: "" },
    true,
    false,
  );
  expect(result.commit).toBeNull();
  expect(result.hash).toEqual(createHash("sha256").update("a.ts", "utf8").digest("hex"));
});

test("computeTreeHash records a null commit when HEAD cannot resolve", async () => {
  const result = await runGit(
    computeTreeHash(project),
    { probe: "true\n", ls: "a.ts\0", head: "" },
    false,
    true,
  );
  expect(result.commit).toBeNull();
});

test("indexStamp round-trips through lint, then warns on drift", async () => {
  mkdirSync(join(project, ".vcc-brain", "index"), { recursive: true });
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, ".vcc-brain", "index", "index.md"), MAIN, "utf8");
  writeFileSync(join(project, "src", "a.ts"), "v1", "utf8");

  const stamped = await runWalk(
    indexStamp({ cwd: project, home: project, xdgConfigHome: null, version: "0" }),
  );
  expect(stamped.exitCode).toEqual(0);
  expect(stamped.output).toMatch(/stamped [0-9a-f]{12}/);
  const file = readFileSync(join(project, ".vcc-brain", "index", "index.md"), "utf8");
  expect(file).toContain("description: Private\n");

  const clean = await runWalk(lintProjectIndexes(project));
  expect(clean.filter(finding => finding.path === ".vcc-brain/index/index.md")).toEqual([]);

  writeFileSync(join(project, "src", "a.ts"), "v2", "utf8");
  const churn = await runWalk(lintProjectIndexes(project));
  expect(churn.filter(finding => finding.path === ".vcc-brain/index/index.md")).toEqual([]);

  writeFileSync(join(project, "src", "b.ts"), "new", "utf8");
  const drifted = await runWalk(lintProjectIndexes(project));
  const stale = drifted.filter(finding => finding.path === ".vcc-brain/index/index.md");
  expect(stale).toHaveLength(1);
  expect(stale[0]?.error).toEqual(false);
  expect(stale[0]?.message).toMatch(
    /^Index is stale \(tree changed since .*\)\. Run 'index stamp'/,
  );
});

test("indexStamp fails without a main index and on malformed frontmatter", async () => {
  const missing = await runWalk(
    indexStamp({ cwd: project, home: project, xdgConfigHome: null, version: "0" }),
  );
  expect(missing.exitCode).toEqual(1);
  expect(missing.output).toContain("No main index found");

  mkdirSync(join(project, ".vcc-brain", "index"), { recursive: true });
  writeFileSync(join(project, ".vcc-brain", "index", "index.md"), "# No block\n", "utf8");
  const malformed = await runWalk(
    indexStamp({ cwd: project, home: project, xdgConfigHome: null, version: "0" }),
  );
  expect(malformed.exitCode).toEqual(1);
  expect(malformed.output).toContain("malformed frontmatter");
});

type GitFixture = { probe: string; ls: string; head: string };

function gitLayerFor(
  fixture: GitFixture,
  failProbe: boolean,
  failHead: boolean,
): Layer.Layer<GitRunner.Service> {
  return makeGitRunnerLayer(arguments_ => {
    if (arguments_.includes("rev-parse") && arguments_.includes("--is-inside-work-tree")) {
      return failProbe
        ? Effect.fail(new GitError({ message: "no git" }))
        : Effect.succeed(fixture.probe);
    }
    if (arguments_.includes("ls-files")) {
      return Effect.succeed(fixture.ls);
    }
    if (arguments_.includes("rev-parse")) {
      return failHead
        ? Effect.fail(new GitError({ message: "no HEAD" }))
        : Effect.succeed(fixture.head);
    }
    return Effect.fail(new GitError({ message: `unexpected: ${arguments_.join(" ")}` }));
  });
}

const baseServices = Layer.merge(NodeFileSystem.layer, NodePath.layer);

function runWalk<A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | GitRunner.Service>,
): Promise<A> {
  const probeFails = makeGitRunnerLayer(() => Effect.fail(new GitError({ message: "no git" })));
  return Effect.runPromise(effect.pipe(Effect.provide(Layer.merge(baseServices, probeFails))));
}

function runGit<A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | GitRunner.Service>,
  fixture: GitFixture,
  failProbe: boolean,
  failHead: boolean,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(Layer.merge(baseServices, gitLayerFor(fixture, failProbe, failHead))),
    ),
  );
}
