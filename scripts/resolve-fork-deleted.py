#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/resolve-fork-deleted.py
#  Purpose:      Keep fork-deleted upstream files deleted through a merge
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Resolve modify/delete conflicts on the files `.fork-deleted` lists.

An upstream file we deleted on purpose conflicts whenever upstream edits it:
we deleted it, they modified it. rerere only records text conflicts, so it
never replays this one and every such edit stalls the sync. The answer is
always the same - the file stays deleted - so this runs after `git merge` and
`git rm`s exactly those paths.

A path is resolved only when both hold:

  - it is unmerged with the merge-base and upstream stages present and ours
    absent (we deleted it, upstream modified it)
  - it matches a `.fork-deleted` entry (a path or fnmatch glob)

Everything else is left for the merge to report: a text conflict on a listed
path, a modify/delete on an unlisted path, and a file upstream deleted that we
modified.

Usage::

    git merge upstream/main || scripts/resolve-fork-deleted.py

Prints each path it resolved. Exit 0 whether or not it resolved anything, 1
when git itself fails.
"""

from __future__ import annotations

import fnmatch
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DELETIONS = REPO_ROOT / ".fork-deleted"


def _git(*args: str) -> str:
    """Run git in the repo and return stdout, raising when it fails."""
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    ).stdout


def load_deletions() -> list[str]:
    """Read `.fork-deleted` - one path or glob per line, '#' comments."""
    if not DELETIONS.is_file():
        return []
    entries: list[str] = []
    for raw in DELETIONS.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            entries.append(line)
    return entries


def unmerged_stages() -> dict[str, set[int]]:
    """Map each unmerged path to the index stages it still has.

    Stage 1 is the merge base, 2 is ours, 3 is upstream's. `-z` keeps a path
    with a quote or newline in it intact, and upstream controls these names.
    """
    stages: dict[str, set[int]] = {}
    for record in _git("ls-files", "--unmerged", "-z").split("\0"):
        if not record:
            continue
        meta, _, path = record.partition("\t")
        stages.setdefault(path, set()).add(int(meta.split()[2]))
    return stages


def deleted_by_us(stages: set[int]) -> bool:
    """True for a modify/delete where WE deleted: base and theirs, no ours."""
    return stages == {1, 3}


def resolve() -> list[str]:
    """`git rm` every unmerged fork-deleted path we deleted, returning them."""
    patterns = load_deletions()
    resolved = [
        path
        for path, stages in sorted(unmerged_stages().items())
        if deleted_by_us(stages) and any(fnmatch.fnmatchcase(path, p) for p in patterns)
    ]
    for path in resolved:
        _git("rm", "--quiet", "--", path)
    return resolved


def main() -> int:
    try:
        resolved = resolve()
    except (subprocess.CalledProcessError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    for path in resolved:
        print(f"kept deleted (.fork-deleted): {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
