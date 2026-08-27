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
documented (docs/fork/what-we-changed.md) and tooled (listed in `.fork-surface`).

Classification of each changed path:
  - under a ``dfe/`` directory        -> OK, additive, cannot conflict
  - absent from the upstream baseline -> OK, our own new file
  - listed in ``.fork-surface``       -> OK, sanctioned exception
  - otherwise                         -> VIOLATION

Deletions need their own catalogue, ``.fork-deleted``. An upstream file we
removed is unchanged against the merge base, so no diff above can see it and a
sync reinstates it in silence - the check there is simply that a listed path
must not exist.

Usage::

    # pre-commit (staged changes)
    .githooks/fork-surface-check.py

    # CI (a range)
    .githooks/fork-surface-check.py --base origin/main

    # EARLY WARNING - what has upstream changed under our deltas?
    git fetch upstream && .githooks/fork-surface-check.py --drift

    # what is catalogued that should not be?
    .githooks/fork-surface-check.py --audit

    # land a new exception: add it to .fork-surface + docs/fork/what-we-changed.md, or
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
DELETIONS = REPO_ROOT / ".fork-deleted"
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


def load_deletions() -> list[str]:
    """Read `.fork-deleted` - one upstream path we removed per line."""
    if not DELETIONS.exists():
        return []
    paths: list[str] = []
    for raw in DELETIONS.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            paths.append(line)
    return paths


def resurrected(paths: list[str]) -> list[str]:
    """Return catalogued deletions that are tracked again.

    A deletion is invisible to every diff this tool reads, because the file is
    unchanged against the merge base - so an upstream sync reinstates it and
    nothing else here notices.
    """
    if not paths:
        return []
    tracked = set(_git("ls-files", "--", *paths).splitlines())
    return [path for path in paths if path in tracked]


def merge_in_progress() -> bool:
    """True while a merge is being resolved.

    AN UPSTREAM MERGE IS NOT AN EDIT. The commit that lands a sync legitimately
    carries hundreds of upstream files, and judging it by "did this commit touch
    an uncatalogued upstream file" flags every one of them - so the guard would
    block the exact operation it exists to protect, on every single sync.

    The conflict surface is what WE changed, and that is checked on the PR
    afterwards against the merge base. Here the honest answer is to stand down.

    Ask git, not the filesystem: in a linked worktree `.git` is a FILE, so a
    path probe is always false and the guard blocks the very sync merge it was
    changed to allow. This repo advertises multi-worktree development.
    """
    return bool(_git("rev-parse", "--verify", "--quiet", "MERGE_HEAD"))


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


def ensure_rerere() -> None:
    """Turn rerere on if it is off. Self-healing, because it is per-clone config.

    `rerere.enabled` is local git config: not committed, so not inherited by a
    fresh clone, a container, or an agent sandbox. The fork's entire sync model
    depends on it, and its absence is silent - resolutions simply never get
    recorded and every sync re-resolves from scratch.

    Anyone running this guard has the hook wired up, so this is the earliest
    reliable moment to fix it. Cheap, idempotent, and announced rather than
    done behind the operator's back.
    """
    if _git("config", "--get", "rerere.enabled") == "true":
        return
    subprocess.run(
        ["git", "config", "rerere.enabled", "true"],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
    )
    subprocess.run(
        ["git", "config", "rerere.autoupdate", "true"],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
    )
    print(
        "NOTE: git rerere was OFF in this clone and has been enabled.\n"
        "      Without it every upstream sync re-resolves the same conflicts.\n",
        file=sys.stderr,
    )


def is_additive(path: str) -> bool:
    """True for paths under a `dfe/` directory - they do not exist upstream."""
    parts = Path(path).parts
    return "dfe" in parts or any(p.startswith("dfe.") for p in parts)


def matches_upstream(baseline: str, path: str, base: str | None) -> bool:
    """True when the post-change content is IDENTICAL to the upstream baseline.

    Reverting an upstream file to pristine REMOVES conflict surface, so it must
    always be allowed even when the path is not catalogued. Compares blob hashes
    rather than content, which is cheap and exact.
    """
    if not baseline:
        return False
    upstream_blob = _git("rev-parse", f"{baseline}:{path}")
    if not upstream_blob:
        return False
    # ':path' is the staged blob; for a range check use the tip of the range.
    ours = _git("rev-parse", f"HEAD:{path}" if base else f":{path}")
    return bool(ours) and ours == upstream_blob


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


def is_test_path(path: str) -> bool:
    """True for a test file - our assertions must never live in an upstream one.

    Upstream test files churn harder than almost anything else (they gain cases
    constantly), so a delta there costs a hand-resolve every sync for tests
    upstream has no stake in. Ours belong in a ``dfe/__tests__/`` directory.
    """
    name = Path(path).name
    return (
        "__tests__" in Path(path).parts
        or ".test." in name
        or ".spec." in name
        or name.endswith(("_test.py", "_test.go"))
    )


def report_drift(catalogue: list[str]) -> int:
    """Print which catalogued files upstream has touched since our merge base.

    THE EARLY-WARNING CHANNEL. Without it the first sign of trouble is a sync
    that will not merge, which is both late and expensive. This answers the only
    question that matters between syncs: has upstream moved under any file we
    hold a delta in?

    Exit 0 always - drift is information, not a failure. Something has to fail
    LOUDLY only when it reaches the merge.
    """
    baseline = upstream_baseline()
    if not baseline:
        print(
            "upstream ref unavailable - run: git fetch upstream", file=sys.stderr
        )
        return 0

    ahead = _git("rev-list", "--count", f"{baseline}..{UPSTREAM_REF}") or "0"
    touched = _git(
        "diff", "--name-only", f"{baseline}..{UPSTREAM_REF}"
    ).splitlines()
    touched_set = {line for line in touched if line}

    at_risk = sorted(
        path
        for path in touched_set
        if any(fnmatch.fnmatch(path, pattern) for pattern in catalogue)
    )

    print(f"upstream is {ahead} commit(s) ahead of our merge base ({baseline[:8]})")
    print(f"upstream touched {len(touched_set)} file(s) in that range")
    print(f"catalogued surface: {len(catalogue)} pattern(s)")

    if not at_risk:
        print("\nNo catalogued file has moved upstream - the next sync is cheap.")
        return 0

    print(f"\nAT RISK - upstream changed {len(at_risk)} file(s) we hold a delta in:")
    for path in at_risk:
        commits = _git(
            "log", "--oneline", f"{baseline}..{UPSTREAM_REF}", "--", path
        ).splitlines()
        flag = "  [TEST FILE]" if is_test_path(path) else ""
        print(f"\n  {path}{flag}")
        for line in commits[:5]:
            print(f"      {line}")
        if len(commits) > 5:
            print(f"      ... and {len(commits) - 5} more")

    print(
        "\nEach of these is a probable conflict on the next sync. Cheapest fix is\n"
        "to shrink the delta BEFORE merging - move logic into a dfe/ module and\n"
        "leave a one-token call-site swap behind. See FORK.md.\n"
    )
    return 0


def warn_test_paths(catalogue: list[str]) -> None:
    """Nag about catalogued test files - they should be migrated to dfe/."""
    tests = [p for p in catalogue if is_test_path(p)]
    if not tests:
        return
    print(
        f"\nNOTE: {len(tests)} catalogued path(s) are upstream TEST files. Our\n"
        "assertions belong in a dfe/__tests__/ directory - upstream test files\n"
        "churn hard and a delta there is paid on every sync:",
        file=sys.stderr,
    )
    for path in tests:
        print(f"  {path}", file=sys.stderr)


def warn_pristine(catalogue: list[str]) -> None:
    """Nag about catalogued paths that now match upstream byte for byte.

    A sync can hand a delta back: upstream adopts our change, or we take theirs
    during a conflict. The file is then pristine and the catalogue entry is
    surface held for NOTHING - it costs a check and asserts a difference that is
    not there. Shrinking this list is the whole goal, so make the chance to do
    it visible rather than waiting for someone to notice.
    """
    baseline = upstream_baseline()
    if not baseline:
        return

    pristine = []
    for path in catalogue:
        if "*" in path:
            continue
        ours = _git("rev-parse", f"HEAD:{path}")
        theirs = _git("rev-parse", f"{baseline}:{path}")
        if ours and ours == theirs:
            pristine.append(path)

    if not pristine:
        return
    print(
        f"\n{len(pristine)} catalogued path(s) are now IDENTICAL to upstream.\n"
        "Delete them from .fork-surface - we are holding surface for nothing:",
        file=sys.stderr,
    )
    for path in pristine:
        print(f"  {path}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--base",
        help="Check the range <base>...HEAD instead of the staged changes.",
    )
    parser.add_argument(
        "--drift",
        action="store_true",
        help="Report which catalogued files upstream has changed since our base.",
    )
    parser.add_argument(
        "--audit",
        action="store_true",
        help="List catalogued paths that should not be catalogued (test files).",
    )
    args = parser.parse_args()

    catalogue = load_catalogue()
    ensure_rerere()

    if args.drift:
        return report_drift(catalogue)

    if args.audit:
        warn_test_paths(catalogue)
        warn_pristine(catalogue)
        return 0

    if not args.base and merge_in_progress():
        print(
            "fork-surface: merge in progress - standing down.\n"
            "An upstream merge legitimately carries upstream's own files; what WE\n"
            "changed is checked on the PR against the merge base.",
            file=sys.stderr,
        )
        return 0

    warn_only = os.environ.get("FORK_SURFACE_WARN", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )

    back = resurrected(load_deletions())
    if back:
        label = "WARNING" if warn_only else "BLOCKED"
        print(f"\n{label}: upstream file(s) we deleted are back:\n", file=sys.stderr)
        for path in back:
            print(f"  {path}", file=sys.stderr)
        print(
            "\nA sync reinstated them. They are unchanged against the merge base,\n"
            "so no diff .fork-surface reads can see them - hence .fork-deleted.\n"
            "\nDelete them again, or drop the path from .fork-deleted in the same\n"
            "commit if we now want upstream's version.\n",
            file=sys.stderr,
        )
        if not warn_only:
            return 1

    files = changed_files(args.base)
    if not files:
        return 0

    baseline = upstream_baseline()
    violations: list[str] = []

    for path in files:
        if is_additive(path):
            continue
        if any(fnmatch.fnmatch(path, pattern) for pattern in catalogue):
            continue
        if not exists_upstream(baseline, path):
            continue
        if matches_upstream(baseline, path, args.base):
            # Reverted to pristine - this REMOVES surface, always allowed.
            continue
        violations.append(path)

    if not violations:
        return 0

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
