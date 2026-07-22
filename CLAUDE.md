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

## Mechanical guard

`scripts/fork-surface-check.py` fails on edits to upstream files that are not in
`.fork-surface`. Enable the local hook once:

```
git config core.hooksPath .githooks
```

It blocks by default. `FORK_SURFACE_WARN=1` downgrades it to a warning when you
genuinely need to land an exception - add the path to `.fork-surface` and
FORK.md in the same commit.

Full model, change catalogue and recovery plan: [FORK.md](FORK.md).

@AGENTS.md
