// Cross-session recall ranking: pure functions over records. No filesystem,
// no sqlite, no harness APIs. Composition order (stated once, applied in
// exactly one place): the helper returns BM25-ordered candidates with scores;
// this module re-sorts once by the fixed rule below.

import type { RecallHit, RecallQuery, SessionRecord } from "./types.ts";

// Default result count, set once here and referenced by the helper CLI
// (Step 4) and the Phase 3 blind protocol.
export const DEFAULT_RECALL_CROSS_TOP_N = 5;

// Single excerpt window, in characters, cut around the best hit at render.
export const RECALL_CROSS_EXCERPT_WINDOW = 500;

// Distinctive marker every rendered excerpt carries. The DSH ingest
// self-pollution guard (helper `dsh.ts`) excludes any turn containing this
// string, so re-recorded excerpts never re-enter the index. Single source of
// truth: the Step 4 renderer and the Step 2 guard must both import this,
// never a literal copy.
export const RECALL_CROSS_EXCERPT_HEADER = "[vcc-brain-recall-excerpt]";

// Recency boost lives in (0, 1]: exactly 1.0 for same-millisecond records,
// decaying toward 0 with age, so it orders within a hit-count but never
// outweighs one additional distinct keyword match (worth 1000). Repeat
// occurrences order within equal hit-counts via the comparator, not the
// score, so distinct-hits dominance stays exact.
const HITS_WEIGHT = 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of keywords) {
    const word = raw.trim().toLowerCase();
    if (word.length > 0 && !seen.has(word)) {
      seen.add(word);
    }
  }
  return [...seen];
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) {
      return count;
    }
    count += 1;
    from = at + needle.length;
  }
}

function inScope(record: SessionRecord, query: RecallQuery): boolean {
  if (query.harness !== undefined && query.harness !== "all" && record.harness !== query.harness) {
    return false;
  }
  return record.project === query.scope.project || query.scope.peers.includes(record.project);
}

// 0 = same project, 1 = mutual peer. Out-of-scope rows never reach the
// sorter; they are excluded before ranking, never downranked.
function scopeGroup(record: SessionRecord, query: RecallQuery): number {
  return record.project === query.scope.project ? 0 : 1;
}

// 0 = human turns, 1 = tool output. Tool rows lose ties at equal score but
// never outrank a genuine hit — they fill gaps, they do not crowd out.
function kindGroup(record: SessionRecord): number {
  return record.kind === "tool" ? 1 : 0;
}

// Cut one excerpt window around the earliest occurrence of any keyword.
// First-best-hit wins ties; ellipsis marks cut edges. Keyword-free queries
// (degenerate but legal) excerpt from the head of the text.
export function cutExcerpt(text: string, keywords: readonly string[]): string {
  const lower = text.toLowerCase();
  let best = -1;
  for (const word of normalizeKeywords(keywords)) {
    const at = lower.indexOf(word);
    if (at >= 0 && (best < 0 || at < best)) {
      best = at;
    }
  }
  if (best < 0) {
    const head = text.slice(0, RECALL_CROSS_EXCERPT_WINDOW);
    return text.length > RECALL_CROSS_EXCERPT_WINDOW ? `${head}…` : head;
  }
  const half = Math.floor(RECALL_CROSS_EXCERPT_WINDOW / 2);
  const start = Math.max(0, best - half);
  const end = Math.min(text.length, start + RECALL_CROSS_EXCERPT_WINDOW);
  const clampedStart = Math.max(0, end - RECALL_CROSS_EXCERPT_WINDOW);
  const window = text.slice(clampedStart, end);
  const prefix = clampedStart > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${window}${suffix}`;
}

// Rank in-scope records. `now` is an explicit parameter (unix millis) so
// the recency boost stays a pure function of its inputs. Sort: scope group,
// then score (keyword hits + occurrence + recency boost), then kind (tool
// loses ties), then recency, then session id and seq as tiebreakers.
export function rankRecall(
  records: readonly SessionRecord[],
  query: RecallQuery,
  now: number,
): RecallHit[] {
  const keywords = normalizeKeywords(query.keywords);
  const scored: { record: SessionRecord; score: number; occurrences: number }[] = [];
  for (const record of records) {
    if (!inScope(record, query)) {
      continue;
    }
    const lower = record.text.toLowerCase();
    let matched = 0;
    let occurrences = 0;
    for (const word of keywords) {
      const count = countOccurrences(lower, word);
      if (count > 0) {
        matched += 1;
        occurrences += count;
      }
    }
    const ageDays = Math.max(0, (now - record.timestamp) / MS_PER_DAY);
    const recency = 1 - ageDays / (ageDays + 1);
    scored.push({ record, score: matched * HITS_WEIGHT + recency, occurrences });
  }
  scored.sort((a, b) => {
    const groupOrder = scopeGroup(a.record, query) - scopeGroup(b.record, query);
    if (groupOrder !== 0) {
      return groupOrder;
    }
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const kindOrder = kindGroup(a.record) - kindGroup(b.record);
    if (kindOrder !== 0) {
      return kindOrder;
    }
    if (b.occurrences !== a.occurrences) {
      return b.occurrences - a.occurrences;
    }
    if (b.record.timestamp !== a.record.timestamp) {
      return b.record.timestamp - a.record.timestamp;
    }
    if (a.record.sessionId !== b.record.sessionId) {
      return a.record.sessionId < b.record.sessionId ? -1 : 1;
    }
    return a.record.seq - b.record.seq;
  });
  const topN = query.topN ?? DEFAULT_RECALL_CROSS_TOP_N;
  return scored.slice(0, Math.max(0, topN)).map(({ record, score }) => ({
    record,
    score,
    excerpt: cutExcerpt(record.text, keywords),
  }));
}
