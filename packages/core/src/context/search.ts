// Keyword/regex search over the durable session log, the retrieval
// counterpart of the compiler: scans every event's projected content and
// returns matching events with `(seq N)` pointers that recall restores in
// full. Faithful logic port of the port repo's `search.mjs` (itself ported
// from dsh-compaction-vcc@0.7.4 `src/search.js`). Oracle vectors live in
// `search.test.ts`, captured from the original (port selftest run 2026-11-19).
//
// Deliberate deviations: `deriveEventMessage` access is guarded with
// `isRecord` instead of bare property reads; `sessionEventAt` is not imported
// (the original imports it but never calls it — carrying a dead import would
// trip the linter).

import { estimateEntryTokens, sanitize, truncateTokens } from "./compiler.ts";
import { deriveSessionMessage, projectMessageText } from "./recall.ts";
import { sessionEvents } from "./session-compat.ts";

// Cap on the number of matching events shown in one result.
export const DEFAULT_MAX_SEARCH_HITS = 50;
// Cap on shown matching lines per hit event.
export const MAX_LINES_PER_HIT = 10;

// A search pattern that cannot be compiled into a regular expression.
export class InvalidSearchPatternError extends Error {
  readonly source: string;

  constructor(source: unknown, reason: string) {
    super(`invalid search pattern ${JSON.stringify(String(source))}: ${reason}`);
    this.name = "InvalidSearchPatternError";
    this.source = String(source);
  }
}

// Compile one search pattern: case-insensitive, Unicode-aware, treated as a
// regular expression (VCC `--grep` semantics) so keywords work as-is and
// regexes work when escaped. Throws InvalidSearchPatternError when empty or
// not compilable.
export function compileSearchPattern(source: unknown): RegExp {
  const trimmed = String(source ?? "").trim();
  if (trimmed.length === 0) throw new InvalidSearchPatternError(source, "pattern is empty");
  try {
    return new RegExp(trimmed, "iu");
  } catch (error) {
    throw new InvalidSearchPatternError(
      source,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export type SearchHit = {
  readonly seq: number;
  readonly kind: string;
  readonly text: string;
};

export type SearchConfig = {
  readonly maxSearchHits: number;
  readonly maxRecallTokens: number;
};

export type SearchResult = {
  readonly pattern: string;
  readonly totalMatches: number;
  readonly hits: SearchHit[];
  readonly omitted: number;
  readonly truncated: boolean;
  readonly tokens: number;
  readonly text: string;
};

// One search hit: the durable seq, its kind, and the rendered matched lines.
export function searchSession(
  session: unknown,
  patternSource: unknown,
  config: SearchConfig,
): SearchResult {
  const pattern = compileSearchPattern(patternSource);
  const maxHits = config.maxSearchHits;
  const maxTokens = config.maxRecallTokens;
  const events = sessionEvents(session);
  const hits: SearchHit[] = [];
  let totalMatches = 0;
  let budget = maxTokens;
  let truncated = false;
  // Known upstream quirk carried verbatim: the scan is positional
  // (`events[seq]` with `event.seq === seq`, so a 1-based log in a 0-based
  // array matches nothing). The adapter's snapshot pads a dummy seq-0 entry
  // so this contract holds; not papered over here.
  for (let seq = 0; seq < events.length; seq += 1) {
    const event = events[seq];
    if (event === undefined || event.seq !== seq) continue;
    const message = deriveSessionMessage(session, event);
    const body =
      message !== null
        ? projectMessageText(message)
        : `[${event.type}]\n${JSON.stringify(event.data ?? null)}`;
    const lines = body.split("\n");
    const matched: { readonly line: number; readonly text: string }[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (pattern.test(line)) matched.push({ line: index + 1, text: sanitize(line) });
    }
    if (matched.length === 0) continue;
    totalMatches += 1;
    if (hits.length >= maxHits || budget <= 0) {
      truncated = true;
      continue;
    }
    const header = `[seq ${seq}: ${message !== null ? message.role : event.type}]`;
    const shown = matched.slice(0, MAX_LINES_PER_HIT);
    const more = matched.length - shown.length;
    const block = [
      header,
      ...shown.map(match => `  ${match.line}: ${match.text}`),
      ...(more > 0 ? [`  ...(${more} more matching lines in this event)`] : []),
    ].join("\n");
    const kept = truncateTokens(block, budget, "search budget");
    budget -= estimateEntryTokens(kept.text);
    if (kept.truncated) truncated = true;
    hits.push({ seq, kind: message !== null ? message.role : event.type, text: kept.text });
  }
  const omitted = totalMatches - hits.length;
  const lines = [
    `[search "${pattern.source}": ${totalMatches} matching event(s)]`,
    ...hits.map(hit => hit.text),
    ...(omitted > 0
      ? [`[${omitted} more matching event(s) omitted — narrow the pattern or use recall]`]
      : []),
    ...(truncated ? ["[search budget exhausted; some hits were cut]"] : []),
  ];
  if (hits.length > 0)
    lines.push("[use recall with a (seq N) pointer to restore any hit's full original content]");
  const text = lines.join("\n\n");
  return {
    pattern: pattern.source,
    totalMatches,
    hits,
    omitted,
    truncated,
    tokens: hits.reduce((total, hit) => total + estimateEntryTokens(hit.text), 0),
    text,
  };
}
