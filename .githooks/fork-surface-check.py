#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         .githooks/fork-surface-check.py
#  Purpose:      Guard the fork's rerere conflict surface
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
"""Fail when a change edits a pristine upstream file that is not catalogued.

This fork merges upstream HyperDX forever, and `git rerere` only replays a
recorded resolution when the conflict preimage matches EXACTLY. Every edit to an
upstream file is therefore permanent conflict surface, and a bulk reformat is
the worst case - it rewrites lines we do not own, so upstream's next change no
longer matches and you hand-resolve again, every sync.

So: editing an upstream file in place is an EXCEPTION that must be identified,
documented (FORK.md) and tooled (listed in `.fork-surface`).

Classification of each changed path:
  - under a ``dfe/`` directory        -> OK, additive, cannot conflict
  - absent from the upstream baseline -> OK, our own new file
  - listed in ``.fork-surface``       -> OK, sanctioned exception
  - otherwise                         -> VIOLATION

Usage::

    # pre-commit (staged changes)
    .githooks/fork-surface-check.py

    # CI (a range)
    .githooks/fork-surface-check.py --base origin/main

    # land a new exception: add it to .fork-surface + FORK.md, or
    FORK_SURFACE_WARN=1 git commit ...
"""

from __future__ import annotations

import argparse
import fnmatch
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = REPO_ROOT / ".fork-surface"
UPSTREAM_REF = "upstream/main"


def _git(*args: str) -> str:
    """Run git in the repo, returning stripped stdout ('' on failure)."""
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except OSError:
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def load_catalogue() -> list[str]:
    """Read `.fork-surface` - one path or glob per line, '#' comments."""
    if not CATALOGUE.exists():
        return []
    patterns: list[str] = []
    for raw in CATALOGUE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            patterns.append(line)
    return patterns


def changed_files(base: str | None) -> list[str]:
    """Staged files, or the files changed since *base*."""
    if base:
        out = _git("diff", "--name-only", "--diff-filter=ACMR", f"{base}...HEAD")
    else:
        out = _git("diff", "--cached", "--name-only", "--diff-filter=ACMR")
    return [line for line in out.splitlines() if line]


def upstream_baseline() -> str:
    """Merge-base with upstream, or '' when the upstream ref is unavailable."""
    return _git("merge-base", "HEAD", UPSTREAM_REF)


def is_additive(path: str) -> bool:
    """True for paths under a `dfe/` directory - they do not exist upstream."""
    parts = Path(path).parts
    return "dfe" in parts or any(p.startswith("dfe.") for p in parts)


def exists_upstream(baseline: str, path: str) -> bool:
    """True when *path* exists in the upstream baseline tree.

    ``git cat-file -e`` signals via exit code and prints nothing, so this
    checks the return code directly rather than going through :func:`_git`.
    """
    if not baseline:
        # No upstream ref (shallow clone). Assume it IS upstream so we err
        # towards flagging rather than silently passing a real violation.
        return True
    try:
        result = subprocess.run(
            ["git", "cat-file", "-e", f"{baseline}:{path}"],
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        )
    except OSError:
        return True
    return result.returncode == 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--base",
        help="Check the range <base>...HEAD instead of the staged changes.",
    )
    args = parser.parse_args()

    files = changed_files(args.base)
    if not files:
        return 0

    catalogue = load_catalogue()
    baseline = upstream_baseline()
    violations: list[str] = []

    for path in files:
        if is_additive(path):
            continue
        if any(fnmatch.fnmatch(path, pattern) for pattern in catalogue):
            continue
        if not exists_upstream(baseline, path):
            continue
        violations.append(path)

    if not violations:
        return 0

    warn_only = os.environ.get("FORK_SURFACE_WARN", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    label = "WARNING" if warn_only else "BLOCKED"
    print(f"\n{label}: edit to uncatalogued upstream file(s):\n", file=sys.stderr)
    for path in violations:
        print(f"  {path}", file=sys.stderr)
    print(
        "\nThese are pristine upstream files, so every edit becomes permanent\n"
        "merge-conflict surface and weakens git rerere on each upstream sync.\n"
        "\nDo ONE of:\n"
        "  - move the change under a dfe/ directory (preferred, cannot conflict)\n"
        "  - exclude the path from the tool instead of editing it (formatters:\n"
        "    .prettierignore / eslint ignores) if this is a formatting-only edit\n"
        "  - if the edit is genuinely required, land it as a documented\n"
        "    exception: add the path to .fork-surface AND describe the delta in\n"
        "    FORK.md in this same commit, then re-run\n"
        "\nTo override for one commit: FORK_SURFACE_WARN=1 git commit ...\n",
        file=sys.stderr,
    )
    if not baseline:
        print(
            "NOTE: upstream ref unavailable, so upstream-existence could not be\n"
            "confirmed. Fetch it with: git fetch upstream\n",
            file=sys.stderr,
        )
    return 0 if warn_only else 1


if __name__ == "__main__":
    sys.exit(main())
