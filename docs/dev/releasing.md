# Releasing

Releases are deliberate user actions: compute the release set, bump,
commit, tag. **Never push** — the operator pushes the branch and tags,
and CI publishes each tagged package to npm automatically
(trusted publishing).

## Routine release

```bash
./scripts/release.sh patch   # or: minor | major | X.Y.Z (default: patch)
./scripts/release.sh patch --dry-run   # print the release set, change nothing
```

The script aborts on a dirty tree (tracked modifications; untracked files
are ignored), runs the full validation suite (`bun run check`), computes
which packages changed, guards against republishing an existing npm
version, bumps each `package.json`, prepends a `CHANGELOG.md` section per
package (generated from conventional commits since that package's last
tag via `scripts/changelog.sh` — no dependencies, fully offline),
commits once, and tags per package (`<pkg>@v<version>`) — but does
**not** push. Then, on explicit operator instruction, run the
operator-only push script (agents must never run it — it requires an
interactive terminal and has no bypass flag):

```bash
./scripts/push-release.sh                  # tags on HEAD, the release just made
./scripts/push-release.sh --repush <tag>... # re-fire tags already on the remote
```

It pushes the branch first, then one push per tag — mirroring the
original per-package flow (`git push --atomic origin main "$tag"`).
A combined `git push --tags` does not reliably deliver tag-push
events to Actions, so the publish workflows may never fire. Verify
each tag shows a publish run in the Actions tab.

Tags do NOT follow a branch push — push them explicitly, or the next
run's change detection breaks.

## If no publish workflow fired

Re-pushing an unchanged tag fires no event, so a tag that reached
the remote without triggering its workflow must be deleted first,
then pushed again — the `--repush` mode does exactly that, one tag
at a time. It refuses piped stdin, so only run it yourself:

```bash
./scripts/push-release.sh --repush <pkg>@v<version>...
```

## Only touched packages release (no lockstep)

Each package is diffed against its own last tag
(`git log <pkg>@<last>..HEAD -- packages/<pkg>/`); only packages with
changes ship. Untouched packages keep their version — a release never
bumps versions for packages with nothing new.

- **Core cascade:** `packages/core` is private and never versioned,
  tagged, or changelogged — but the built dists bundle it, so a core
  change ships all its consumers too (`opencode-v2`, `deepseek`, `pi`,
  `helper`). The changelog section notes the cascade when core alone
  forced the release.
- **V1 excluded:** `packages/opencode` (legacy V1) is frozen,
  superseded, and unpublished — excluded from all release machinery.
- **Bootstrap:** a package with no prior tag counts as changed.
- **Root-only changes** (`docs/`, `scripts/`, `.github/`, lockfile)
  release nothing by themselves.
- **Uniform bump:** one bump level applies to every package in a run;
  per-package levels are a later refinement, explicitly out of scope.

## Changelogs (per package)

`packages/<name>/CHANGELOG.md` is the human-readable record of what
shipped, generated from conventional commits. Tag-push CI creates the
GitHub release with generated notes; regenerate history (idempotent):

```bash
./scripts/changelog.sh --backfill <package>
```

## Choosing the bump

- `patch` — bug fixes, no user-visible behavior change.
- `minor` — user-visible improvements. Backward compatible.
- `major` — breaking contract change.

Post-`1.0.0` doc-only commits ride the next version; no release for
docs alone.

## First-publish checklist (one-time, per package)

The six published packages (`helper`, `opencode-v2`, `pi`, `codex`,
`deepseek`, `claude-code`) ship as `@jwitmann/*` via tag-triggered
workflows (`.github/workflows/publish-*.yml`) using npm trusted
publishing. Before the first tag-publish of each package, link it as a
trusted publisher of the new repo — the first publish fails without it.
Expected: the first release after the rename ships all 6 packages (the
rename touches every `package.json`, so every package diffs non-empty
against its last tag). That one-time scope-republish is normal.
