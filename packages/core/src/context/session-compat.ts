// Cross-version session-log access for the recall/search stages. Faithful
// logic port of the port repo's `session-compat.mjs` (itself ported from
// dsh-compaction-vcc@0.7.4 `src/session-compat.js`): duck-typed accessors
// (`eventAt`/`snapshotEvents`) with the legacy `events`-array fallback — no
// DSH imports, so any session-shaped value works. Oracle vectors live in
// `recall.test.ts`, captured from the original (port selftest run 2026-11-19).
//
// Deliberate deviation: the original warns through `console.warn`. Runtime
// code never writes to the console; missed-capability reports flow through an
// optional module sink (no-op by default, set by the caller for observability
// or tests). Return values are unaffected.

export type CompatSessionEvent = {
  readonly seq: number;
  readonly type: string;
  readonly data?: unknown;
};

export type CompatSession = {
  readonly snapshotEvents?: (() => readonly CompatSessionEvent[] | null | undefined) | unknown;
  readonly eventAt?: ((seq: number) => CompatSessionEvent | null | undefined) | unknown;
  readonly events?: readonly CompatSessionEvent[] | null | undefined;
};

type WarnSink = (text: string) => void;

let warnSink: WarnSink | null = null;

// Capability gaps already reported, so the log stays readable.
const warned = new Set<string>();

// Install the sink for missed-capability reports, or null to silence them.
// Module-level (not per-call) so the oracle-identical call shapes
// `sessionEvents(session)` / `sessionEventAt(session, seq)` are preserved.
export function setSessionCompatWarnSink(sink: WarnSink | null): void {
  warnSink = sink;
}

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  try {
    warnSink?.(`[dsh-compaction-vcc] ${message}`);
  } catch {
    // A failing warn sink must never break recall or search.
  }
}

// Whether a session-shaped value exposes any readable event log.
export function hasSessionEventAccess(session: unknown): boolean {
  if (session === null || session === undefined) return false;
  if (typeof session !== "object") return false;
  const candidate = session as CompatSession;
  if (typeof candidate.snapshotEvents === "function") return true;
  if (typeof candidate.eventAt === "function") return true;
  return candidate.events !== null && candidate.events !== undefined;
}

// A frozen snapshot of every event in the durable log. Empty only when the
// session genuinely has no log access, reported once through the warn sink.
export function sessionEvents(session: unknown): readonly CompatSessionEvent[] {
  if (session === null || session === undefined) return [];
  if (typeof session !== "object") return [];
  const candidate = session as CompatSession;
  if (typeof candidate.snapshotEvents === "function") {
    const events = candidate.snapshotEvents();
    if (events === null || events === undefined) {
      warnOnce("snapshotEvents() returned no array; treating the log as empty");
      return [];
    }
    return events;
  }
  if (candidate.events !== null && candidate.events !== undefined) return candidate.events;
  warnOnce(
    "session exposes neither snapshotEvents() nor events; the durable log is unreadable on this host — compaction will not run",
  );
  return [];
}

// The immutable event stored at one exact sequence number, or undefined when
// the log does not contain it.
export function sessionEventAt(session: unknown, seq: number): CompatSessionEvent | undefined {
  if (session === null || session === undefined) return undefined;
  if (typeof session !== "object") return undefined;
  const candidate = session as CompatSession;
  if (typeof candidate.eventAt === "function") {
    const event = candidate.eventAt(seq);
    return event === null || event === undefined ? undefined : event;
  }
  const events = candidate.events;
  if (events === null || events === undefined) return undefined;
  // The legacy array is indexed by POSITION, not by seq: the durable log
  // numbers events from 1 while array indices start at 0, so `events[seq]`
  // is off by one. Every call site re-checks `event.seq === seq` and treats
  // a mismatch as "not found", so this is a safe failure rather than wrong
  // data — but it means the legacy path only works for a 0-based array.
  // Prefer the accessor pair; this branch exists for old unit fixtures.
  const positional = events[seq];
  if (positional !== undefined && positional?.seq === seq) return positional;
  for (const event of events) {
    if (event?.seq === seq) return event;
  }
  return positional;
}
