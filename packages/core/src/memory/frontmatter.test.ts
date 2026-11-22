import { expect, test } from "vitest";

import {
  type FrontmatterError,
  type IndexFrontmatter,
  parseIndexFrontmatter,
} from "./frontmatter.ts";
import type { Result } from "../utils.ts";

test("extracts stamp fields alongside description and read_if", () => {
  const frontmatter = unwrap(
    parseIndexFrontmatter(
      '---\ndescription: Main\nread_if: Always\ntree_hash: abc123\nstamped_at: "2026-11-22T00:00:00.000Z"\nstamped_commit: null\n---\n# Index',
    ),
  );

  expect(frontmatter).toEqual({
    description: "Main",
    readIf: "Always",
    treeHash: "abc123",
    stampedAt: "2026-11-22T00:00:00.000Z",
    stampedCommit: null,
  });
});

test("returns null stamps when no stamp fields are present", () => {
  const frontmatter = unwrap(
    parseIndexFrontmatter("---\ndescription: Main\nread_if: Always\n---\n# Index"),
  );

  expect(frontmatter.treeHash).toBeNull();
  expect(frontmatter.stampedAt).toBeNull();
  expect(frontmatter.stampedCommit).toBeNull();
});

test("converts yaml timestamps to iso strings", () => {
  const frontmatter = unwrap(
    parseIndexFrontmatter(
      "---\ndescription: Main\nread_if: Always\ntree_hash: abc\nstamped_at: 2026-11-22T00:00:00.000Z\nstamped_commit: def\n---\n# Index",
    ),
  );

  expect(frontmatter.stampedAt).toBe("2026-11-22T00:00:00.000Z");
  expect(frontmatter.stampedCommit).toBe("def");
});

function unwrap(result: Result<IndexFrontmatter, FrontmatterError>): IndexFrontmatter {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("Expected frontmatter to parse");
  }
  return result.value;
}
