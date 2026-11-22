import { Effect, Path, Result } from "effect";
import { parseDocument } from "yaml";

import { listFiles, readText } from "./filesystem.ts";
import { computeTreeHash, FRONTMATTER_PATTERN, readStampFields } from "./tree-hash.ts";
import { getErrorMessage, isRecord } from "./utils.ts";

export const PARTITIONS = [
  { root: ".operator-shared", title: "Shared", shared: true },
  { root: ".operator", title: "Private", shared: false },
] as const;

type Metadata = {
  readonly description: string | null;
  readonly readIf: string | null;
  readonly errors: ReadonlyArray<string>;
};

export type LintFinding = {
  readonly error: boolean;
  readonly path: string;
  readonly message: string;
};

export const lintProjectIndexes = Effect.fn("lintProjectIndexes")(function* (cwd: string) {
  const pathService = yield* Path.Path;
  const findings: LintFinding[] = [];
  const mains: Array<{ displayPath: string; content: string }> = [];

  for (const partition of PARTITIONS) {
    const root = pathService.join(cwd, partition.root, "index");
    const files = yield* listFiles(root);

    for (const file of files) {
      const displayPath = `${partition.root}/index/${file.relativePath}`;
      if (pathService.extname(file.path) !== ".md") {
        findings.push({
          error: false,
          path: displayPath,
          message: "Non-Markdown file in index tree",
        });
        continue;
      }

      const content = yield* readText(file.path);
      findings.push(...checkMetadata(displayPath, content));

      if (partition.shared && content.includes(".operator/")) {
        findings.push({
          error: true,
          path: displayPath,
          message: "Shared index references private path (.operator/)",
        });
      }
      if (file.relativePath === "index.md") {
        const title = /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? null;
        if (title === null || !new RegExp(`\\b${partition.title}\\b`, "i").test(title)) {
          findings.push({
            error: false,
            path: displayPath,
            message: `Main index title should explicitly state "${partition.title}"`,
          });
        }
        mains.push({ displayPath, content });
      }
    }
  }

  findings.push(...(yield* checkStaleness(cwd, mains)));

  return findings;
});

const checkStaleness = Effect.fn("checkStaleness")(function* (
  cwd: string,
  mains: ReadonlyArray<{ displayPath: string; content: string }>,
) {
  const findings: LintFinding[] = [];
  const stamped = mains.map(main => ({ ...main, stamp: readStampFields(main.content) }));
  for (const main of stamped) {
    if (main.stamp.treeHash === null) {
      findings.push({
        error: false,
        path: main.displayPath,
        message: "Index was never stamped — run `index stamp` after refreshing the index.",
      });
    } else if (!main.stamp.complete) {
      findings.push({
        error: false,
        path: main.displayPath,
        message: "Index stamp is incomplete — run `index stamp` to rewrite it.",
      });
    }
  }
  const complete = stamped.filter(main => main.stamp.complete);
  if (complete.length === 0) {
    return findings;
  }
  const hashed = yield* computeTreeHash(cwd).pipe(
    Effect.map(tree => ({ ok: true as const, tree })),
    Effect.catch(error => Effect.succeed({ ok: false as const, message: getErrorMessage(error) })),
  );
  if (!hashed.ok) {
    findings.push({
      error: true,
      path: complete[0]?.displayPath ?? "index",
      message: `Failed to compute tree hash: ${hashed.message}`,
    });
    return findings;
  }
  for (const main of complete) {
    if (main.stamp.treeHash !== hashed.tree.hash) {
      findings.push({
        error: false,
        path: main.displayPath,
        message: `Index is stale (tree changed since ${main.stamp.stampedAt ?? "unknown date"}: ${main.stamp.treeHash?.slice(0, 12)} → ${hashed.tree.hash.slice(0, 12)}). Run 'index stamp' after refreshing the index.`,
      });
    }
  }
  return findings;
});

function checkMetadata(path: string, content: string): LintFinding[] {
  const metadata = readMetadata(content);
  const findings = metadata.errors.map(message => ({ error: true, path, message }));
  if (metadata.description?.trim() === "") {
    findings.push({ error: true, path, message: "Empty frontmatter field: description" });
  }
  if (metadata.readIf?.trim() === "") {
    findings.push({ error: true, path, message: "Empty frontmatter field: read_if" });
  }
  return findings;
}

function readMetadata(content: string): Metadata {
  const source = FRONTMATTER_PATTERN.exec(content)?.[1];
  if (source === undefined) {
    return {
      description: null,
      readIf: null,
      errors: ["Missing YAML frontmatter"],
    };
  }

  const parsed = Result.try({
    try: () => parseDocument(source, { uniqueKeys: true }),
    catch: getErrorMessage,
  });
  if (Result.isFailure(parsed)) {
    return { description: null, readIf: null, errors: [parsed.failure] };
  }
  const document = parsed.success;
  if (document.errors.length > 0) {
    return {
      description: null,
      readIf: null,
      errors: document.errors.map(error => error.message),
    };
  }
  const value: unknown = document.toJS();
  if (!isRecord(value)) {
    return { description: null, readIf: null, errors: ["Frontmatter must be a YAML mapping"] };
  }
  const description = typeof value.description === "string" ? value.description : null;
  const readIf = typeof value.read_if === "string" ? value.read_if : null;
  const errors: string[] = [];
  if (description === null) {
    errors.push("Missing frontmatter field: description");
  }
  if (readIf === null) {
    errors.push("Missing frontmatter field: read_if");
  }
  return { description, readIf, errors };
}
