// Joins log-only brain-reminder receipts to the subsequent brain-changed
// refresh per fingerprint era, per session log: moved vs unanswered, plus
// time lag. See "Measure brain-reminder compliance" in
// docs/dev/follow-ups.md. Read-only over ~/.vcc-brain/state/context-log/.
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { resolveStateDirectory } from "../packages/core/src/memory/roots.ts";

const dir = join(resolveStateDirectory(process.env.HOME ?? homedir()), "context-log");

type Verdict = { moved: number; unanswered: number; lagsMin: number[] };
const total: Verdict = { moved: 0, unanswered: 0, lagsMin: [] };
let reminders = 0;
const withReminders = new Set<string>();

let logFiles: string[] = [];
try {
  logFiles = readdirSync(dir).filter(f => f.endsWith(".log"));
} catch (cause) {
  if ((cause as { code?: unknown }).code !== "ENOENT") throw cause;
}

for (const file of logFiles) {
  let pending: { at: string } | null = null;
  for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
    if (!line) continue;
    let receipt: unknown;
    try {
      receipt = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof receipt !== "object" || receipt === null) continue;
    const kind = (receipt as Record<string, unknown>).kind;
    if (kind === "brain-reminder") {
      if (pending) total.unanswered++;
      pending = { at: String((receipt as Record<string, unknown>).at) };
      reminders++;
      withReminders.add(file);
    } else if (
      kind === "refresh"
      && (receipt as Record<string, unknown>).reason === "brain-changed"
      && pending
    ) {
      total.moved++;
      const lag =
        (new Date(String((receipt as Record<string, unknown>).at)).getTime()
          - new Date(pending.at).getTime())
        / 60000;
      if (Number.isFinite(lag) && lag >= 0) total.lagsMin.push(lag);
      pending = null;
    }
  }
  if (pending) total.unanswered++;
}

total.lagsMin.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      sessions: withReminders.size,
      reminders,
      moved: total.moved,
      unanswered: total.unanswered,
      compliance: reminders > 0 ? total.moved / reminders : null,
      medianLagMin:
        total.lagsMin.length > 0 ? total.lagsMin[Math.floor(total.lagsMin.length / 2)] : null,
    },
    null,
    2,
  ),
);
