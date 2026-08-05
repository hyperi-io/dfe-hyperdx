#!/usr/bin/env bash
#  Project:      dfe-hyperdx
#  File:         scripts/merge-lockfile.sh
#  Purpose:      Resolve a yarn.lock merge by taking upstream's and regenerating
#  Language:     Bash
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
#
#  Wired up as a git merge driver by scripts/fork-setup.sh. Git calls it with
#  the three-way inputs: %O ancestor, %A ours (also the output file), %B theirs.
#
#  There is exactly one correct resolution for a lockfile and it is never
#  "replay these hunks": the file is generated, so the answer is upstream's
#  version plus whatever `yarn install` then derives from our package.json. A
#  hand-merged or rerere-replayed lockfile is a fiction that happens to parse.
#
#  Taking theirs DROPS our fork-only entries until `yarn install` runs. That is
#  deliberate and loud: CI runs `yarn install --immutable`, which fails rather
#  than shipping a lockfile nobody regenerated.
set -euo pipefail

ours="$2"    # %A - git reads the merge result back out of this path
theirs="$3"  # %B

cp -- "$theirs" "$ours"

echo "yarn.lock: took upstream's copy - run 'yarn install' to re-derive our entries" >&2
