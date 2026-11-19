// Deterministic tokenizer and token-budget primitives for the instant
// compaction compiler. Faithful logic port of dsh-compaction-vcc@0.7.4
// `src/compiler.js` via the opencode-vcc-port stage 1 (`compiler/tokenize.mjs`):
// fixed-density word-class tokens (letter runs, digit runs, single
// punctuation, whitespace runs), character-density estimation (0.3 per
// non-CJK character, 0.6 per CJK character), and dual-enforced truncation
// (token count AND a `limit * 4` character ceiling, floor 32). Everything
// here is total and offline: same input text always yields the same tokens,
// counts, and slices. Oracle vectors live in `compiler.test.ts`, captured
// from the original (port selftest run 2026-11-19).

const TOKEN_RE = /[a-zA-Z]+|[0-9]+|[^\sa-zA-Z0-9]|\s+/g;

// biome-ignore lint/suspicious/noControlCharactersInRegex: sanitizer intentionally matches the ESC byte class.
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

// biome-ignore lint/suspicious/noControlCharactersInRegex: sanitizer intentionally matches the C0/C1 byte classes.
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// Move the end of a slice to a code-point boundary: a cut must never leave
// a high surrogate without its low half.
function completeCodePointAtEnd(text: string): string {
  return isHighSurrogate(text.charCodeAt(text.length - 1)) ? text.slice(0, -1) : text;
}

// Move the start of a slice to a code-point boundary (a tail excerpt must
// never begin inside a surrogate pair).
function completeCodePointAtStart(text: string): string {
  return isLowSurrogate(text.charCodeAt(0)) ? text.slice(1) : text;
}

// Split text into fixed-density tokens: letter runs, digit runs, single
// punctuation chars, and whitespace runs. Whitespace tokens are included in
// the list but never counted by `countTokens`.
export function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

// True when the character carries the 0.6 CJK weight. Name kept for API
// stability; it means "CJK-density character" (kana, hangul, Thai, Lao,
// Indic scripts included — same density class, not ideographs only).
export function isCjkChar(char: string): boolean {
  const code = char.codePointAt(0) ?? -1;
  return (
    (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0x3000 && code <= 0x303f)
    || (code >= 0xff00 && code <= 0xffef)
    || (code >= 0x3040 && code <= 0x30ff)
    || (code >= 0x31f0 && code <= 0x31ff)
    || (code >= 0xac00 && code <= 0xd7af)
    || (code >= 0x1100 && code <= 0x11ff)
    || (code >= 0x0e00 && code <= 0x0e7f)
    || (code >= 0x0e80 && code <= 0x0eff)
    || (code >= 0x0900 && code <= 0x097f)
    || (code >= 0x0980 && code <= 0x09ff)
    || (code >= 0x0a00 && code <= 0x0a7f)
    || (code >= 0x0a80 && code <= 0x0aff)
    || (code >= 0x0b00 && code <= 0x0b7f)
    || (code >= 0x0b80 && code <= 0x0bff)
    || (code >= 0x0c00 && code <= 0x0c7f)
    || (code >= 0x0c80 && code <= 0x0cff)
    || (code >= 0x0d00 && code <= 0x0d7f)
    || (code >= 0x0d80 && code <= 0x0dff)
    || (code >= 0x1000 && code <= 0x109f)
    || (code >= 0x1780 && code <= 0x17ff)
  );
}

// Estimate tokens under the character-density conversion (0.3 per non-CJK
// character, 0.6 per CJK character). Integer tenths, exact under ceil for
// long inputs.
export function estimateDeepSeekTokens(text: string): number {
  let nonCjk = 0;
  let cjk = 0;
  for (const char of text) {
    if (isCjkChar(char)) cjk += 1;
    else nonCjk += 1;
  }
  return (nonCjk * 3 + cjk * 6) / 10;
}

// Count the non-whitespace tokens of a text under `tokenize`.
export function countTokens(text: string): number {
  let count = 0;
  for (const token of tokenize(text)) if (token.trim().length > 0) count += 1;
  return count;
}

// Size one emitted entry the way every budget in this module is enforced:
// the word-class token count, floored at the character-density equivalent so
// the total cap also sees pathological long runs.
export function estimateEntryTokens(text: string): number {
  return Math.max(countTokens(text), Math.ceil(estimateDeepSeekTokens(text)));
}

// Strip carriage returns, ANSI escapes, and control bytes — deterministic
// cleanup, never token-changing rewrites.
export function sanitize(text: string): string {
  let out = text;
  if (out.includes("\r")) out = out.replaceAll("\r", "");
  if (out.includes("\x1b")) out = out.replace(ANSI_RE, "");
  return out.replace(CONTROL_RE, "");
}

export type TruncatedText = {
  readonly text: string;
  readonly truncated: boolean;
};

// Truncate text to a non-whitespace-token budget, preserving exact original
// tokens and appending a provenance note on a cut. Every budget is enforced
// twice — by token count AND by a `limit * 4` character ceiling (floor 32),
// so pathological unbroken runs (base64 blobs, minified files) cannot pass.
export function truncateTokens(text: string, limit: number, ref: string | null): TruncatedText {
  const tokens = tokenize(text);
  let count = 0;
  let cut = tokens.length;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token.trim().length === 0) continue;
    count += 1;
    if (count > limit) {
      cut = index;
      break;
    }
  }
  let out = cut >= tokens.length ? text : tokens.slice(0, cut).join("");
  let truncated = cut < tokens.length;
  const maxChars = Math.max(32, limit * 4);
  if (out.length > maxChars) {
    out = completeCodePointAtEnd(out.slice(0, maxChars));
    truncated = true;
  } else if (truncated) {
    out = completeCodePointAtEnd(out);
  }
  if (!truncated) return { text, truncated: false };
  out = out.replace(/\s+$/u, "");
  const note = ref === null ? "...(truncated)" : `...(truncated from ${ref})`;
  return { text: out + note, truncated: true };
}

// Keep the LAST `limit` non-whitespace tokens of a text, additionally capped
// at `limit * 4` characters. The end of the text is always preserved.
export function tailTokens(text: string, limit: number, ref: string | null): TruncatedText {
  const tokens = tokenize(text);
  let count = 0;
  let startIndex = tokens.length;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if ((tokens[index] ?? "").trim().length > 0) {
      count += 1;
      if (count > limit) break;
    }
    startIndex = index;
  }
  let out = startIndex === 0 ? text : tokens.slice(startIndex).join("");
  let truncated = startIndex > 0;
  const maxChars = Math.max(32, limit * 4);
  if (out.length > maxChars) {
    out = completeCodePointAtStart(out.slice(out.length - maxChars));
    truncated = true;
  } else if (truncated) {
    out = completeCodePointAtStart(out);
  }
  if (!truncated) return { text, truncated: false };
  const note = ref === null ? "...(elided before)" : `...(elided before ${ref})`;
  return { text: note + out, truncated: true };
}
