import { createHash } from "node:crypto";

import { Effect, Result } from "effect";
import { parseDocument } from "yaml";

import { listFiles } from "./filesystem.ts";
import { GitRunner } from "./git.ts";
import { compareStrings, getErrorMessage, isRecord } from "./utils.ts";

export const FRONTMATTER_PATTERN = /^---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)/;

export type TreeHash = {
  readonly hash: string;
  readonly commit: string | null;
};

export type StampInput = {
  readonly treeHash: string;
  readonly stampedAt: string;
  readonly commit: string | null;
};

export type StampFields = {
  readonly treeHash: string | null;
  readonly stampedAt: string | null;
  readonly stampedCommit: string | null;
  readonly complete: boolean;
};

const BRAIN_ROOTS = new Set([".vcc-brain", ".vcc-brain-shared", ".operator", ".operator-shared"]);

const WALK_PRUNED_SEGMENTS = new Set([
  ...BRAIN_ROOTS,
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  "coverage",
  ".next",
  "vendor",
  "__pycache__",
  ".venv",
]);

function hashEntries(entries: ReadonlyArray<string>): string {
  return createHash("sha256").update(entries.join("\n"), "utf8").digest("hex");
}

function isCoveredGitEntry(entry: string): boolean {
  const firstSegment = entry.split("/", 1)[0];
  return firstSegment !== undefined && !BRAIN_ROOTS.has(firstSegment);
}

function isCoveredWalkEntry(relativePath: string): boolean {
  const segments = relativePath.split("/");
  if (segments[segments.length - 1] === ".DS_Store") {
    return false;
  }
  return !segments.some(segment => WALK_PRUNED_SEGMENTS.has(segment));
}

export const computeTreeHash = Effect.fn("computeTreeHash")(function* (cwd: string) {
  const git = yield* GitRunner.Service;
  const insideWorkTree = yield* git.run(["rev-parse", "--is-inside-work-tree"], cwd).pipe(
    Effect.map(output => output.trim() === "true"),
    Effect.catch(() => Effect.succeed(false)),
  );
  if (insideWorkTree) {
    const raw = yield* git.run(["ls-files", "--cached", "-z"], cwd);
    const entries = raw
      .split("\0")
      .filter(entry => entry.length > 0)
      .filter(isCoveredGitEntry)
      .sort(compareStrings);
    const commit = yield* git.run(["rev-parse", "HEAD"], cwd).pipe(
      Effect.map(output => output.trim() as string | null),
      Effect.catch(() => Effect.succeed<string | null>(null)),
    );
    return { hash: hashEntries(entries), commit };
  }
  const files = yield* listFiles(cwd);
  const entries = files
    .map(file => file.relativePath)
    .filter(isCoveredWalkEntry)
    .sort(compareStrings);
  return { hash: hashEntries(entries), commit: null };
});

export function readStampFields(content: string): StampFields {
  const empty: StampFields = {
    treeHash: null,
    stampedAt: null,
    stampedCommit: null,
    complete: false,
  };
  const match = FRONTMATTER_PATTERN.exec(content);
  if (match === null) {
    return empty;
  }
  const parsed = Result.try({
    try: () => parseDocument(match[1] ?? "", { uniqueKeys: true }),
    catch: getErrorMessage,
  });
  if (Result.isFailure(parsed) || parsed.success.errors.length > 0) {
    return empty;
  }
  const value: unknown = parsed.success.toJS();
  if (!isRecord(value)) {
    return empty;
  }
  const getString = (key: string): string | null => {
    const field: unknown = value[key];
    if (typeof field === "string") {
      return field;
    }
    return field instanceof Date ? field.toISOString() : null;
  };
  return {
    treeHash: getString("tree_hash"),
    stampedAt: getString("stamped_at"),
    stampedCommit: getString("stamped_commit"),
    complete:
      typeof value.tree_hash === "string"
      && typeof value.stamped_at === "string"
      && "stamped_commit" in value,
  };
}

export function stampFrontmatter(content: string, stamp: StampInput): string | null {
  const match = FRONTMATTER_PATTERN.exec(content);
  if (match === null) {
    return null;
  }
  const full = match[0];
  const inner = match[1] ?? "";
  const newline = full.includes("\r\n") ? "\r\n" : "\n";
  const lines = inner.length === 0 ? [] : inner.split(/\r?\n/);
  const wanted: ReadonlyArray<readonly [string, string]> = [
    ["tree_hash", stamp.treeHash],
    ["stamped_at", `"${stamp.stampedAt}"`],
    ["stamped_commit", stamp.commit ?? "null"],
  ];
  const remaining = new Map(wanted);
  const next = lines.map(line => {
    const key = /^\s*([A-Za-z0-9_-]+)\s*:/.exec(line)?.[1];
    if (key !== undefined) {
      const value = remaining.get(key);
      if (value !== undefined) {
        remaining.delete(key);
        return `${key}: ${value}`;
      }
    }
    return line;
  });
  for (const [key, value] of remaining) {
    next.push(`${key}: ${value}`);
  }
  const head = full.slice(0, full.indexOf("\n") + 1);
  const tailMatch = /(\r?\n---[\t ]*(?:\r?\n|$))$/.exec(full);
  if (tailMatch === null || tailMatch[1] === undefined) {
    return null;
  }
  const tail = tailMatch[1];
  const separatorLength = tail.startsWith("\r\n") ? 2 : 1;
  const fence = tail.slice(separatorLength);
  const body = next.length === 0 ? "" : `${next.join(newline)}${newline}`;
  return `${content.slice(0, match.index)}${head}${body}${fence}${content.slice(match.index + full.length)}`;
}
