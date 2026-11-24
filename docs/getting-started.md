![VCC Brain: The self-improving context engine for coding agents.](assets/getting-started.jpeg)

# Getting Started With VCC Brain

VCC Brain turns agent work into lasting project knowledge. You assign normal development tasks; agents record, update, and shape durable documents as they work. There is no memory administration for you to perform. Your job is to direct the agent's structural decisions; the agent owns day-to-day recording.

### How VCC Brain Works

That knowledge lives in the Brain, a human-readable set of Markdown files split into three partitions:

- `~/.vcc-brain/user/` — User/global partition. Project-agnostic memory: your communication preferences, engineering standards, and reusable prompts and skills.
- `.vcc-brain/` — Project private partition. Local project knowledge such as work in progress, private plans, and internal research.
- `.vcc-brain-shared/` — Project shared partition. Knowledge published with the repository for collaborators and future clones.

Inside each partition, four kinds of content cooperate:

- VCC Brain Instructions (`vcc-brain.md`) carry standing rules for how the agent works in that scope — `AGENTS.md`, but more powerful. When instructions conflict, the hierarchy is: Private > User > Shared.
- Partition Catalogs (`catalog.md`) map that partition's knowledge: what each document covers and when to open it.
- Project Indexes (`index/`) map the codebase itself so the agent can navigate source without rediscovering the layout. Catalogs map Brain knowledge; indexes map code.
- Freeform documents are everything else — specifications, plans, research, guides — read on demand through catalog guidance.

At the start of every conversation, VCC Brain loads a short preamble: VCC Brain Guidance (fixed framework rules), VCC Brain Instructions merged by authority, Partition Catalogs, approved User Observations, and the Main Project Index. Everything deeper stays on disk, read only when the task calls for it.

**The brain is NOT a summary of the code.** The brain is designed to store context, contracts, requirements, conventions, decisions, and other meta-information that the code cannot own.

For the full architecture, see [Architecture](architecture.md).

### Get Started

1. Run `/vcc-brain:user-init` in a new conversation to establish user-global working instructions. This is a one-time step. Rerun anytime to update user instructions. Over time, agents may occasionally propose durable observations about how you work; approved entries are kept in `~/.vcc-brain/user/observations.md`.
2. Run `/vcc-brain:project-init` in a new conversation to initialize the private partition, configure sharing rules, and index the repository. Project setup runs once per project.
3. Start a new conversation and give the agent ordinary development work.

If the brain is ever out of sync, for example from significant upstream changes, ask the agent to pull and update the brain. The agent will automatically update the brain and indexes.

### Using VCC Brain

Give the agent normal development work: features, fixes, refactors. VCC Brain orients each session automatically; the agent consults brain material, records lasting knowledge, and updates existing documents when the truth those documents own has changed.

If using on an existing project, expect a sparse Brain at first. Due to inertia, agents may hesitate to write their first documents; you should ask directly to write the first specifications or research for particular modules or systems as you work on them. Once documents exist, later sessions become more comfortable maintaining and adding documents as part of ordinary work.

#### Past sessions are searchable

The curated Brain is not the only memory. Every session can also search the raw text of past sessions: ask the agent to find when something was discussed or decided, and it uses the `vcc-brain-search-sessions` tool (keywords over other sessions) and `vcc-brain-recall-session` (restore one session's full turns) to pull the verbatim history back in. Results stay scoped to the current project plus mutual peers.

Ask the agent to run `vcc-brain-helper recall-cross index` once on each machine so OpenCode history is indexed; DeepSeek history syncs on demand. The index lives local-only under `~/.vcc-brain/state/recall-index/` with 30-day retention. Sessions you never want indexed opt out by carrying exactly the title `[no-recall]`.

To share recall across checkouts, declare peers in each project's `.vcc-brain/config.json`:

```json
{ "peers": ["/home/jerome/checkouts/other-project"] }
```

Sharing is mutual: the other project must list this one back. Without a mutual declaration, recall stays scoped to the current project.

---

#### Example: existing project

You initialize VCC Brain on an existing project and start work on a module you know well. The brain has no documents for it yet.

Ask the agent to analyze the module: how it's structured, how it fits into the rest of the project, what it actually does. Provide links to online documentation for background information. Encourage questions, make clarifications, and have the agent report back with a brief summary.

Assess the agent's knowledge. Provide the agent with additional meta-information that it cannot infer: why the module exists, what problem it solves, requirements, constraints, etc. Afterwards, have the agent write a specification or another context document.

Future agents will open that document before touching the module, instantly gaining a complete view into that module's purpose, as well as deeper motivations that code or comments alone cannot provide.

---

### Steer The Agent

Agents will read and update documents that already exist. However, current agents prefer the status quo; at times, they may hesitate to:

- Create new types of documents
- Consolidate two related documents into one
- Split a large document into two

Certain larger architectural moves will need your judgements of the project's long term needs. In these cases, you must steer the agent:

- "Draft a plan for this change and record it in the brain."
- "Record as a reusable guide so we do not repeat the investigation."
- "Clone this source tree and create a subindex to use for future reference."
- "These two documents overlap. Consolidate them."
- "This document is too large. Split it."
- "Promote this spec to the shared partition so the team receives it."

---

#### Example: unfamiliar library

You work regularly with a third-party library that your agent is not familiar with. Your agent often spends lots of time searching the web for resources.

With VCC Brain, that changes.

Clone the library source tree into a .gitignored `references/` directory. Ask the agent to create a subindex for that tree. Ask the agent to create reusable VCC Brain guides for any APIs or systems you commonly interact with.

Future sessions will use the guide instead of searching the web. If uncertain, agents use the subindex to peer into source code as source of truth.

---

### The Brain

The brain is ordinary Markdown on disk. It is transparent, flexible, and highly scalable. Some examples of what you can do with the brain:

- You may ask agents to create a guide for writing in your specific style in `~/.vcc-brain/user/writing-style.md`
- You may ask agents to capture a PR review workflow as a reusable global skill in the user partition `~/.vcc-brain/user/`.
- You may ask agents to keep a dossier on a competitor's architecture in the private partition, updated each time you ask it to `git pull` the reference code.
- You may ask agents to create checklists for implementing new features so it never forgets to update the `changelog.md` again.
- You may ask agents to enforce a repo-wide standard the intern keeps breaking by adding shared conventions to `.vcc-brain-shared/vcc-brain.md`

Customize your brain and your agent's behavior however you want. With VCC Brain, the world is yours.

### Appendix: Commands

Tip: Run each VCC Brain command in a new conversation so the agent can focus on setup or indexing with a clean working context.

- `/vcc-brain:user-init` — Initializes or revises private user-global memory (instructions and freeform) in the current conversation.
- `/vcc-brain:project-init` — Initializes or revises project setup without overwriting existing content. It configures Private, guides optional Shared activation, and indexes the repository. Project setup also offers optional features such as deterministic context management on supported harnesses (OpenCode, DeepSeek).
- `/vcc-brain:index` — Builds or refreshes the Project Index so future agents can navigate repository structure and applicable subsystem context. Refreshing records a structural stamp of the tree, and the agent warns when later changes make the index stale.
