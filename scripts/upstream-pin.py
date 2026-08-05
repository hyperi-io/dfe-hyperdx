#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/upstream-pin.py
#  Purpose:      Read, verify and move the fork's upstream pin
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Own `.upstream-version` - which upstream release this fork is built on.

The pin is one half of the fork's release identity: a published image tag says
what WE changed, the pin says what we changed it ON TOP OF. Recording it in a
committed file makes that mapping recoverable for every release we ever cut.

`git merge-base HEAD upstream/main` is the ground truth; the file is the intent.
`--verify` asserts they agree, which is what catches an upstream merge that
forgot to move the pin - the failure that makes every later "which upstream is
this?" answer a guess.

Usage::

    scripts/upstream-pin.py --show                       # what are we on
    scripts/upstream-pin.py --verify                     # intent == git truth
    scripts/upstream-pin.py --set '@hyperdx/app@2.33.0'  # move it (sync only)

Exit codes: 0 agreed; 1 the pin and the tree disagree, or the ref is unknown.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MARKER = REPO_ROOT / ".upstream-version"
UPSTREAM_REF = "upstream/main"
RELEASE_TAG_PREFIX = "@hyperdx/app@"

_FIELD = re.compile(r"^(?P<key>[a-z_]+):\s*(?P<value>.*?)\s*$")


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


def read_pin() -> dict[str, str]:
    """Parse the marker. Three scalar fields, so a regex beats a YAML dep."""
    if not MARKER.is_file():
        return {}
    pin: dict[str, str] = {}
    for raw in MARKER.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        match = _FIELD.match(raw)
        if match:
            pin[match.group("key")] = match.group("value").strip("'\"")
    return pin


def merge_base() -> str:
    """Where our history actually joins upstream's."""
    return _git("merge-base", "HEAD", UPSTREAM_REF)


def write_pin(ref: str, sha: str, synced: str) -> None:
    """Rewrite the marker's three fields, leaving the header comment intact."""
    lines = MARKER.read_text(encoding="utf-8").splitlines() if MARKER.is_file() else []
    header = [line for line in lines if not _FIELD.match(line) or line.lstrip().startswith("#")]
    while header and not header[-1].strip():
        header.pop()
    body = [
        f"upstream_ref: '{ref}'",
        f"upstream_sha: {sha}",
        f"synced: {synced}",
    ]
    MARKER.write_text("\n".join([*header, "", *body]) + "\n", encoding="utf-8", newline="\n")


def _show() -> int:
    pin = read_pin()
    if not pin:
        print("No .upstream-version marker - the fork's upstream base is unrecorded.")
        return 1
    for key in ("upstream_ref", "upstream_sha", "synced"):
        print(f"{key}: {pin.get(key, '(missing)')}")
    return 0


def _verify() -> int:
    pin = read_pin()
    if not pin:
        print("ERROR: .upstream-version is missing or unreadable.", file=sys.stderr)
        return 1

    recorded = pin.get("upstream_sha", "")
    actual = merge_base()

    if not actual:
        print(
            "upstream ref unavailable - run: git fetch upstream\n"
            "Declining to verify rather than passing a check that ran on nothing.",
            file=sys.stderr,
        )
        return 1

    if recorded == actual:
        print(f"pin agrees with the tree: {pin.get('upstream_ref')} ({actual[:8]})")
        return 0

    print(
        f"PIN DISAGREES WITH THE TREE\n"
        f"  .upstream-version says: {recorded[:8] or '(unset)'} "
        f"({pin.get('upstream_ref', 'unknown ref')})\n"
        f"  git merge-base says:    {actual[:8]}\n\n"
        f"The tree is right - history does not lie about what was merged. Move the\n"
        f"pin to match, in the same commit as the merge that moved it:\n"
        f"  scripts/upstream-pin.py --set <the upstream tag that was merged>",
        file=sys.stderr,
    )
    return 1


def _name_for(ref: str, sha: str) -> str:
    """A durable label for the commit, preferring an upstream release tag.

    The scheduled sync merges `upstream/main`, and recording that as the pin
    names a moving branch rather than the release we are actually on - useless
    the moment the branch advances. The nearest release tag is the answer to
    "which upstream is this build?"; the raw ref is kept when there is none.
    """
    if ref.startswith(RELEASE_TAG_PREFIX):
        return ref
    described = _git(
        "describe", "--tags", "--abbrev=0", "--match", f"{RELEASE_TAG_PREFIX}*", sha
    )
    if not described:
        return ref
    if _git("rev-parse", f"{described}^{{commit}}") == sha:
        return described
    return f"{described}+ ({ref})"


def _set(ref: str, synced: str | None) -> int:
    sha = _git("rev-parse", f"{ref}^{{commit}}")
    if not sha:
        print(
            f"ERROR: {ref!r} does not resolve to a commit. Fetch tags first:\n"
            f"  git fetch --tags upstream",
            file=sys.stderr,
        )
        return 1

    if synced is None:
        synced = _git("show", "-s", "--format=%cs", sha)
    name = _name_for(ref, sha)
    write_pin(name, sha, synced)
    print(f"pin -> {name} ({sha[:8]}, upstream committed {synced})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--show", action="store_true", help="Print the recorded pin.")
    group.add_argument(
        "--verify", action="store_true", help="Fail if the pin and the merge base disagree."
    )
    group.add_argument("--set", metavar="REF", help="Move the pin to an upstream tag or commit.")
    parser.add_argument(
        "--synced",
        metavar="YYYY-MM-DD",
        help="Override the sync date (defaults to the upstream commit date).",
    )
    args = parser.parse_args()

    if args.show:
        return _show()
    if args.verify:
        return _verify()
    return _set(args.set, args.synced)


if __name__ == "__main__":
    sys.exit(main())
