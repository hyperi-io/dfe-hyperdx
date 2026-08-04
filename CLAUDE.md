# dfe-hyperdx - a long-lived FORK of hyperdxio/hyperdx

## STOP - the governing rule

**MINIMISE what we change in ANYTHING that comes from upstream.** Upstream
HyperDX moves fast enough on its own - we do not want to be managing small fry
on top of it. Fewer touched upstream files means cheaper syncs, full stop.

**EVERYTHING we do to this fork must work with `git rerere`. Any exception must
be identified, documented AND tooled - otherwise the whole sync process breaks
down.**

This repo merges upstream HyperDX repeatedly, forever. Every edit to a pristine
upstream file becomes permanent merge-conflict surface. Getting this wrong does
NOT fail loudly - it silently makes every future upstream sync more expensive,
and the damage is only felt months later by whoever runs the sync.

## If you change ONE thing about how you work here

**You are about to make the edit bigger than it needs to be.** Every model that
touches this repo does the same thing: it opens the upstream file, rewrites the
function body to do the new thing, and moves on. That edit works, passes tests,
and quietly costs a hand-resolve on every upstream sync forever.

The cheap edit is almost always available. Before you change an upstream file,
in this order:

1. **Can it go under `dfe/` entirely?** Then it costs NOTHING. Do that.
2. **Can the upstream file change by ONE TOKEN?** Write the logic in `dfe/`,
   give your function the SAME SIGNATURE as upstream's, and swap the identifier
   at the call site. `foo(a, b, c)` becomes `dfeFoo(a, b, c)` - the argument
   list stays byte-identical, so if upstream changes the arguments the conflict
   is trivial instead of structural.
3. **Can it be an ADDITION next to a brace?** An `else if` appended to an
   existing block merges cleanly far more often than a modified line does.
4. **Only then**, edit in place - and catalogue it.

Worked example, from a real fix in this repo. We needed native ClickHouse JSON
columns coerced with `toString()`. The first attempt rewrote
`buildJSONExtractQuery`'s body in `DBRowJsonViewer.tsx` and edited upstream's
test expectations: 53 insertions across the two files upstream churns hardest.
The same behaviour, done as rule 2 plus rule 3, is 15 insertions, leaves the
function and the whole test file pristine, and took one upstream test file OFF
the surface list. Same feature. A quarter of the cost, forever.

**Never put our assertions in an upstream test file.** Upstream test files gain
cases constantly, so a delta there is the most expensive kind and buys us
nothing - upstream has no stake in our tests. They go in a `dfe/__tests__/`
directory. `.githooks/fork-surface-check.py --audit` lists the ones that still
need migrating.

## The rules

1. **New code goes under a `dfe/` directory.** Zero conflict risk, because those
   paths do not exist upstream:
   `packages/api/src/dfe/**`, `packages/app/src/dfe/**`,
   `packages/app/src/theme/themes/dfe/**`. This is the default - prefer it.

2. **Editing an upstream file in place is an EXCEPTION.** The `.dfe[CHG]` shadow
   convention is RETIRED - we modify in place now, so those files ARE our
   conflict surface. An exception is only legitimate when it is:
   - **identified** - you know you are touching a pristine upstream file,
   - **documented** - listed in the catalogue in [FORK.md](FORK.md) with why,
   - **tooled** - matched by an entry in `.fork-surface` so the guard passes.

3. **NEVER bulk-reformat or mass-autofix upstream files.** A repo-wide formatter
   or lint `--fix` is the worst case for rerere: it rewrites lines we do not
   own, so upstream's next change to that file no longer matches the recorded
   conflict preimage and you get a FRESH hand-resolve every sync, forever.
   Prefer excluding upstream paths from the tool (`.prettierignore`, eslint
   ignores) over reformatting them to satisfy a gate.

4. **`git rerere` is enabled** (`rerere.enabled` + `rerere.autoupdate`). It
   replays a recorded resolution ONLY when the conflict preimage matches
   exactly. It does not understand our intent and does not prove the replayed
   result still behaves correctly. The test gate is the real guarantee.

5. **Never merge upstream onto `main` by hand.**
   `.github/workflows/upstream-sync.yml` runs the merge on a bot branch, lets
   rerere replay, runs build + test, then opens a PR. `main` is never touched
   directly.

6. **A security fix is TEMPORARY and must never be committed in place.** Upstream
   ships their own within weeks, so a fix committed into an upstream file is
   permanent conflict surface for something we expect to delete - and it lands in
   `package.json`'s `resolutions` block, which upstream churns for their own
   security pins. Declare it instead:
   - a dependency pin -> an entry in `security/overrides.yaml`
   - a code fix -> a patch in `security/patches/`

   Both are GENERATED into the tree, stripped before an upstream merge and
   rebuilt after (`scripts/security-override.py --unapply` / `--apply`), so they
   never reach rerere. Our PERMANENT features are the opposite and DO belong in
   merged history. The test is lifetime, not size.

## Mechanical guard + the tools

Run this ONCE per clone (rerere and the hook are per-clone git config, so a
fresh clone, a container and an agent sandbox all start unprotected):

```
./scripts/fork-setup.sh
```

Then:

```
.githooks/fork-surface-check.py            # staged changes (runs as pre-commit)
.githooks/fork-surface-check.py --base origin/main   # a range, as CI does
.githooks/fork-surface-check.py --drift    # what has upstream moved under us?
.githooks/fork-surface-check.py --audit    # what is catalogued that should not be?
```

`--drift` is the one to run before starting work. It answers "has upstream
touched anything I hold a delta in", which is the cheap moment to shrink that
delta - long before a sync turns it into a conflict. CI runs it daily
(`upstream-drift.yml`) and posts the result to the run summary.

The guard blocks by default and runs in CI (`fork-surface.yml`), so the local
hook is a convenience rather than the control. `FORK_SURFACE_WARN=1` downgrades
it to a warning when you genuinely need to land an exception - add the path to
`.fork-surface` and FORK.md in the same commit.

Full model and change catalogue: [FORK.md](FORK.md). How to run a sync:
[DFE-SYNC-CYCLE.md](DFE-SYNC-CYCLE.md).

@AGENTS.md
