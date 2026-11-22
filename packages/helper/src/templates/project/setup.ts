import { PROJECT_OPERATOR_TEMPLATE } from "./operator.ts";
import { PROJECT_SHARED_README_TEMPLATE } from "./shared-readme.ts";

export const PROJECT_SETUP_TEMPLATE = `# Project Setup

You are helping the user configure the Operator Project Brain across the private \`.vcc-brain/\` partition and shared \`.vcc-brain-shared/\` partition.

Project indexing is excluded from the setup phases; you offer it as the final step in Phase 8.

Project Init is for first-time setup. On a rerun, follow the existing structure and sharing policy, skip completed phases, and initialize only missing pieces; report stale or damaged content rather than repairing or rebuilding it unasked.

For structured prompts, use the harness's inline question tool or equivalent, regardless of what the tool is named. If no equivalent is available, ask directly in chat and wait for the answer. Use direct chat always for free-response prompts.

**Document syntax:** Index and catalog structure, entry syntax, and examples are defined in the fixed preamble (Project Index and Partition Catalog sections). **You must follow that preamble document syntax** when creating or filling indexes and catalogs. Do not invent layouts. \`operator-helper project init\` seeds Private core files with the canonical syntax; fill or rewrite from the preamble. Operator Instructions and Shared README seeds are in the Canonical Seeds section below.

## Project Shape

Before Phase 1, classify the repository once. Do not reclassify later.

Quick scan only:

- Top-level layout and whether there is substantive app or library code versus an empty, scaffolded, or template tree
- Whether agent-facing documentation exists (\`AGENTS.md\`, \`CLAUDE.md\`, \`specs/\`, \`memory/\`, \`CONTEXT.md\`, and similar)

Set one label for the rest of this guide:

- **greenfield** — new, empty, or template project; little or no real application code; nothing worth migrating into the brain
- **existing** — substantive code and/or agent-facing docs worth considering

If the shape is ambiguous, use the harness's \`question\` tool once to choose greenfield or existing, then continue.

Greenfield defaults (apply for the whole run unless the user overrides):

- Prefer minimal or default \`operator.md\` unless the user chooses to configure instructions now
- Skip agent-documentation migration
- If no code exists: Do not hand off to Project Index setup.

## Phase 1: Read and Repair

Use the embedded Operator Instructions and Shared README seeds below. Do not treat index or catalog files as copy targets; those follow preamble document syntax.

Read the following core files. Some files may be missing; that is acceptable. You will create them later if the user desires.

- Private Operator Instructions: \`.vcc-brain/operator.md\`
- Private Partition Catalog: \`.vcc-brain/catalog.md\`
- Private Project Index: \`.vcc-brain/index/index.md\`
- Shared Operator Instructions: \`.vcc-brain-shared/operator.md\`
- Shared Partition Catalog: \`.vcc-brain-shared/catalog.md\`
- Shared Project Index: \`.vcc-brain-shared/index/index.md\`
- Shared README: \`.vcc-brain-shared/README.md\`

Inspect the overall directory structure and contents of \`.vcc-brain/\` and \`.vcc-brain-shared/\`.

After reading, determine if any **private core** file is empty, corrupted, or structurally unusable. Skip if none are affected.

For each affected private file, explain the problem and ask the user whether they want to restore it. Do not use the \`question\` tool for this free-response confirmation.

If the user approves:

- \`operator.md\` → replace from the embedded Operator Instructions seed
- \`catalog.md\` / \`index/index.md\` → rewrite using the fixed preamble document syntax, then fill with real content

Do not use this phase to repair incomplete, stale, or low-quality content; fix in phase 3 and 5 instead. Missing Shared core files are optional and do not require repair.

## Phase 2: Shared Policy

Skip this phase when the project already defines whether and how Project Shared is used.

Task: Use the harness's \`question\` tool with multiple selection to ask what, if anything, the user wants published through \`.vcc-brain-shared/\`. Offer reasonable choices including:

- Keep all Operator content private
- Share the main project index
- Share project-wide rules & style guides
- Share durable project documentation
- Share plans, specifications, or research selectively

Do not ask whether to share \`catalog.md\`; \`catalog.md\` should be automatically maintained when a partition is active.

After the user chooses:

- If the user chooses to share content, create \`.vcc-brain-shared/\` and seed new shared files as needed.
  - If \`.vcc-brain-shared/README.md\` is missing, write it from the embedded Shared README seed. Preserve an existing README.
  - For shared \`operator.md\`, start from the embedded Operator Instructions seed when creating a new file.
  - For shared catalog or index files, write using the fixed preamble document syntax.
  - Record the content that the user wishes to share in \`.vcc-brain-shared/operator.md\`
  - Record the content that the user wishes to keep private in \`.vcc-brain/operator.md\`
- If the user wants to keep everything private:
  - Record that the user wishes to keep everything private in \`.vcc-brain/operator.md\`
  - If \`.vcc-brain-shared/\` exists, ask the user what they wish to do with the brain contents. (Options: Remove, merge with private, keep)

## Phase 3: Configure Instructions

Skip this phase when each applicable \`operator.md\` is already configured. An intentionally minimal file counts as fully configured.

When greenfield: use the harness's \`question\` tool once to ask whether to configure project instructions now or leave unchanged. If leave unchanged, record any Shared/Private placement notes from Phase 2 and skip the section interview below.

If the user wants to share project-wide rules or style guides or other content, configured the shared \`operator.md\` first. If the user does not want to share, DO NOT configure it; leave \`operator.md\` as a stub / remove it. Shared instructions must contain only repository-wide doctrine suitable for publication. Private instructions contain local doctrine and overrides.

Task: For each unconfigured \`operator.md\`, first use the harness's \`question\` tool to ask which sections the user wishes to fill out and if there are existing project instructions, style guides, or operating documents that should be incorporated. Common sources include \`AGENTS.md\`, \`CLAUDE.md\`, harness-specific instruction files, contribution guides, and existing style or workflow documentation. Leave agent knowledge documents such as \`specs/\`, \`memory/\`, \`plans/\`, and \`context/\` for the next phase.

If the user provides existing instructions: read the instruction files or style guides and merge with \`operator.md\`. Ask the user if they wish to remove the instructions files; \`operator.md\` is always injected and replaces these instructions. Removal is strongly suggested to avoid creating competing sources of truth. Clarify which source remains authoritative when necessary.

Afterwards: Use focused questions to fill in the gaps in the \`operator.md\` template. Establish the requested workflow, project rules, engineering and testing requirements, style, etc. Group related questions to reduce response overhead. After the user answers everything, fill in \`operator.md\`.

Guidelines:
- Include a clear \`Skip\` or \`Leave unfilled\` choice where appropriate. When the user skips a question, leave that topic unfilled; do not infer an answer or add a default.
- Ask only questions whose answers would materially change the resulting instructions and for which reasonable users may prefer different outcomes.
  - Do not manufacture false choices or ask the user to endorse universal quality expectations.
  - For example, do not ask whether code should be good, maintainable, extensible, strictly typed, or whether edits should be focused; these are obvious standards.

## Phase 4: Existing Agent Documentation

Skip this phase when project shape is greenfield, or when the repository has no existing agent-facing documentation worth considering.

Task: Look for existing agent documentation that Operator would supersede. Common locations include \`specs/\`, \`memory/\`, \`plans/\`, \`context/\`, \`CONTEXT.md\`, and \`MEMORY.md\`. Inspect enough to tell agent-facing framework docs from user-facing product documentation.

Do not treat instruction files already handled in Phase 3 as candidates here.

Use the harness's \`question\` tool to ask whether the user wants to migrate any of these documents into the Project Brain. Offer the found candidates plus a skip choice.

After the user chooses:

- Place migrated content in freeform brain paths (\`specs/\`, \`research/\`, \`plans/\`, or similar). Follow the Shared Policy from Phase 2. Default to Private unless the user already chose to share durable project documentation.
- If the source is not Operator style, reshape it during migration. Operator documents are focused and cohesive around a feature, module, or subsystem. Rectify docs that are scattered, one-line notes, a few thin paragraphs, or too narrow to stand alone: consolidate related material into the document a future session would open for that work, drop trivia already obvious from code, and write present-tense system truth. Keep content as-is only when it already meets that standard. Do not put migrated docs in the Project Index.
- Agent-facing documentation superseded by Operator should be migrated, then ask whether to remove the originals. Removal is strongly suggested to avoid competing sources of truth.
- User-facing documentation such as a \`docs/\` directory or docs site may be read and useful material copied into brain specs. Do not remove or relocate those originals.

## Phase 5: Catalog

Run this phase when the Partition Catalog \`.vcc-brain/catalog.md\`/\`.vcc-brain-shared/catalog.md\` is unconfigured or out of date.

Task: For each active partition: Populate or update the Partition Catalog from the contents and structure of the corresponding partition (\`.vcc-brain/\` or \`.vcc-brain-shared/\`). Catalog each partition independently. Catalog brain content, not repository source code.

**You must follow the Partition Catalog document syntax from the fixed preamble** (required shape, Description / Read If entries, coverage rules).

## Phase 6: Configure Operator Features

\`operator-helper project init\` scaffolds \`.vcc-brain/config.json\` with context management, preamble refresh, and brain-update nudges present but disabled — the safe default, behaviorally identical to no config file. Ask the user which, if any, to enable now.

Ask only when the Helper output above shows \`Created .vcc-brain/config.json\` this run. When it shows \`Preserved\`, a previous run already handled this choice — skip the phase.

Task: Use the harness's \`question\` tool with multiple selection. Describe each feature in one line, harness-accurately (you know which harness this is):

- Context management — on OpenCode, trims bulky tool output and compacts history past a window ratio or token cap, audited with per-session receipts; on DeepSeek, host-driven compaction only (the host owns tool-result reduction, so there is no trim). Off by default and inert without a Brain either way.
- Preamble refresh — re-renders the preamble mid-session when the Brain changes, only at cold prompt-cache moments so it costs nothing.
- Brain-update nudges — one quiet reminder per Brain-change era after enough new tool calls; never an automatic writer.

If the user enables anything, write only the flipped \`enabled\` flags into the existing \`.vcc-brain/config.json\`, preserving the scaffolded thresholds; never rewrite the whole file from memory. If the user declines everything, leave the file as scaffolded.

## Phase 7: Confirm

Give the user a concise summary of:

- Project shape used for this run (greenfield or existing)
- Current Private Operator Instructions and placement policy
- Whether Project Shared is active and what content is shared
- Operator features enabled, left disabled, or already configured (omit when unchanged from a previous run)
- Files created, repaired, configured, or cataloged
- Existing project instructions incorporated or left authoritative elsewhere (omit when none)
- Agent documentation migrated, copied from user-facing docs, or left in place (omit when none)
- Unresolved Private / Shared boundary concerns

Ask whether anything is incorrect, missing, too strict, too permissive, improperly private, or improperly shared. Do not use the \`question\` tool for this free-response confirmation.

Apply approved corrections and finish only after the user confirms the setup. Do not end the session in this phase.

## Phase 8: Offer Indexing

After the user has confirmed Project Setup: Notice that the index has not been populated yet, then offer to index.

Offer the user two choices:

1. Index now, in this conversation. You run \`operator-helper index init\` yourself and follow the Project Index Setup guide in its output immediately. Helper output is working context; do not reproduce it for the user.
2. Start a new conversation and invoke the Operator Project Index Setup workflow in their harness to build or refresh the Project Index.

Recommendation: for a small or medium codebase, including greenfield, recommend indexing now — it is fast and the setup context is still loaded. For a large codebase, recommend a new conversation so the indexing agent starts with clean context, while still offering to index here.

If the user declines, tell them the Operator Project Index Setup workflow is available anytime later. Stop after this phase unless the user asks something else about setup.

## Canonical Seeds

When creating or restoring these files, write the matching body.

### Operator Instructions

\`\`\`markdown
${PROJECT_OPERATOR_TEMPLATE.trimEnd()}
\`\`\`

### Shared README

\`\`\`markdown
${PROJECT_SHARED_README_TEMPLATE.trimEnd()}
\`\`\`
`;
