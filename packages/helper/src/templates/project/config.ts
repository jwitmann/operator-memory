// Optional per-project VCC Brain config: `<project>/.vcc-brain/config.json` (legacy `<project>/.operator/config.json` also checked).
// Same flat block names the opencode-v2 and deepseek adapters parse, with
// stock thresholds and everything disabled — absent config behaves
// identically, so scaffolding this file changes no runtime behavior. The
// agent flips `enabled` flags during Project Setup when the user opts in;
// `project init` itself never overwrites an existing file.
export const PROJECT_CONFIG_TEMPLATE = `{
  "contextManagement": {
    "enabled": false,
    "ratio": 0.8,
    "hardCapTokens": 250000,
    "keepRecentTurns": 3,
    "compactOnComplete": true,
    "compactFloorTokens": 32000
  },
  "brainUpdates": {
    "enabled": false,
    "toolCallThreshold": 25
  },
  "preambleRefresh": {
    "enabled": false
  }
}
`;
