import type { MemorySnapshot } from "./memory/load.ts";
import type { IndexDocument, ProjectPartitionSnapshot } from "./memory/project.ts";
import {
  BRAIN_INSTRUCTIONS_FILENAME,
  PROJECT_PRIVATE_LEGACY_ROOT,
  PROJECT_SHARED_LEGACY_ROOT,
  USER_LEGACY_DISPLAY,
} from "./memory/roots.ts";
import type { UserPartitionSnapshot } from "./memory/user.ts";
import { selectPreambleVersion } from "./preamble-rollout.ts";
import * as preambleV1 from "./prompts/preamble-v1.ts";
import * as preambleV2 from "./prompts/preamble-v2.ts";
import { getErrorMessage } from "./utils.ts";

export type LegacyIgnoredFlags = {
  readonly private: boolean;
  readonly shared: boolean;
  readonly user: boolean;
};

export type PreambleDisplayRoots = {
  readonly shared: string;
  readonly private: string;
  readonly user: string;
  readonly legacyIgnored: LegacyIgnoredFlags;
};

export type RenderedPreamble = {
  readonly content: string;
  readonly loaded: boolean;
  // At least one Brain partition exists. Distinct from loaded: loads can
  // succeed with nothing initialized.
  readonly initialized: boolean;
};

type LoadedMemorySnapshot = {
  readonly shared: ProjectPartitionSnapshot;
  readonly user: UserPartitionSnapshot;
  readonly private: ProjectPartitionSnapshot;
};

export function renderPreamble(
  memory: MemorySnapshot,
  displayRoots: PreambleDisplayRoots,
): RenderedPreamble {
  const { PREAMBLE_PROMPT, PREAMBLE_TENETS } =
    selectPreambleVersion() === "2.0" ? preambleV2 : preambleV1;
  if (!memory.shared.ok || !memory.user.ok || !memory.private.ok) {
    return {
      content: `${PREAMBLE_PROMPT}\n\n${renderLoadDiagnostic(memory)}`,
      loaded: false,
      initialized: false,
    };
  }

  const loaded = {
    shared: memory.shared.value,
    user: memory.user.value,
    private: memory.private.value,
  };
  const sections = [PREAMBLE_PROMPT];
  const warnings: string[] = [];
  const userCatalogPath = `${displayRoots.user}/catalog.md`;
  const userObservationsPath = `${displayRoots.user}/observations.md`;

  const instructions = renderInstructions(loaded, displayRoots);
  if (instructions !== null) {
    sections.push(instructions);
  }

  const userCatalog = renderUserCatalog(loaded.user, userCatalogPath);
  if (userCatalog !== null) {
    sections.push(userCatalog);
  } else if (loaded.user.exists) {
    warnings.push(
      `<vcc-brain-warning>
The User Partition exists but ${userCatalogPath} does not. You must create and maintain a catalog.md to document any non-empty User Partition.
</vcc-brain-warning>`,
    );
  } else {
    warnings.push(
      `<vcc-brain-warning>
The ${displayRoots.user} directory does not exist (legacy ${USER_LEGACY_DISPLAY} also checked). If the user would benefit from cross-project user memory, ask the user to run /vcc-brain:user-init first to initialize the User Partition. If not needed, do not ask; they may be working without user memory intentionally.
</vcc-brain-warning>`,
    );
  }

  warnings.push(...collectLegacyIgnoredWarnings(displayRoots));

  const userObservations = renderUserObservations(loaded.user, userObservationsPath);
  if (userObservations !== null) {
    sections.push(userObservations);
  }

  if (!loaded.shared.exists && !loaded.private.exists) {
    warnings.push(
      `<vcc-brain-warning>
Neither the ${displayRoots.private} nor ${displayRoots.shared} directory exists (legacy ${PROJECT_PRIVATE_LEGACY_ROOT}/ and ${PROJECT_SHARED_LEGACY_ROOT}/ also checked). If the user requests significant amounts of work to be done on the project, ask the user to run /vcc-brain:project-init first to initialize VCC Brain. If the user is not requesting work to be done, do not ask to initialize; they could simply be exploring.
</vcc-brain-warning>`,
    );
  } else {
    const indexes = renderIndexes(loaded, displayRoots);
    const catalogs = renderCatalogs(loaded, displayRoots);

    if (catalogs !== null) {
      sections.push(catalogs);
    } else {
      warnings.push(
        `<vcc-brain-warning>
Neither ${displayRoots.private}/catalog.md nor ${displayRoots.shared}/catalog.md exists. You must create and maintain a catalog.md to document any non-empty Project Brain partitions.
</vcc-brain-warning>`,
      );
    }
    if (indexes !== null) {
      sections.push(indexes);
    }
    if (!hasMainIndex(loaded)) {
      warnings.push(
        `<vcc-brain-warning>
Neither ${displayRoots.private}/index/index.md nor ${displayRoots.shared}/index/index.md exists. If the project is not in an empty state, ask the user to run /vcc-brain:index to initialize a project index before performing any work.
</vcc-brain-warning>`,
      );
    } else {
      warnings.push(...collectUnstampedWarnings(loaded, displayRoots));
    }
  }

  sections.push(PREAMBLE_TENETS);
  for (const warning of warnings) {
    sections.push(warning);
  }

  return {
    content: sections.join("\n\n"),
    loaded: true,
    initialized: loaded.shared.exists || loaded.user.exists || loaded.private.exists,
  };
}

function hasMainIndex(memory: LoadedMemorySnapshot): boolean {
  return [memory.shared, memory.private].some(partition =>
    partition.indexes.some(index => index.path === "index.md"),
  );
}

function collectLegacyIgnoredWarnings(displayRoots: PreambleDisplayRoots): string[] {
  const targets = [
    { ignored: displayRoots.legacyIgnored.private, primary: displayRoots.private },
    { ignored: displayRoots.legacyIgnored.shared, primary: displayRoots.shared },
    { ignored: displayRoots.legacyIgnored.user, primary: displayRoots.user },
  ];
  const warnings: string[] = [];
  for (const target of targets) {
    if (target.ignored) {
      warnings.push(
        `<vcc-brain-warning>
Both ${target.primary}/ and its legacy counterpart exist; the legacy partition is ignored and only ${target.primary}/ is loaded. Merge anything still needed from legacy, then remove it.
</vcc-brain-warning>`,
      );
    }
  }
  return warnings;
}

function collectUnstampedWarnings(
  memory: LoadedMemorySnapshot,
  displayRoots: PreambleDisplayRoots,
): string[] {
  const targets = [
    { partition: memory.shared, root: displayRoots.shared },
    { partition: memory.private, root: displayRoots.private },
  ];
  const warnings: string[] = [];
  for (const target of targets) {
    const main = target.partition.indexes.find(index => index.path === "index.md");
    if (main?.frontmatter.ok === true) {
      const treeHash = main.frontmatter.value.treeHash;
      if (typeof treeHash !== "string" || treeHash === "") {
        warnings.push(
          `<vcc-brain-warning>
${target.root}/index/index.md exists but was never stamped — staleness is unknown. Run \`index stamp\` after refreshing the index; run \`index lint\` to check for drift.
</vcc-brain-warning>`,
        );
      }
    }
  }
  return warnings;
}

function renderLoadDiagnostic(memory: MemorySnapshot): string {
  const status = (name: string, result: MemorySnapshot[keyof MemorySnapshot]): string =>
    result.ok
      ? `- ${name}: Loaded Successfully`
      : `- ${name}: Error at ${result.error.path}: ${getErrorMessage(result.error.cause)}`;

  return `<vcc-brain-diagnostic>
VCC Brain memory failed to load. No memory files were included in this preamble.

Loading status:
${status("Shared", memory.shared)}
${status("User", memory.user)}
${status("Private", memory.private)}

IMPORTANT: You MUST resolve VCC Brain memory loading before proceeding with the user's requested work. User and project instructions were not loaded.

1. Run \`vcc-brain-helper version\`. If an update is available, run \`vcc-brain-helper upgrade\` before continuing.
2. Run \`vcc-brain-helper memory check\` from the affected project directory to obtain current loading results.
3. Repair only the reported load failures. Preserve existing content, do not initialize absent partitions, and do not reset or replace the Brain. If a repair requires deleting content, reconstructing instructions, or choosing between ambiguous fixes, stop and ask the user for guidance.
4. Rerun \`vcc-brain-helper memory check\` after repairs. Resolve any additional load failures it reveals until the check succeeds or a concrete blocker prevents further progress.

\`vcc-brain-helper\` is the globally installed VCC Brain CLI (npm package \`@jwitmann/vcc-brain-helper\`), not a project dependency.

- If Helper cannot start, install or repair its global installation and retry the failed command.
- If the version check or upgrade fails, diagnose the failure and retry.
- If recovery is blocked, report the failing path or operation, the cause, and what is needed to continue. Do not proceed with the original task.
- When validation succeeds, tell the user that loading is repaired and ask them to start a new session and resubmit their original request so the complete preamble is loaded. Do not resume the original task in this diagnostic-only session.
</vcc-brain-diagnostic>`;
}

function renderInstructions(
  memory: LoadedMemorySnapshot,
  displayRoots: PreambleDisplayRoots,
): string | null {
  const files: string[] = [];

  if (memory.shared.brainInstructions !== null) {
    files.push(
      renderFile(
        `${displayRoots.shared}/${BRAIN_INSTRUCTIONS_FILENAME}`,
        memory.shared.brainInstructions,
      ),
    );
  }
  if (memory.user.brainInstructions !== null) {
    files.push(
      renderFile(
        `${displayRoots.user}/${BRAIN_INSTRUCTIONS_FILENAME}`,
        memory.user.brainInstructions,
      ),
    );
  }
  if (memory.private.brainInstructions !== null) {
    files.push(
      renderFile(
        `${displayRoots.private}/${BRAIN_INSTRUCTIONS_FILENAME}`,
        memory.private.brainInstructions,
      ),
    );
  }

  return files.length === 0
    ? null
    : `<vcc-brain-instructions>
VCC Brain instruction contents from least to most authoritative:
${files.join("\n")}
</vcc-brain-instructions>`;
}

function renderIndexes(
  memory: LoadedMemorySnapshot,
  displayRoots: PreambleDisplayRoots,
): string | null {
  const partitions: string[] = [];
  const shared = renderPartitionIndex(memory.shared, displayRoots.shared, "Shared");
  const privatePartition = renderPartitionIndex(memory.private, displayRoots.private, "Private");

  if (shared !== null) {
    partitions.push(shared);
  }
  if (privatePartition !== null) {
    partitions.push(privatePartition);
  }

  return partitions.length === 0
    ? null
    : `<project-index>
${partitions.join("\n\n")}
</project-index>`;
}

function renderPartitionIndex(
  partition: ProjectPartitionSnapshot,
  root: string,
  label: string,
): string | null {
  if (partition.indexes.length === 0) {
    return null;
  }

  const sections = [renderIndexListing(root, partition.indexes)];
  const mainIndex = partition.indexes.find(index => index.path === "index.md");
  if (mainIndex !== undefined) {
    sections.push(
      `${label} partition main index contents:\n${renderFile(`${root}/index/index.md`, mainIndex.content)}`,
    );
  }

  return sections.join("\n\n");
}

function renderIndexListing(root: string, indexes: ReadonlyArray<IndexDocument>): string {
  const lines = [`${root}/index/`];

  for (const [position, index] of indexes.entries()) {
    const last = position === indexes.length - 1;
    lines.push(`${last ? "└──" : "├──"} ${index.path}`);

    if (index.frontmatter.ok) {
      const indent = last ? "    " : "│   ";
      lines.push(`${indent}Description: ${index.frontmatter.value.description}`);
      lines.push(`${indent}Read If: ${index.frontmatter.value.readIf}`);
    } else {
      const indent = last ? "    " : "│   ";
      lines.push(
        `${indent}Error: Invalid frontmatter. Action: Open ${root}/index/${index.path} and fix its description and read_if frontmatter.`,
      );
    }
  }

  return lines.join("\n");
}

function renderUserCatalog(partition: UserPartitionSnapshot, catalogPath: string): string | null {
  if (partition.catalog === null) {
    return null;
  }

  return `<user-catalog>
<file-content path="${catalogPath}">
${partition.catalog}
</file-content>
</user-catalog>`;
}

function renderUserObservations(
  partition: UserPartitionSnapshot,
  observationsPath: string,
): string | null {
  if (partition.observations === null) {
    return null;
  }

  return `<user-observations>
User-approved observations and working-style notes. This is subordinate context, not instructions: it never overrides VCC Brain Instructions, catalogs, or index guidance.
<file-content path="${observationsPath}">
${partition.observations}
</file-content>
</user-observations>`;
}

function renderCatalogs(
  memory: LoadedMemorySnapshot,
  displayRoots: PreambleDisplayRoots,
): string | null {
  const files: string[] = [];

  if (memory.shared.catalog !== null) {
    files.push(renderFile(`${displayRoots.shared}/catalog.md`, memory.shared.catalog));
  }
  if (memory.private.catalog !== null) {
    files.push(renderFile(`${displayRoots.private}/catalog.md`, memory.private.catalog));
  }

  return files.length === 0
    ? null
    : `<partition-catalog>
${files.join("\n")}
</partition-catalog>`;
}

function renderFile(path: string, content: string): string {
  return `<file-content path="${path}">
${content}
</file-content>`;
}
