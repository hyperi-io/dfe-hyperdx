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

echo ""
./.githooks/fork-surface-check.py --drift

echo ""
echo "Read CLAUDE.md before changing anything that came from upstream."
