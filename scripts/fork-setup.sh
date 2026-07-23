#!/usr/bin/env bash
#  Project:      dfe-hyperdx
#  File:         scripts/fork-setup.sh
#  Purpose:      One-shot local setup for working on the fork - rerere, the
#                conflict-surface hook, and the upstream remote.
#  Language:     Bash
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
#
#  Usage: ./scripts/fork-setup.sh
#
#  Everything here is per-clone git config, which is NOT committed and therefore
#  NOT inherited. A fresh clone (or a container, or an agent sandbox) starts with
#  rerere off and the hook disconnected, which is exactly the state in which
#  somebody quietly adds conflict surface. Run this once per clone.
#
#  Idempotent - safe to re-run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_URL="https://github.com/hyperdxio/hyperdx.git"

# The fork was SQUASH-imported: e58f01d3 "Initial HyperDX commit" is a flattened
# copy of upstream rather than a continuation of their history. That makes git
# lie in two ways -- every untouched upstream line blames to whoever ran the
# import, and ancestry tests cannot tell upstream code from ours.
#
# fbeaf152 is where it was taken from: upstream HEAD at the import timestamp,
# and only 9 files differ from our import commit (the .env removals and the
# HyperI additions made at import time).
#
# A replace-graft reconnects them. It is NON-DESTRUCTIVE -- no object is
# rewritten, no SHA changes, the merge base is unchanged (verified: still
# e2103f78), and `git replace -d e58f01d3...` undoes it. It is per-clone config,
# same as rerere, which is why it is applied here rather than pushed as an
# exotic refs/replace/* ref that nobody fetches by default.
IMPORT_COMMIT="e58f01d3f4ede7b691ee4cf2873ad8548d93f210"
UPSTREAM_ORIGIN="fbeaf152028aebd0481c08f93e76360a70ec864d"

cd "$REPO_ROOT"

echo "=== dfe-hyperdx fork setup ==="

# 1. rerere - record a conflict resolution once, replay it on every later sync.
#    Without this the fork's whole sync model does not work.
git config rerere.enabled true
git config rerere.autoupdate true
echo "  [ok] rerere enabled (+ autoupdate)"

# 2. The conflict-surface guard. Blocks edits to uncatalogued upstream files.
git config core.hooksPath .githooks
echo "  [ok] hooks path -> .githooks"

# 3. The upstream remote. The guard needs it to tell OUR files from upstream's,
#    and without it the guard errs towards flagging everything.
if git remote get-url upstream >/dev/null 2>&1; then
    echo "  [ok] upstream remote already present"
else
    git remote add upstream "$UPSTREAM_URL"
    echo "  [ok] upstream remote added"
fi

echo ""
echo "Fetching upstream (needed for the drift report)..."
git fetch --no-tags upstream

# 4. Reconnect the squashed import to upstream history (see the note above).
#    Needs upstream fetched first, hence the ordering.
if git rev-parse --verify --quiet "refs/replace/${IMPORT_COMMIT}" >/dev/null; then
    echo "  [ok] import graft already in place"
elif ! git cat-file -e "${UPSTREAM_ORIGIN}^{commit}" 2>/dev/null; then
    echo "  [SKIP] graft: ${UPSTREAM_ORIGIN:0:8} not present (shallow clone?)"
else
    git replace --graft "${IMPORT_COMMIT}" "${UPSTREAM_ORIGIN}"
    echo "  [ok] grafted the import onto upstream ${UPSTREAM_ORIGIN:0:8}"
    echo "       git blame and ancestry now resolve to real upstream authors"
fi

echo ""
./.githooks/fork-surface-check.py --drift

echo ""
echo "Read CLAUDE.md before changing anything that came from upstream."
