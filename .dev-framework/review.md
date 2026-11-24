# Review — fix(helper): sqlite test timeouts for parallel load

Scope: test-only. No product code changed.
Files: `packages/helper/test/recall-cross-opencode.test.ts`,
`.dev-framework/review.md` (this artifact).

## Change
- Five timeout bumps, nothing else: the four disk-touching async tests on
  `15_000` (cold-path error, no-parts sync, legacy skip, query-plan) go to
  `30_000`, matching the four sibling tests already on 30s; `source opens
  read-only` had no explicit timeout (5s default for a real db open) and
  gets `30_000`.
- Uniform 30s for every sqlite-touching async test in the file; the four
  pure unit tests keep no timeout.

## Battery (scoped to a test-only change)
- test-grounder: fail-before is the gate's own full-workspace run (2
  timeouts: `source opens read-only` at the 5s default, no-parts sync at
  15s under parallel I/O). Pass-after: file alone 13/13, full helper
  suite 145/145 on this tree. No product behavior touched, so no
  fail-before product test applies.
- style-enforcer: post-execute lint passed on the file (5/5 edits).
- code-reviewer / pattern-guardian: no correctness or pattern surface —
  numeric timeout args only, no logic, helper, or convention touched.
  Reuse of prior reports not applicable; there is nothing in scope for
  them to re-read.

## Findings
- None. The flake's mechanism (parallel-load I/O contention vs 5s/15s
  budgets) is removed by uniform 30s budgets; suites confirm.
