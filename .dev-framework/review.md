# Review — fix(opencode-v2): de-flake refresh failure-toast test

Scope: test-only, one file. Fixes the CI failure
(`refresh.test.ts > a failed render toasts once`, `reported` was `[]`,
expected `["ses_test"]`) — a same-millisecond mtime-tick flake in the
test setup, not a product bug. No product code touched.
This session's changed files:
Edited: `packages/opencode-v2/test/refresh.test.ts` (forced mtime bump
after the file→directory swap, mirroring the existing `rewriteCatalog`
hardening in the same file).
This artifact: `.dev-framework/review.md`.

## Cause

- `fingerprintPreamble` stats files (`path:mtimeMs`) and `stat` succeeds
  on the swapped-in directory, so when the seed writes and the
  unlink+mkdir share one millisecond tick, f2 == f1 and
  `maybeRefreshPreamble` returns idle before ever rendering — no toast,
  `reported` stays `[]`. Exactly the hazard class the file's own
  `rewriteCatalog` comment already documents.
- Proven deterministically with a repro script: forcing the new dir's
  mtime back to the deleted file's mtime yields equal fingerprints
  (`fingerprints equal: true`).

## Battery

- Repro script (`/tmp/repro-tick.mts`, memfs + real `fingerprintPreamble`):
  collision reproduced before the fix (equal fingerprints → idle → no toast).
- `bunx vitest run packages/opencode-v2/test/refresh.test.ts` × 8 after
  the fix: 9/9 pass every run.
- `bun run check packages/core`: green (177 tests). `bun run check
  packages/opencode-v2`: green (174 tests, including the fixed test).
- ODF lint on the edited test file: passed.

## Findings

- None blocking. Residual note (accepted limitation, not fixed): mtime
  fingerprints are blind to sub-tick swaps in production too — a
  file→directory swap inside one ms tick is missed until the next change.
  Same class as the `rewriteCatalog` same-tick caveat; fixing that means
  changing the fingerprint format, out of scope for this test fix.
