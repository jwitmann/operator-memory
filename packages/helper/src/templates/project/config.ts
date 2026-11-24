// Optional per-project VCC Brain config: `<project>/.vcc-brain/config.json` (legacy `<project>/.operator/config.json` also checked).
// Scaffolds stock thresholds with everything disabled — absent config
// behaves identically. `peers` declares cross-session recall sharing by
// project directory; empty keeps recall project-scoped. Sharing is mutual:
// a peer counts only when its own config lists this project back.
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
  },
  "peers": []
}
`;
