#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/security-override.py
#  Purpose:      Keep the fork's security pins honest, and tell us when to unwind
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
"""Check the fork's security dependency overrides against the resolved tree.

THE PROBLEM THIS SOLVES. This fork mutes dependency advisories by default,
because we do not own upstream's dependency tree and a queue of unmergeable
bumps trains everyone to ignore the queue (see FORK.md). The exception is a
HIGH/CRITICAL advisory with a REAL VECTOR - the vulnerable path is actually
reachable in how DFE runs this. Then we do pin it, in `resolutions`.

And that pin is the thing that rots. Upstream fixes it a few weeks later, our
override becomes a no-op nobody notices, and the fork carries a permanent,
undocumented divergence in the single file upstream churns most.

So this inverts the nag. It does not tell you about vulnerabilities - that is
deliberately somebody else's job. It tells you when one of YOUR OWN pins has
become REDUNDANT, so it can be deleted while the reason is still fresh.

Usage::

    scripts/security-override.py --check    # CI + pre-sync: fails on redundancy
    scripts/security-override.py --list     # what are we carrying, and why

Exit codes: 0 nothing to do; 1 an override is redundant or malformed.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
REGISTER = REPO_ROOT / "security" / "overrides.yaml"
LOCKFILE = REPO_ROOT / "yarn.lock"

REQUIRED_FIELDS = ("package", "range", "advisory", "severity", "vector", "upstream", "added")
ALLOWED_SEVERITY = {"high", "critical"}

# "foo@npm:^1.2.3, foo@npm:^1.3.0":  ->  we want the package name(s)
_ENTRY_KEY = re.compile(r'^"?(?P<specs>[^"\s].*?)"?:\s*$')
_VERSION = re.compile(r"^\s+version:\s*\"?(?P<version>[^\"\s]+)\"?\s*$")
_SPEC_NAME = re.compile(r"^(?P<name>@?[^@]+(?:/[^@]+)?)@")


def _load_register() -> list[dict]:
    """Read the override register without requiring a YAML dependency.

    The register is deliberately a flat list of simple scalars, so a tiny reader
    beats making every clone install pyyaml to run a guard.
    """
    if not REGISTER.is_file():
        return []

    entries: list[dict] = []
    current: dict | None = None

    for raw in REGISTER.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw.strip() == "overrides: []":
            return []
        if raw.strip() == "overrides:":
            continue

        stripped = raw.strip()
        if stripped.startswith("- "):
            if current:
                entries.append(current)
            current = {}
            stripped = stripped[2:]
        if current is None:
            continue
        if ":" in stripped:
            key, _, value = stripped.partition(":")
            value = value.strip().strip('"').strip("'")
            if value in (">-", "|", ">"):
                value = ""  # folded block; the prose continues on later lines
            current[key.strip()] = value

    if current:
        entries.append(current)
    return entries


def _resolved_versions() -> dict[str, set[str]]:
    """Every version each package actually resolves to in yarn.lock.

    A package can legitimately resolve to several versions in a workspace tree,
    so this collects all of them - claiming an override is redundant when only
    ONE of three resolutions is patched would be worse than saying nothing.
    """
    versions: dict[str, set[str]] = {}
    if not LOCKFILE.is_file():
        return versions

    names: list[str] = []
    for line in LOCKFILE.read_text(encoding="utf-8").splitlines():
        version_match = _VERSION.match(line)
        if version_match and names:
            for name in names:
                versions.setdefault(name, set()).add(version_match.group("version"))
            names = []
            continue

        key_match = _ENTRY_KEY.match(line)
        if key_match:
            names = []
            for spec in key_match.group("specs").split(", "):
                spec_match = _SPEC_NAME.match(spec.strip().strip('"'))
                if spec_match:
                    names.append(spec_match.group("name"))
    return versions


def _parse_version(value: str) -> tuple[int, ...]:
    """Numeric prefix of a semver, for comparison. '1.2.3-rc1' -> (1, 2, 3)."""
    parts: list[int] = []
    for chunk in value.split("-")[0].split("."):
        if chunk.isdigit():
            parts.append(int(chunk))
        else:
            break
    return tuple(parts)


def _minimum_of(range_spec: str) -> tuple[int, ...]:
    """Lowest version a range admits, e.g. '>=1.2.3' or '^1.2.3' -> (1, 2, 3)."""
    cleaned = range_spec.strip().lstrip("^~>=< ").strip()
    return _parse_version(cleaned)


def _validate(entry: dict, index: int) -> list[str]:
    errors: list[str] = []
    label = entry.get("package") or f"entry {index + 1}"

    for field in REQUIRED_FIELDS:
        if not entry.get(field):
            errors.append(f"{label}: missing required field {field!r}")

    severity = (entry.get("severity") or "").lower()
    if severity and severity not in ALLOWED_SEVERITY:
        errors.append(
            f"{label}: severity {severity!r} does not meet the bar "
            f"(only {'/'.join(sorted(ALLOWED_SEVERITY))} justify a fork override)"
        )
    return errors


def _check() -> int:
    entries = _load_register()
    if not entries:
        print("No fork security overrides registered - nothing to unwind.")
        return 0

    problems: list[str] = []
    for index, entry in enumerate(entries):
        problems.extend(_validate(entry, index))
    if problems:
        print("Register is malformed:\n")
        for problem in problems:
            print(f"  ERROR: {problem}")
        return 1

    resolved = _resolved_versions()
    redundant: list[dict] = []

    print(f"Checking {len(entries)} fork security override(s) against yarn.lock\n")
    for entry in entries:
        package = entry["package"]
        floor = _minimum_of(entry["range"])
        present = resolved.get(package, set())

        if not present:
            print(f"  [gone]      {package} - not in the tree at all; the pin does nothing")
            redundant.append(entry)
            continue

        below = {v for v in present if _parse_version(v) < floor}
        if below:
            print(
                f"  [holding]   {package} {entry['range']} - still needed "
                f"(resolves to {', '.join(sorted(present))})"
            )
        else:
            print(
                f"  [REDUNDANT] {package} {entry['range']} - upstream now ships "
                f"{', '.join(sorted(present))}"
            )
            redundant.append(entry)

    if not redundant:
        print("\nEvery override is still doing work.")
        return 0

    print(f"\n{len(redundant)} override(s) can be UNWOUND. For each one:")
    print("  1. delete its entry from security/overrides.yaml")
    print("  2. delete its line from the root package.json resolutions block")
    print("  3. yarn install, and confirm the lockfile still resolves above the floor")
    print("\nLeaving a dead pin in place is how a fork drifts without anyone deciding to.")
    for entry in redundant:
        print(f"\n  {entry['package']}  ({entry.get('advisory', 'no advisory')})")
        print(f"    added:    {entry.get('added', 'unknown')}")
        print(f"    upstream: {entry.get('upstream', 'not raised')}")
    return 1


def _list() -> int:
    entries = _load_register()
    if not entries:
        print("No fork security overrides registered.")
        return 0
    for entry in entries:
        print(f"{entry.get('package')}  {entry.get('range')}  [{entry.get('severity')}]")
        print(f"  advisory: {entry.get('advisory')}")
        print(f"  vector:   {entry.get('vector')}")
        print(f"  upstream: {entry.get('upstream')}")
        print(f"  added:    {entry.get('added')}\n")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--check", action="store_true", help="Fail if an override is redundant or malformed."
    )
    group.add_argument("--list", action="store_true", help="Show what we carry and why.")
    args = parser.parse_args()

    return _check() if args.check else _list()


if __name__ == "__main__":
    sys.exit(main())
