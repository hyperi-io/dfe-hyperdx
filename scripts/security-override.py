#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/security-override.py
#  Purpose:      Keep the fork's security pins honest, and tell us when to unwind
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
"""Own the fork's security dependency pins, and generate them into package.json.

THE PROBLEM THIS SOLVES. This fork mutes dependency advisories by default,
because we do not own upstream's dependency tree and a queue of unmergeable
bumps trains everyone to ignore the queue (see FORK.md). The exception is a
HIGH/CRITICAL advisory with a REAL VECTOR - the vulnerable path is actually
reachable in how DFE runs this. Then we do pin it, in `resolutions`.

And that pin is the thing that rots. Upstream fixes it a few weeks later, our
override becomes a no-op nobody notices, and the fork carries a permanent,
undocumented divergence in the single file upstream churns most - which upstream
uses for its OWN security pins, so the block is never quiet.

So the pins are not written by hand. `security/overrides.yaml` is the source and
the block is DERIVED from it:

    package.json resolutions == upstream's block at our merge base
                                + exactly the entries in the register

`--unapply` restores the block to upstream's, so an upstream merge sees no delta
there and never conflicts on it. `--apply` rebuilds it after the merge, DROPPING
any entry the newly merged tree already satisfies. That is the "undo our security
fixes, then try again" step of the sync cycle, done mechanically and with a
report of what upstream has taken off our hands.

rerere is deliberately not asked to help: the block's contents change on every
cycle, so a recorded conflict preimage never matches twice.

Usage::

    scripts/security-override.py --list      # what are we carrying, and why
    scripts/security-override.py --check     # fails when a pin is redundant
    scripts/security-override.py --verify    # the invariant above, for CI
    scripts/security-override.py --unapply   # BEFORE an upstream merge
    scripts/security-override.py --apply     # AFTER one; then: yarn install

Exit codes: 0 nothing to do; 1 an override is redundant, malformed, or the
generated block does not match the register.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
REGISTER = REPO_ROOT / "security" / "overrides.yaml"
PATCHES = REPO_ROOT / "security" / "patches"
LOCKFILE = REPO_ROOT / "yarn.lock"
MANIFEST = REPO_ROOT / "package.json"
UPSTREAM_REF = "upstream/main"

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
    folded_key = ""
    folded_indent = 0

    for raw in REGISTER.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw.strip() == "overrides: []":
            return []
        if raw.strip() == "overrides:":
            continue

        indent = len(raw) - len(raw.lstrip())
        stripped = raw.strip()

        # A folded scalar's prose sits on the following, more-indented lines.
        # `vector` is written that way in every documented example, so failing
        # to gather it here would report every real entry as malformed.
        if folded_key and indent > folded_indent and current is not None:
            joined = f"{current[folded_key]} {stripped}".strip()
            current[folded_key] = joined
            continue
        folded_key = ""

        if stripped.startswith("- "):
            if current:
                entries.append(current)
            current = {}
            stripped = stripped[2:]
            indent += 2
        if current is None:
            continue
        if ":" in stripped:
            key, _, value = stripped.partition(":")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if value in (">-", ">", "|", "|-"):
                folded_key, folded_indent, value = key, indent, ""
            current[key] = value

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


def _upstream_base() -> str:
    """The upstream commit whose manifest is our baseline.

    MID-MERGE, HEAD IS STILL THE OLD COMMIT. `git merge-base HEAD upstream/main`
    during an unfinished merge returns the PREVIOUS upstream, so --apply would
    rewrite the block back to the version we just merged away from. MERGE_HEAD is
    the upstream actually being taken, so it wins whenever a merge is in flight.
    """
    merge_head = _git("rev-parse", "--verify", "--quiet", "MERGE_HEAD")
    if merge_head:
        return merge_head
    return _git("merge-base", "HEAD", UPSTREAM_REF)


def _base_resolutions() -> dict[str, str] | None:
    """Upstream's own resolutions block at our upstream base.

    This is the baseline the fork's block must equal once our layer is stripped.
    Returns None when upstream is unavailable, so callers can decline to act
    rather than rewrite the block from a baseline they could not read.
    """
    base = _upstream_base()
    if not base:
        return None
    raw = _git("show", f"{base}:package.json")
    if not raw:
        return None
    try:
        return json.loads(raw).get("resolutions", {})
    except json.JSONDecodeError:
        return None


def _current_resolutions() -> dict[str, str]:
    """The block as it stands in the working tree."""
    try:
        return json.loads(MANIFEST.read_text(encoding="utf-8")).get("resolutions", {})
    except (OSError, json.JSONDecodeError):
        return {}


def _expected(base: dict[str, str], entries: list[dict]) -> tuple[dict[str, str], list[dict]]:
    """Upstream's block with our register layered over it, upstream order first.

    Order matters as much as content: a reordered block conflicts wholesale on
    the next merge, so upstream's keys keep their positions and ours append.

    A register entry is applied ONLY where it raises the floor. Upstream pins the
    same packages we would, and a pin left in the register after upstream passed
    it does not merely go stale - `^2.0.2` against an upstream that now ships
    2.1.2 drags the whole tree BACKWARDS onto the vulnerable line. Taking the
    higher of the two makes a forgotten entry inert instead of harmful, and
    --check still nags until someone deletes it.

    Returns (block, superseded) where superseded are the entries upstream has
    taken over.
    """
    merged = dict(base)
    superseded: list[dict] = []
    for entry in entries:
        package = entry["package"]
        ours = _minimum_of(entry["range"])
        theirs = _minimum_of(base[package]) if package in base else ()
        if theirs >= ours and package in base:
            superseded.append(entry)
            continue
        merged[package] = entry["range"]
    return merged, superseded


def _write_resolutions(block: dict[str, str]) -> bool:
    """Replace ONLY the resolutions span in package.json, byte-preserving the rest.

    Rewriting the file through json.dumps would reformat every line of a
    catalogued upstream file, which is the single worst thing to do to a rerere
    conflict surface. Returns False when the file changed a way this cannot
    safely edit.
    """
    text = MANIFEST.read_text(encoding="utf-8")
    match = re.search(r'^(?P<indent>[ \t]*)"resolutions"\s*:\s*\{', text, re.MULTILINE)

    if match is None:
        if not block:
            return True
        print("ERROR: package.json has no resolutions block to write into.", file=sys.stderr)
        return False

    # Brace-count to the matching close, skipping string literals - a resolution
    # value is free text and a brace inside one would otherwise silently
    # miscount and corrupt the manifest.
    depth = 0
    end = -1
    in_string = False
    escaped = False
    for index in range(match.end() - 1, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    if end == -1:
        print("ERROR: package.json resolutions block is unterminated.", file=sys.stderr)
        return False

    indent = match.group("indent")
    inner = indent + "  "
    if block:
        lines = ",\n".join(f'{inner}{json.dumps(k)}: {json.dumps(v)}' for k, v in block.items())
        rendered = f'{indent}"resolutions": {{\n{lines}\n{indent}}}'
    else:
        rendered = f'{indent}"resolutions": {{}}'

    updated = text[: match.start()] + rendered + text[end:]
    if updated != text:
        MANIFEST.write_text(updated, encoding="utf-8", newline="\n")
    return True


def _redundant(entries: list[dict], resolved: dict[str, set[str]]) -> tuple[list[dict], list[str]]:
    """Split the register into entries still doing work and those that are not.

    Returns (kept, notes) where notes are the per-entry lines to print. Shared by
    --check (which nags) and --apply (which acts on the same verdict), so the two
    can never disagree about what "redundant" means.
    """
    kept: list[dict] = []
    notes: list[str] = []

    for entry in entries:
        package = entry["package"]
        floor = _minimum_of(entry["range"])
        present = resolved.get(package, set())

        if not present:
            notes.append(f"  [gone]      {package} - not in the tree at all; the pin does nothing")
            continue

        below = {v for v in present if _parse_version(v) < floor}
        if below:
            kept.append(entry)
            notes.append(
                f"  [holding]   {package} {entry['range']} - still needed "
                f"(resolves to {', '.join(sorted(present))})"
            )
        else:
            notes.append(
                f"  [REDUNDANT] {package} {entry['range']} - upstream now ships "
                f"{', '.join(sorted(present))}"
            )
    return kept, notes


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

    print(f"Checking {len(entries)} fork security override(s) against yarn.lock\n")
    kept, notes = _redundant(entries, _resolved_versions())
    for note in notes:
        print(note)

    redundant = [e for e in entries if e not in kept]
    if not redundant:
        print("\nEvery override is still doing work.")
        return 0

    print(f"\n{len(redundant)} override(s) can be UNWOUND:")
    print("  1. delete each entry from security/overrides.yaml")
    print("  2. scripts/security-override.py --apply")
    print("  3. yarn install, and confirm the lockfile still resolves above the floor")
    print("\nLeaving a dead pin in place is how a fork drifts without anyone deciding to.")
    for entry in redundant:
        print(f"\n  {entry['package']}  ({entry.get('advisory', 'no advisory')})")
        print(f"    added:    {entry.get('added', 'unknown')}")
        print(f"    upstream: {entry.get('upstream', 'not raised')}")
    return 1


def _patches() -> list[Path]:
    """The security patch series, in filename order.

    Order is the apply order and reverses for unapply, so the NNNN- prefix is
    load-bearing rather than decorative.
    """
    if not PATCHES.is_dir():
        return []
    return sorted(PATCHES.glob("*.patch"))


def _patch_state(patch: Path) -> str:
    """One of 'applied', 'unapplied', 'stale'.

    'stale' is the interesting one: neither direction applies, so upstream has
    moved the code under the patch. That is a SIGNAL - either upstream fixed it
    their own way (delete the patch) or the fix needs re-deriving onto the new
    shape - and it is what scripts/security-triage.py is asked to judge.
    """
    if _git_ok("apply", "--check", "-R", str(patch)):
        return "applied"
    if _git_ok("apply", "--check", str(patch)):
        return "unapplied"
    return "stale"


def _git_ok(*args: str) -> bool:
    """True when git exits 0. Separate from _git, which discards the status."""
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        )
    except OSError:
        return False
    return result.returncode == 0


def _run_patches(reverse: bool) -> tuple[list[Path], list[Path]]:
    """Apply (or reverse) the series, returning (moved, stuck).

    Already being in the target state is success, not an error: unapply must be
    safe to run twice, because the sync workflow may retry.
    """
    series = _patches()
    if reverse:
        series = list(reversed(series))
    want = "unapplied" if reverse else "applied"

    moved: list[Path] = []
    stuck: list[Path] = []
    for patch in series:
        state = _patch_state(patch)
        if state == want:
            continue
        if state == "stale":
            stuck.append(patch)
            continue
        args = ["apply", "-R", str(patch)] if reverse else ["apply", str(patch)]
        if _git_ok(*args):
            moved.append(patch)
        else:
            stuck.append(patch)
    return moved, stuck


def _verify() -> int:
    """Assert both halves of the temporary layer match their declarations.

    THE INVARIANT. Anything else in the resolutions block is an undeclared
    divergence in the file upstream churns most - a pin somebody added by hand,
    or one they deleted from the register but not from the manifest. Both are
    silent until a sync.
    """
    base = _base_resolutions()
    if base is None:
        print(
            "upstream ref unavailable - run: git fetch upstream\n"
            "Declining to verify rather than passing a check that ran on nothing.",
            file=sys.stderr,
        )
        return 1

    entries = _load_register()
    expected, superseded = _expected(base, entries)
    actual = _current_resolutions()
    failed = False

    if actual == expected:
        held = f" (+{len(entries) - len(superseded)} fork pin(s))" if entries else ""
        print(f"resolutions match upstream's base block{held} - {len(expected)} entries.")
    else:
        failed = True
        print("RESOLUTIONS DO NOT MATCH THE REGISTER\n", file=sys.stderr)
        for package in sorted(set(expected) | set(actual)):
            want = expected.get(package)
            have = actual.get(package)
            if want == have:
                continue
            if want is None:
                print(f"  unexpected  {package}: {have} - present, declared nowhere", file=sys.stderr)
            elif have is None:
                print(f"  missing     {package}: {want} - declared but not applied", file=sys.stderr)
            else:
                print(f"  wrong       {package}: have {have}, want {want}", file=sys.stderr)
        print(
            "\nThe register is the source; the block is generated from it:\n"
            "  scripts/security-override.py --apply && yarn install",
            file=sys.stderr,
        )

    series = _patches()
    if series:
        not_applied = [p for p in series if _patch_state(p) != "applied"]
        if not_applied:
            failed = True
            print(f"\n{len(not_applied)} security patch(es) are NOT applied:", file=sys.stderr)
            for patch in not_applied:
                print(f"  {_patch_state(patch):<10} {patch.name}", file=sys.stderr)
        else:
            print(f"all {len(series)} security patch(es) applied.")

    return 1 if failed else 0


def _unapply() -> int:
    """Strip the temporary layer, leaving the tree as upstream's at the base.

    Run this BEFORE merging upstream. With no delta in the resolutions block and
    no security patch in the tree, git takes upstream's version of both whole and
    there is nothing to conflict on - which is the entire reason this layer is
    generated rather than committed.
    """
    base = _base_resolutions()
    if base is None:
        print(
            "upstream ref unavailable - run: git fetch upstream\n"
            "Refusing to rewrite the block from a baseline that could not be read.",
            file=sys.stderr,
        )
        return 1

    reverted, stuck = _run_patches(reverse=True)
    for patch in reverted:
        print(f"  reverted  {patch.name}")
    for patch in stuck:
        print(f"  STUCK     {patch.name} - will not reverse; the tree has moved", file=sys.stderr)

    entries = _load_register()
    if not _write_resolutions(base):
        return 1

    if entries:
        print(f"Stripped {len(entries)} fork pin(s); resolutions is upstream's block:")
        for entry in entries:
            print(f"  removed   {entry['package']} {entry['range']}")
    else:
        print("No fork pins registered - resolutions was already upstream's block.")

    print("\nMerge upstream now, then: scripts/security-override.py --apply")
    return 1 if stuck else 0


def _apply() -> int:
    """Rebuild the temporary layer on top of whatever upstream now is.

    Run this AFTER merging upstream. A register entry is applied only where it
    raises the floor above upstream's own pin, and a patch that no longer applies
    is REPORTED rather than forced - both are the cycle asking "has upstream
    taken this off our hands yet?", which is the whole point of the exercise.
    """
    base = _base_resolutions()
    if base is None:
        print(
            "upstream ref unavailable - run: git fetch upstream\n"
            "Refusing to rewrite the block from a baseline that could not be read.",
            file=sys.stderr,
        )
        return 1

    entries = _load_register()
    problems: list[str] = []
    for index, entry in enumerate(entries):
        problems.extend(_validate(entry, index))
    if problems:
        print("Register is malformed:\n", file=sys.stderr)
        for problem in problems:
            print(f"  ERROR: {problem}", file=sys.stderr)
        return 1

    block, superseded = _expected(base, entries)
    if not _write_resolutions(block):
        return 1

    applied, stuck = _run_patches(reverse=False)
    for patch in applied:
        print(f"  applied   {patch.name}")

    if superseded:
        print(f"\n{len(superseded)} pin(s) SUPERSEDED - upstream now pins them at least as high:")
        for entry in superseded:
            print(
                f"  {entry['package']} ours {entry['range']} <= theirs "
                f"{base[entry['package']]}  ({entry.get('advisory', 'no advisory')})"
            )
        print("Left inert rather than applied. Delete them from the register.")

    if stuck:
        print(f"\n{len(stuck)} patch(es) NO LONGER APPLY:", file=sys.stderr)
        for patch in stuck:
            print(f"  {patch.name}", file=sys.stderr)
        print(
            "\nThis is the signal, not a failure. Either upstream fixed it their\n"
            "own way (delete the patch) or the code moved and the fix needs\n"
            "re-deriving. To get a drafted verdict on which:\n"
            "  scripts/security-triage.py --patches",
            file=sys.stderr,
        )

    held = len(entries) - len(superseded)
    print(f"\nApplied {held} fork pin(s) and {len(_patches()) - len(stuck)} patch(es).")
    print("Now: yarn install")
    return 1 if stuck else 0


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
    group.add_argument(
        "--verify",
        action="store_true",
        help="Fail unless the tree matches the register + patch series exactly.",
    )
    group.add_argument(
        "--unapply",
        action="store_true",
        help="Strip the temporary security layer. Run BEFORE merging upstream.",
    )
    group.add_argument(
        "--apply",
        action="store_true",
        help="Rebuild the temporary security layer. Run AFTER merging upstream.",
    )
    args = parser.parse_args()

    if args.check:
        return _check()
    if args.verify:
        return _verify()
    if args.unapply:
        return _unapply()
    if args.apply:
        return _apply()
    return _list()


if __name__ == "__main__":
    sys.exit(main())
