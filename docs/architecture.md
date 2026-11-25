# VCC Brain Architecture

VCC Brain is durable context for agent-driven development. Agents document project knowledge as Markdown over the course of ordinary work. Every session starts with a small, deterministic orientation and explicit routes into deeper material. Nothing is ranked, guessed, or retrieved by similarity.

### The Brain

The Brain is the knowledge space on disk: instructions, specifications, plans, research, architecture and decisions, standards and lessons, plus the catalogs and indexes that map it. It is ordinary Markdown, split into three partitions by ownership:

- `~/.vcc-brain/user/` — User/global partition. Project-agnostic memory: preferences, standards, and reusable skills.
- `.vcc-brain/` — Project private partition. Local project knowledge; Git-ignored by Helper on first setup.
- `.vcc-brain-shared/` — Project shared partition. Knowledge published with the repository; created only when activated.

When instructions conflict, the hierarchy is: Private > User > Shared.

Memory is not a separate database. It is the durable knowledge that continuous documentation produces.

### What Loads, And What Doesn't

The preamble is the lightweight entrypoint. At the start of every conversation, VCC Brain loads:

- VCC Brain Guidance — fixed framework rules: the memory-aware workflow, partition placement and authority, catalog and index semantics.
- VCC Brain Instructions — standing rules from each partition's `vcc-brain.md`, merged by authority.
- Partition Catalogs — each partition's `catalog.md`, a compact map of its Brain documents.
- User Observations — approved notes about how you work, loaded as subordinate context that never overrides instructions, catalogs, or index guidance.
- The main Project Index — `index/index.md`, the repository's structural map.
- Warnings and diagnostics — malformed or missing context flagged for repair.

Everything else — specifications, plans, research, guides — stays on disk and is read deliberately when the task calls for it. Loading is deterministic: the same session start produces the same orientation, every time.

### User Observations

The User partition may hold an `observations.md` file: durable notes about how you work, each proposed by an agent in conversation and kept only with your approval. It loads in the preamble after the User Catalog. When the file is absent, nothing loads.

Agents propose new entries rarely — at most one per session, and only for genuine patterns such as repeated corrections, an explicit "remember that", or manual work worth automating. A declined proposal is simply dropped and never re-offered.

### Preamble Versions

VCC Brain assigns approximately 80% of machines to preamble v1.1 and 20% to the revised v2.0. Assignment is derived locally from the OS machine identifier and stays consistent across projects, harnesses, and VCC Brain updates. If the identifier is unavailable, VCC Brain uses v1.1. The identifier is never transmitted or included in the preamble.

Set `VCC_BRAIN_PREAMBLE_BETA=1` in the environment of the harness or Helper process to always use v2.0 for newly rendered preambles. Guidance and tenets carry matching version attributes.

### The Maps

Two map types route the agent, because source navigation and durable knowledge are different concerns:

- Partition Catalogs map the Brain. Each entry states what a document covers and when to open it. Catalogs map Brain knowledge; indexes map code.
- Project Indexes map the codebase. Every index document carries a description and a `read_if` condition; the main index enters the preamble and subindexes are opened when their condition matches the task.

Freeform documents — everything else in a partition — are read through catalog guidance, never pulled in by automatic selection.

### No RAG

RAG turns memory into fragments ranked against a query. The model receives a bounded top-k slice; everything unselected simply does not appear.

VCC Brain relies on coherent documents and explicit maps instead:

- Stable orientation loads deterministically.
- Catalogs route through durable knowledge.
- Project Indexes route through code.
- Humans and agents update current knowledge at its source.
- No embedding model, vector database, reranker, or automatic semantic injection is required.

For the full argument against replay-based memory, see [VCC Brain VS Other Plugins](comparison.md).

### Failure Is Visible

The Brain can go stale — after significant upstream changes or if the agent simply forgets to update. VCC Brain keeps that failure in ordinary files: inspectable, correctable. The Project Index carries a structural stamp recorded at refresh time: adding, removing, or renaming files changes the tree hash, `index lint` reports the drift as a warning, and the preamble nudges when an index was never stamped. Content edits alone never stale the index.

### OpenCode

The OpenCode integration targets V2 through `@jwitmann/vcc-brain-opencode-v2`. It injects session-cached context at the outgoing model boundary, exposes server-owned status through RPC to the TUI, and leaves package updates to OpenCode. OpenCode V1 is not supported: no V1 package ships under this scope.
