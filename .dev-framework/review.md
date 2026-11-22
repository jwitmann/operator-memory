# Review — session: branding leftovers (upstream attribution, V1 row, banner images)

Docs-only session (plus binary image assets), no product code. Cadence per
the gate's docs rule: `lint:md` on the changed files, recorded below.
Prior specialist battery reused where scope is unchanged: pattern-guardian
and code-reviewer reported clean on the README attribution change;
style-enforcer reported clean. No product-code delta since those reports.

## Scope — every session-changed file

- `README.md`
  - Restored the fork attribution to the original project:
    `aerovato/operator-memory` (name + URL). The rename codemod had
    rewritten it to `aerovato/vcc-brain`; the upstream repo keeps its
    old name, so this was a misattribution, not a rename target.
    Verified no other file references the upstream under the new name
    (`grep aerovato/` tree-wide: single hit, this line).
  - Dropped the `OpenCode V1 (legacy)` row from the support table.
    V1 is frozen, not installed for new users; advertising it as
    "Supported, Legacy" was wrong. `docs/harnesses/opencode.md` stays
    as the frozen-behavior reference.
- `docs/assets/banner.jpeg` — headline + pill text redrawn as
  "VCC Brain" (EB Garamond Bold / Inter Display Medium, sampled inks,
  flat-cream fill). Tagline and cards untouched (no product name).
- `docs/assets/getting-started.jpeg` — headline redrawn as "VCC Brain".
  Tagline untouched.
- `docs/assets/change-the-loop.png` — "Without/With Operator Memory"
  headers redrawn as "Without/With VCC Brain" (Inter Regular, original
  gray/green inks, centered on the original header centers).

## Findings and resolutions

No blocking issues. The image work is pixel surgery, so verification is
visual, not textual:

- Fail-before: viewed all three originals; each baked in
  "Operator Memory" (banner headline + pill, getting-started headline,
  both loop headers).
- Method: threshold-detected text bounding boxes, flat-fill with locally
  sampled background/pill colors, redrew with system Garamond/Inter cuts
  size-matched to the original cap heights (left-aligned headlines to
  preserve tagline alignment; centered pill/headers on original centers).
  JPEGs re-saved at quality 95; PNG kept lossless. Originals recoverable
  from git (tracked files).
- Pass-after: viewed crops of all five edited zones — Garamond headline
  matches the original cut, pill text centered in the sage pill with no
  residue, headers correctly colored and positioned. No seams or
  background mismatch visible in any crop.
- Residue sweep: no remaining `Operator Memory` baked text; `grep` for
  `aerovato/vcc-brain` and `install opencode-v1` in docs returns nothing
  outside CHANGELOG history.

## Verification

- `bun run lint:md`: 135 files, 0 issues (this artifact included).
- Pre-commit hooks on both session commits green (per-package gates).
- No `bun run check` impact possible: zero `.ts` changes this session
  (README + images only); last full gate on the product tree was green
  at 557 tests and the tree is unchanged since except these files.
