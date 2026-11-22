import { afterEach, expect, test, vi } from "vitest";

import type { MemorySnapshot } from "./memory/load.ts";
import type { ProjectPartitionSnapshot } from "./memory/project.ts";
import type { UserPartitionSnapshot } from "./memory/user.ts";
import { renderPreamble as renderMemoryPreamble } from "./preamble.ts";
import { selectPreambleVersion } from "./preamble-rollout.ts";
import { PREAMBLE_PROMPT, PREAMBLE_TENETS } from "./prompts/preamble-v1.ts";
import * as preambleV2 from "./prompts/preamble-v2.ts";
import { CATALOG_TEMPLATE } from "./templates/catalog.ts";
import { PROJECT_INDEX_TEMPLATE } from "./templates/project-index.ts";
import { PROJECT_SUBINDEX_TEMPLATE } from "./templates/project-subindex.ts";
import { failure, success } from "./utils.ts";

vi.mock("./preamble-rollout.ts", () => ({ selectPreambleVersion: vi.fn(() => "1.1") }));

const PRIMARY_DISPLAY_ROOTS = {
  shared: ".vcc-brain-shared",
  private: ".vcc-brain",
  user: "~/.vcc-brain/user",
  legacyIgnored: { private: false, shared: false, user: false },
} as const;

afterEach(() => {
  vi.mocked(selectPreambleVersion).mockReturnValue("1.1");
});

test("embeds core document templates in fixed guidance", () => {
  expect(PREAMBLE_PROMPT).toContain(PROJECT_INDEX_TEMPLATE.trimEnd());
  expect(PREAMBLE_PROMPT).toContain(PROJECT_SUBINDEX_TEMPLATE.trimEnd());
  expect(PREAMBLE_PROMPT).toContain(CATALOG_TEMPLATE.trimEnd());
  expect(preambleV2.PREAMBLE_PROMPT).toContain(PROJECT_INDEX_TEMPLATE.trimEnd());
  expect(preambleV2.PREAMBLE_PROMPT).toContain(PROJECT_SUBINDEX_TEMPLATE.trimEnd());
  expect(preambleV2.PREAMBLE_PROMPT).toContain(CATALOG_TEMPLATE.trimEnd());
});

test.each(["1.1", "2.0"] as const)("renders matching guidance and tenets for v%s", version => {
  vi.mocked(selectPreambleVersion).mockReturnValue(version);
  const content = renderPreamble({
    shared: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
    user: { exists: false, brainInstructions: null, catalog: null, observations: null },
    private: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
  });
  const prompt = version === "2.0" ? preambleV2 : { PREAMBLE_PROMPT, PREAMBLE_TENETS };
  expect(content.startsWith(prompt.PREAMBLE_PROMPT)).toBe(true);
  expect(content).toContain(prompt.PREAMBLE_TENETS);
  expect(content).toContain(`<vcc-brain-guidance version="${version}">`);
  expect(content).toContain(`<vcc-brain-tenets version="${version}">`);
  expect(content).not.toContain(`version="${version === "2.0" ? "1.1" : "2.0"}"`);
});

test("renders fixed guidance and the missing-catalog warning for empty memory", () => {
  const memory: LoadedMemorySnapshot = {
    shared: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
    user: { exists: false, brainInstructions: null, catalog: null, observations: null },
    private: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
  };

  expect(renderPreamble(memory)).toBe(`${PREAMBLE_PROMPT}

${PREAMBLE_TENETS}

<vcc-brain-warning>
The ~/.vcc-brain/user directory does not exist (legacy ~/.operator/user also checked). If the user would benefit from cross-project user memory, ask the user to run /vcc-brain:user-init first to initialize the User Partition. If not needed, do not ask; they may be working without user memory intentionally.
</vcc-brain-warning>

<vcc-brain-warning>
Neither the .vcc-brain nor .vcc-brain-shared directory exists (legacy .operator/ and .operator-shared/ also checked). If the user requests significant amounts of work to be done on the project, ask the user to run /vcc-brain:project-init first to initialize VCC Brain. If the user is not requesting work to be done, do not ask to initialize; they could simply be exploring.
</vcc-brain-warning>`);
});

test("renders conditional memory in authority and partition order", () => {
  const memory: LoadedMemorySnapshot = {
    shared: {
      exists: true,
      brainInstructions: "shared instructions",
      catalog: "shared catalog",
      indexes: [
        {
          path: "index.md",
          content: "shared main index",
          frontmatter: success({
            description: "Shared map",
            readIf: "Always",
            treeHash: "abc",
            stampedAt: "2026-11-22T00:00:00.000Z",
            stampedCommit: null,
          }),
        },
        {
          path: "packages/core.md",
          content: "subindex body must not be injected",
          frontmatter: failure({ kind: "invalid", message: "Invalid frontmatter" }),
        },
      ],
    },
    user: {
      exists: true,
      brainInstructions: "user instructions",
      catalog: "user catalog",
      observations: null,
    },
    private: {
      exists: true,
      brainInstructions: "private instructions",
      catalog: "private catalog",
      indexes: [
        {
          path: "index.md",
          content: "private main index",
          frontmatter: success({
            description: "Private map",
            readIf: "Private work",
            treeHash: "def",
            stampedAt: "2026-11-22T00:00:00.000Z",
            stampedCommit: null,
          }),
        },
      ],
    },
  };

  expect(renderPreamble(memory)).toBe(`${PREAMBLE_PROMPT}

<vcc-brain-instructions>
VCC Brain instruction contents from least to most authoritative:
<file-content path=".vcc-brain-shared/vcc-brain.md">
shared instructions
</file-content>
<file-content path="~/.vcc-brain/user/vcc-brain.md">
user instructions
</file-content>
<file-content path=".vcc-brain/vcc-brain.md">
private instructions
</file-content>
</vcc-brain-instructions>

<user-catalog>
<file-content path="~/.vcc-brain/user/catalog.md">
user catalog
</file-content>
</user-catalog>

<partition-catalog>
<file-content path=".vcc-brain-shared/catalog.md">
shared catalog
</file-content>
<file-content path=".vcc-brain/catalog.md">
private catalog
</file-content>
</partition-catalog>

<project-index>
.vcc-brain-shared/index/
├── index.md
│   Description: Shared map
│   Read If: Always
└── packages/core.md
    Error: Invalid frontmatter. Action: Open .vcc-brain-shared/index/packages/core.md and fix its description and read_if frontmatter.

Shared partition main index contents:
<file-content path=".vcc-brain-shared/index/index.md">
shared main index
</file-content>

.vcc-brain/index/
└── index.md
    Description: Private map
    Read If: Private work

Private partition main index contents:
<file-content path=".vcc-brain/index/index.md">
private main index
</file-content>
</project-index>

${PREAMBLE_TENETS}`);
});

test("renders identical bytes for the same snapshot", () => {
  const memory: LoadedMemorySnapshot = {
    shared: { exists: true, brainInstructions: null, catalog: "catalog", indexes: [] },
    user: { exists: false, brainInstructions: null, catalog: null, observations: null },
    private: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
  };

  expect(renderPreamble(memory)).toBe(renderPreamble(memory));
});

test("renders index listing connectors and metadata for every valid index", () => {
  const memory: LoadedMemorySnapshot = {
    shared: {
      exists: true,
      brainInstructions: null,
      catalog: "catalog",
      indexes: [
        {
          path: "index.md",
          content: "main index",
          frontmatter: success({
            description: "Main",
            readIf: "Always",
            treeHash: "abc",
            stampedAt: "2026-11-22T00:00:00.000Z",
            stampedCommit: null,
          }),
        },
        {
          path: "packages/core.md",
          content: "core body",
          frontmatter: success({
            description: "Core",
            readIf: "Core work",
            treeHash: null,
            stampedAt: null,
            stampedCommit: null,
          }),
        },
        {
          path: "packages/helper.md",
          content: "helper body",
          frontmatter: success({
            description: "Helper",
            readIf: "CLI work",
            treeHash: null,
            stampedAt: null,
            stampedCommit: null,
          }),
        },
      ],
    },
    user: { exists: false, brainInstructions: null, catalog: null, observations: null },
    private: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
  };

  const preamble = renderPreamble(memory);

  expect(preamble).toContain(`.vcc-brain-shared/index/
├── index.md
│   Description: Main
│   Read If: Always
├── packages/core.md
│   Description: Core
│   Read If: Core work
└── packages/helper.md
    Description: Helper
    Read If: CLI work`);
  expect(preamble).toContain(`<file-content path=".vcc-brain-shared/index/index.md">
main index
</file-content>`);
  expect(preamble).not.toContain("core body");
  expect(preamble).not.toContain("helper body");
});

test("renders an index listing without a main index body", () => {
  const memory: LoadedMemorySnapshot = {
    shared: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
    user: { exists: false, brainInstructions: null, catalog: null, observations: null },
    private: {
      exists: true,
      brainInstructions: null,
      catalog: "catalog",
      indexes: [
        {
          path: "source.md",
          content: "source body",
          frontmatter: success({
            description: "Source",
            readIf: "Source work",
            treeHash: null,
            stampedAt: null,
            stampedCommit: null,
          }),
        },
      ],
    },
  };

  const preamble = renderPreamble(memory);

  expect(preamble).toContain(`.vcc-brain/index/
└── source.md
    Description: Source
    Read If: Source work`);
  expect(preamble).not.toContain("partition main index contents:");
  expect(preamble).not.toContain("source body");
  expect(preamble).toContain(
    "Neither .vcc-brain/index/index.md nor .vcc-brain-shared/index/index.md exists",
  );
});

test("renders only available instructions and catalogs", () => {
  const memory: LoadedMemorySnapshot = {
    shared: { exists: true, brainInstructions: null, catalog: "shared catalog", indexes: [] },
    user: {
      exists: true,
      brainInstructions: "user instructions",
      catalog: "user catalog",
      observations: null,
    },
    private: {
      exists: true,
      brainInstructions: "private instructions",
      catalog: null,
      indexes: [],
    },
  };

  const preamble = renderPreamble(memory);

  expect(preamble).not.toContain('<file-content path=".vcc-brain-shared/vcc-brain.md">');
  expect(preamble).toContain('<file-content path="~/.vcc-brain/user/vcc-brain.md">');
  expect(preamble).toContain('<file-content path=".vcc-brain/vcc-brain.md">');
  expect(preamble).toContain('<file-content path=".vcc-brain-shared/catalog.md">');
  expect(preamble).toContain('<file-content path="~/.vcc-brain/user/catalog.md">');
  expect(preamble).not.toContain('<file-content path=".vcc-brain/catalog.md">');
  expect(preamble).not.toContain("Neither .vcc-brain/catalog.md");
  expect(preamble).not.toContain("~/.vcc-brain/user/catalog.md does not");
});

test("renders component warnings for an existing empty project partition", () => {
  const memory: LoadedMemorySnapshot = {
    shared: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
    user: { exists: false, brainInstructions: null, catalog: null, observations: null },
    private: { exists: true, brainInstructions: null, catalog: null, indexes: [] },
  };

  const preamble = renderPreamble(memory);

  expect(preamble).not.toContain("Ask the user to run /vcc-brain:project-init");
  expect(preamble).toContain("ask the user to run /vcc-brain:index");
  expect(preamble).toContain("You must create and maintain a catalog.md");
  expect(preamble.indexOf(PREAMBLE_TENETS)).toBeLessThan(preamble.indexOf("<vcc-brain-warning>"));
});

test("injects the user catalog without a project brain", () => {
  const memory: LoadedMemorySnapshot = {
    shared: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
    user: { exists: true, brainInstructions: null, catalog: "user catalog", observations: null },
    private: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
  };

  const preamble = renderPreamble(memory);

  expect(preamble).toContain("<user-catalog>");
  expect(preamble).toContain('<file-content path="~/.vcc-brain/user/catalog.md">');
  expect(preamble).not.toContain("<project-index>");
  expect(preamble).not.toContain("<partition-catalog>");
});

test("warns about a missing user catalog independently of project catalogs", () => {
  const memory: LoadedMemorySnapshot = {
    shared: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
    user: {
      exists: true,
      brainInstructions: "user instructions",
      catalog: null,
      observations: null,
    },
    private: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
  };

  const preamble = renderPreamble(memory);

  expect(preamble).toContain("~/.vcc-brain/user/catalog.md does not");
  expect(preamble).not.toContain(
    "You must create and maintain a catalog.md to document any non-empty Project Brain partitions.",
  );
  expect(preamble).not.toContain("<user-catalog>");
});

test.each(["1.1", "2.0"] as const)(
  "renders v%s guidance and only recovery diagnostics on load failure",
  version => {
    vi.mocked(selectPreambleVersion).mockReturnValue(version);
    const rendered = renderMemoryPreamble(
      {
        shared: success({
          exists: true,
          brainInstructions: "must not be rendered",
          catalog: "must not be rendered",
          indexes: [],
        }),
        user: failure({ path: "/home/.vcc-brain/user/vcc-brain.md", cause: new Error("denied") }),
        private: failure({ path: "/project/.vcc-brain/index", cause: new Error("obstructed") }),
      },
      PRIMARY_DISPLAY_ROOTS,
    );

    expect(rendered.loaded).toBe(false);
    expect(rendered.content).toContain(`<vcc-brain-guidance version="${version}">`);
    expect(rendered.content).toContain("- Shared: Loaded");
    expect(rendered.content).toContain(
      "- User: Error at /home/.vcc-brain/user/vcc-brain.md: denied",
    );
    expect(rendered.content).toContain("- Private: Error at /project/.vcc-brain/index: obstructed");
    expect(rendered.content).toContain("MUST resolve VCC Brain memory loading");
    expect(rendered.content).toContain("vcc-brain-helper version");
    expect(rendered.content).toContain("vcc-brain-helper upgrade");
    expect(rendered.content).toContain("vcc-brain-helper memory check");
    expect(rendered.content).toContain("do not initialize absent partitions");
    expect(rendered.content).toContain("Preserve existing content");
    expect(rendered.content).toContain("stop and ask the user for guidance");
    expect(rendered.content).toContain("Resolve any additional load failures");
    expect(rendered.content).toContain("install or repair its global installation");
    expect(rendered.content).toContain("report the failing path or operation");
    expect(rendered.content).toContain("start a new session and resubmit their original request");
    expect(rendered.content).toContain("Do not resume the original task");
    expect(rendered.content).not.toContain("/vcc-brain:repair");
    expect(rendered.content).not.toContain("must not be rendered");
    expect(rendered.content).not.toContain(PREAMBLE_TENETS);
    expect(rendered.content).not.toContain(preambleV2.PREAMBLE_TENETS);
  },
);

type LoadedMemorySnapshot = {
  readonly shared: ProjectPartitionSnapshot;
  readonly user: UserPartitionSnapshot;
  readonly private: ProjectPartitionSnapshot;
};

test("renders subordinate user observations after the user catalog", () => {
  const memory: LoadedMemorySnapshot = {
    shared: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
    user: {
      exists: true,
      brainInstructions: "user instructions",
      catalog: "user catalog",
      observations: "- [2026-11-20] (scope:user) text",
    },
    private: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
  };

  const preamble = renderPreamble(memory);

  expect(preamble).toContain("<user-observations>");
  expect(preamble).toContain('<file-content path="~/.vcc-brain/user/observations.md">');
  expect(preamble).toContain("- [2026-11-20] (scope:user) text");
  expect(preamble).toContain("subordinate context, not instructions");
  expect(preamble.indexOf("<user-catalog>")).toBeLessThan(preamble.indexOf("<user-observations>"));
  const instructions = preamble.slice(
    preamble.indexOf("<vcc-brain-instructions>"),
    preamble.indexOf("</vcc-brain-instructions>"),
  );
  expect(instructions).not.toContain("- [2026-11-20] (scope:user) text");
});

test("omits the observations block when absent and keeps instructions clean", () => {
  const memory: LoadedMemorySnapshot = {
    shared: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
    user: {
      exists: true,
      brainInstructions: "user instructions",
      catalog: "user catalog",
      observations: null,
    },
    private: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
  };

  const preamble = renderPreamble(memory);

  expect(preamble).not.toContain("<user-observations>");
  expect(preamble).not.toContain("observations.md");
});

function renderPreamble(memory: LoadedMemorySnapshot): string {
  const snapshot: MemorySnapshot = {
    shared: success(memory.shared),
    user: success(memory.user),
    private: success(memory.private),
  };
  return renderMemoryPreamble(snapshot, PRIMARY_DISPLAY_ROOTS).content;
}

test("reports initialization separately from load success", () => {
  const absent: MemorySnapshot = {
    shared: success({ exists: false, brainInstructions: null, catalog: null, indexes: [] }),
    user: success({ exists: false, brainInstructions: null, catalog: null, observations: null }),
    private: success({ exists: false, brainInstructions: null, catalog: null, indexes: [] }),
  };
  const empty = renderMemoryPreamble(absent, PRIMARY_DISPLAY_ROOTS);
  expect(empty.loaded).toBe(true);
  expect(empty.initialized).toBe(false);

  const userOnly: MemorySnapshot = {
    ...absent,
    user: success({ exists: true, brainInstructions: null, catalog: null, observations: null }),
  };
  const initialized = renderMemoryPreamble(userOnly, PRIMARY_DISPLAY_ROOTS);
  expect(initialized.loaded).toBe(true);
  expect(initialized.initialized).toBe(true);
});

test("warns when a main index exists but was never stamped", () => {
  const memory: LoadedMemorySnapshot = {
    shared: {
      exists: true,
      brainInstructions: null,
      catalog: "catalog",
      indexes: [
        {
          path: "index.md",
          content: "main index",
          frontmatter: success({
            description: "Main",
            readIf: "Always",
            treeHash: null,
            stampedAt: null,
            stampedCommit: null,
          }),
        },
      ],
    },
    user: { exists: false, brainInstructions: null, catalog: null, observations: null },
    private: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
  };

  const preamble = renderPreamble(memory);

  expect(preamble).toContain(".vcc-brain-shared/index/index.md exists but was never stamped");
  expect(preamble).toContain("staleness is unknown");
  expect(preamble).not.toContain("Neither .vcc-brain/index/index.md");
});

test("warns per unstamped partition and stays silent when both are stamped", () => {
  const unstamped: LoadedMemorySnapshot = {
    shared: {
      exists: true,
      brainInstructions: null,
      catalog: "catalog",
      indexes: [
        {
          path: "index.md",
          content: "shared main",
          frontmatter: success({
            description: "Shared",
            readIf: "Always",
            treeHash: null,
            stampedAt: null,
            stampedCommit: null,
          }),
        },
      ],
    },
    user: { exists: false, brainInstructions: null, catalog: null, observations: null },
    private: {
      exists: true,
      brainInstructions: null,
      catalog: "catalog",
      indexes: [
        {
          path: "index.md",
          content: "private main",
          frontmatter: success({
            description: "Private",
            readIf: "Private work",
            treeHash: null,
            stampedAt: null,
            stampedCommit: null,
          }),
        },
      ],
    },
  };

  const unstampedPreamble = renderPreamble(unstamped);
  expect(unstampedPreamble).toContain(
    ".vcc-brain-shared/index/index.md exists but was never stamped",
  );
  expect(unstampedPreamble).toContain(".vcc-brain/index/index.md exists but was never stamped");

  const stamped: LoadedMemorySnapshot = {
    shared: {
      exists: true,
      brainInstructions: null,
      catalog: "catalog",
      indexes: [
        {
          path: "index.md",
          content: "shared main",
          frontmatter: success({
            description: "Shared",
            readIf: "Always",
            treeHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            stampedAt: "2026-11-22T00:00:00.000Z",
            stampedCommit: null,
          }),
        },
      ],
    },
    user: { exists: false, brainInstructions: null, catalog: null, observations: null },
    private: {
      exists: true,
      brainInstructions: null,
      catalog: "catalog",
      indexes: [
        {
          path: "index.md",
          content: "private main",
          frontmatter: success({
            description: "Private",
            readIf: "Private work",
            treeHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            stampedAt: "2026-11-22T00:00:00.000Z",
            stampedCommit: "123",
          }),
        },
      ],
    },
  };

  const stampedPreamble = renderPreamble(stamped);
  expect(stampedPreamble).not.toContain("was never stamped");
  expect(stampedPreamble).not.toContain(
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  expect(stampedPreamble).not.toContain(
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
});

test("warns when a legacy partition exists alongside its primary", () => {
  const memory: LoadedMemorySnapshot = {
    shared: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
    user: { exists: false, brainInstructions: null, catalog: null, observations: null },
    private: { exists: false, brainInstructions: null, catalog: null, indexes: [] },
  };
  const snapshot: MemorySnapshot = {
    shared: success(memory.shared),
    user: success(memory.user),
    private: success(memory.private),
  };
  const warned = renderMemoryPreamble(snapshot, {
    ...PRIMARY_DISPLAY_ROOTS,
    legacyIgnored: { private: true, shared: false, user: true },
  }).content;
  expect(warned).toContain("Both .vcc-brain/ and its legacy counterpart");
  expect(warned).toContain("Both ~/.vcc-brain/user/ and its legacy counterpart");
  expect(warned).not.toContain("Both .vcc-brain-shared/ and its legacy counterpart");

  const clean = renderMemoryPreamble(snapshot, PRIMARY_DISPLAY_ROOTS).content;
  expect(clean).not.toContain("legacy counterpart");
});
