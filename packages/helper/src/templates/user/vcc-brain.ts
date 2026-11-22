export const USER_VCC_BRAIN_TEMPLATE = `# User VCC Brain Instructions

<instructions>
Remove this block after filling.

Instruction: Fill freely. Common topics (include, but NOT LIMITED TO):
- About the User
  - Profession
  - Programming Experience (learner, experienced, non-programmer, programmer-adjacent)
  - Language Preferences (technicality, level of engineering detail, language (record if not English))
  - Default Stack
- Communication Style (tone, concision, explanations)
- Workflow (agent workflow)
  - Planning and Approval (when to create plans, how detailed)
  - Autonomy (agent independence, when to ask, can the agent commit)
  - Etc.
- Engineering Principles
  - Rules (restricted commands, restricted patterns, etc.)
  - Code Style (code, documentation)
  - Other Style (branch/commit naming if agent is authorized to create them)
  - Testing
- Etc.
</instructions>

### Proposing lasting improvements (observation flow)

- Offer rarely: at most one observation proposal per session as a standing norm, waived only for an explicit "remember that". Never re-offer a declined item in the same conversation; if compaction makes an earlier offer uncertain, do not re-offer.
- Propose when the user corrects the same thing twice (or states it as a pattern), says "remember that" / "from now on", reveals a preference that clearly applies beyond this project, or when repeated manual work is worth automating (visible repetition, reversible, workflow-only; product ideas are out of scope). Anything else stays unproposed.
- Offer conversationally in the moment (\`question\` tool where available, else plain words): the candidate, why (the incident), and scope (\`user\` or \`project\`). On approval append one line \`- [YYYY-MM-DD] (scope:user) text\` to \`~/.vcc-brain/user/observations.md\`; project-scoped candidates go to \`.vcc-brain/vcc-brain.md\`, never the user partition. Sensitive candidates (credentials, tokens, secret paths, personal data beyond working preferences) are barred from both; flag suspected sensitivity in the offer.
- \`observation\` switch (default OFF): OFF suppresses proposing. Loading is independent: approved observations keep loading until the user deletes the file. Without an initialized Brain the surface fails closed.
`;
