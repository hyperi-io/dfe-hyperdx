#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/lockfile-floor.py
#  Purpose:      Fail when a lockfile change resolves a package below its base version
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Hold yarn.lock's resolved versions at or above the base branch's.

The upstream merge driver takes upstream's lockfile whole, and `yarn install`
only re-derives what our package.json asks for. Every fix main holds in the
lockfile alone (a `yarn up -R` inside a declared range) goes back to upstream's
older version, and nothing fails. This reads the resolved versions at the base
and at HEAD, and names each package that fell.

A package is below its floor when a descriptor present in both lockfiles now
resolves lower, or when one of its base major lines has no version at or above
that line's base maximum. A package absent from the current lockfile is a dropped
dependency, not a regression, and a higher major covers a lower one.

Usage::

    scripts/lockfile-floor.py                    # against the merge base with main
    scripts/lockfile-floor.py --base <sha>       # check against an explicit base
    scripts/lockfile-floor.py --names            # names only, for yarn up -R

Allowed downgrades go in `security/lockfile-floor-allow.txt`, one per line as
`<package> <reason>`. A line with no reason is rejected.

Exit codes: 0 no package below its floor; 1 at least one is; 2 the base lockfile
or the current one could not be read.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LOCKFILE = "yarn.lock"
ALLOW_FILE = REPO_ROOT / "security" / "lockfile-floor-allow.txt"
DEFAULT_BASE_REF = "origin/main"

_VERSION = re.compile(
    r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$"
)


def version_key(version: str) -> tuple | None:
    """Order two semver strings. None for anything that is not semver."""
    match = _VERSION.match(version)
    if not match:
        return None
    major, minor, patch, pre = match.groups()
    if pre is None:
        # A release sorts above every prerelease of the same x.y.z.
        pre_key: tuple = (1,)
    else:
        parts = []
        for ident in pre.split("."):
            # Numeric identifiers sort below alphanumeric ones, per semver.
            parts.append((0, int(ident), "") if ident.isdigit() else (1, 0, ident))
        pre_key = (0, tuple(parts))
    return (int(major), int(minor), int(patch), pre_key)


def parse_lockfile(text: str) -> dict[str, tuple[str, str]]:
    """Map each registry descriptor to its package name and resolved version.

    A descriptor is the `name@npm:range` a lockfile entry answers to. Workspaces,
    patches and other non-registry resolutions are skipped: they carry no version
    a fix could raise.
    """
    resolved: dict[str, tuple[str, str]] = {}
    descriptors: list[str] = []
    version = ""
    for line in text.splitlines():
        if line and not line[0].isspace():
            header = line.rstrip()
            descriptors = (
                [d.strip().strip('"') for d in header[:-1].split(", ")]
                if header.endswith(":")
                else []
            )
            version = ""
            continue
        stripped = line.strip()
        if stripped.startswith("version:"):
            version = stripped.split(":", 1)[1].strip().strip("'\"")
        elif stripped.startswith("resolution:"):
            resolution = stripped.split(":", 1)[1].strip().strip("'\"")
            at = resolution.find("@", 1)
            if at < 0 or not resolution[at + 1 :].startswith("npm:"):
                continue
            if version_key(version) is None:
                continue
            for descriptor in descriptors:
                resolved[descriptor] = (resolution[:at], version)
    return resolved


def below_floor(
    base: dict[str, tuple[str, str]], head: dict[str, tuple[str, str]]
) -> dict[str, list[str]]:
    """Packages that resolve lower than at the base, with one line of evidence each.

    Two readings, because each misses what the other catches. A descriptor in
    both lockfiles that now resolves lower is a regression even when another
    copy of the package is current. A base major line left with no version at or
    above its maximum catches a descriptor the upstream lockfile renamed. A
    package absent from HEAD is a dropped dependency, and a higher major covers a
    lower one.
    """
    fallen: dict[str, list[str]] = {}
    for descriptor, (name, base_version) in base.items():
        now = head.get(descriptor)
        if now and version_key(now[1]) < version_key(base_version):
            fallen.setdefault(name, []).append(
                f"{descriptor} {base_version} at base, now {now[1]}"
            )

    def by_name(lock: dict[str, tuple[str, str]]) -> dict[str, set[str]]:
        names: dict[str, set[str]] = {}
        for name, version in lock.values():
            names.setdefault(name, set()).add(version)
        return names

    head_names = by_name(head)
    for name, base_versions in by_name(base).items():
        if name in fallen or name not in head_names:
            continue
        head_best = max(head_names[name], key=version_key)
        lines: dict[int, str] = {}
        for version in base_versions:
            major = version_key(version)[0]
            if major not in lines or version_key(version) > version_key(lines[major]):
                lines[major] = version
        for line_max in sorted(lines.values(), key=version_key):
            if version_key(head_best) < version_key(line_max):
                fallen.setdefault(name, []).append(
                    f"{name} {line_max} at base, now at most {head_best}"
                )
    return fallen


def read_allowed() -> set[str]:
    """Packages whose downgrade is recorded as intended, each with a reason."""
    allowed: set[str] = set()
    if not ALLOW_FILE.is_file():
        return allowed
    for number, raw in enumerate(
        ALLOW_FILE.read_text(encoding="utf-8").splitlines(), 1
    ):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        name, _, reason = line.partition(" ")
        if not reason.strip():
            sys.exit(f"{ALLOW_FILE.name}:{number}: '{name}' has no reason")
        allowed.add(name)
    return allowed


def _git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def resolve_base(explicit: str | None) -> str | None:
    """The explicit ref, else where HEAD joins origin/main.

    The merge base, not the tip: a branch cut before main moved on would
    otherwise read main's newer versions as a floor it never saw.
    """
    if explicit:
        return explicit
    result = _git("merge-base", "HEAD", DEFAULT_BASE_REF)
    return result.stdout.strip() if result.returncode == 0 else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--base", help="ref or sha to compare against")
    parser.add_argument(
        "--names", action="store_true", help="print only the regressed package names"
    )
    args = parser.parse_args()

    base_ref = resolve_base(args.base)
    if not base_ref:
        print(f"cannot find a merge base with {DEFAULT_BASE_REF}", file=sys.stderr)
        return 2
    shown = _git("show", f"{base_ref}:{LOCKFILE}")
    if shown.returncode != 0:
        print(
            f"cannot read {LOCKFILE} at {base_ref}: {shown.stderr.strip()}",
            file=sys.stderr,
        )
        return 2
    head_path = REPO_ROOT / LOCKFILE
    if not head_path.is_file():
        print(f"{head_path} does not exist", file=sys.stderr)
        return 2

    allowed = read_allowed()
    fallen = {
        name: found
        for name, found in below_floor(
            parse_lockfile(shown.stdout),
            parse_lockfile(head_path.read_text(encoding="utf-8")),
        ).items()
        if name not in allowed
    }

    if args.names:
        print("\n".join(sorted(fallen)))
        return 0
    if not fallen:
        print(f"{LOCKFILE}: no package below its version at {base_ref[:12]}")
        return 0

    print(
        f"{LOCKFILE}: {len(fallen)} package(s) resolve below their version at "
        f"{base_ref[:12]}"
    )
    for name in sorted(fallen):
        for evidence in fallen[name]:
            print(f"  {evidence}")
    print(
        "\nRe-resolve them inside their declared ranges: "
        "yarn up -R $(scripts/lockfile-floor.py --names)"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
