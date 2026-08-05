#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/attribute-findings.py
#  Purpose:      Split scanner findings into OURS and INHERITED-FROM-UPSTREAM
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
"""Partition SARIF findings by who actually wrote the line.

THE PROBLEM. A scanner run over this fork reports on the whole tree, and the
whole tree is overwhelmingly upstream's. On a real run: 117 semgrep findings, of
which 5 were ours. Gating on all 117 is unworkable, and muting all 117 throws
away the 5 that matter. Neither is the right answer - the findings just need
sorting.

THE ATTRIBUTION. A finding is OURS when its line is one WE added or changed
relative to the upstream merge base. That is computed straight from
`git diff -U0 <base>`, and it is the only method of the three obvious ones that
actually works here:

  - AUTHOR/blame is useless: every line in this repo blames to whoever ran the
    original import, so everything looks like ours.
  - COMMIT ANCESTRY ("is the blamed commit in upstream/main") is subtly wrong:
    the fork was SQUASH-imported, so any line untouched since the import blames
    to a commit that is not in upstream's history and gets misfiled as ours.
    Observed live on packages/app/src/theme/ThemeProvider.tsx:163.
  - LINE CONTENT vs the merge base is immune to both, and needs no catalogue -
    it works even for an upstream file nobody remembered to list.

THE ONE THING THAT BREAKS IT: reformatting an upstream file. That rewrites every
line into the diff, so the whole file reads as ours and the signal is gone. The
fork already bans bulk reformatting to protect `git rerere`; this is a second,
independent reason. See docs/fork/design.md.

SARIF in, so the same tool serves semgrep and CodeQL (and anything else that
speaks it) rather than parsing one scanner's console output.

Usage::

    semgrep --config auto --sarif -o results.sarif
    scripts/attribute-findings.py results.sarif                 # gate on ours
    scripts/attribute-findings.py results.sarif --summary out.md

Exit codes: 0 when nothing is ours; 1 when at least one finding is ours.
Inherited findings NEVER affect the exit code - that is the whole point.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
UPSTREAM_REF = "upstream/main"
ACCEPTED_FILE = REPO_ROOT / "security" / "accepted.yaml"

_HUNK = re.compile(r"^@@ -\S+ \+(\d+)(?:,(\d+))? @@")
_YAML_KEY = re.compile(r"^(?P<key>[a-z_]+):(?P<value>.*)$")


def load_accepted() -> list[dict]:
    """Findings in OUR code we have looked at and chosen not to act on.

    Kept out of the code as an auditable list rather than scattered
    `# nosemgrep` comments: several of the paths are upstream files we edit,
    and a suppression comment there is one more line of conflict surface for
    something that is not even a code change.
    """
    if not ACCEPTED_FILE.is_file():
        return []

    entries: list[dict] = []
    current: dict | None = None
    key: str | None = None
    folded = False

    for raw in ACCEPTED_FILE.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        stripped = raw.strip()
        if stripped in ("accepted:", "accepted: []"):
            continue

        if stripped.startswith("- "):
            if current:
                entries.append(current)
            current = {}
            key, folded = None, False
            stripped = stripped[2:]
        if current is None:
            continue

        # A KEY is a bare identifier at the start of the line. Testing for a
        # colon anywhere is wrong: prose reasons quote settings like
        # "`secrets: inherit`", and treating that as a new key silently
        # truncated the reason mid-sentence.
        #
        # ONCE INSIDE A FOLDED BLOCK, EVERYTHING IS PROSE. Without that rule a
        # reason ending in a line like "path: some/other/file.ts" rebound the
        # entry's path, so an acceptance declared against a harmless file
        # suppressed a real finding somewhere else entirely - and reading the
        # YAML as YAML would not show it, because a real parser keeps the whole
        # block as text.
        key_match = None if folded else _YAML_KEY.match(stripped)
        if key_match:
            key = key_match.group("key")
            value = key_match.group("value").strip()
            folded = value in (">-", ">", "|", "|-")
            current[key] = "" if folded else value.strip("\"'")
        elif key:
            # continuation of a folded block
            current[key] = f"{current.get(key, '')} {stripped}".strip()

    if current:
        entries.append(current)
    return entries


def is_accepted(finding: dict, accepted: list[dict]) -> dict | None:
    for entry in accepted:
        if entry.get("rule") != finding["rule"]:
            continue
        if entry.get("path") != finding["path"]:
            continue
        line = entry.get("line")
        if line and str(finding["line"]) != str(line):
            continue
        return entry
    return None


def _git(*args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    return result.stdout if result.returncode == 0 else ""


def merge_base() -> str:
    """The upstream commit this fork last merged from."""
    return _git("merge-base", "HEAD", UPSTREAM_REF).strip()


def is_additive(path: str) -> bool:
    """Under a `dfe/` directory - our own code, cannot be upstream's."""
    return "dfe" in Path(path).parts


class Attributor:
    """Decides ours/upstream per (file, line), caching the per-file diff."""

    def __init__(self, base: str) -> None:
        self._base = base
        self._changed: dict[str, set[int]] = {}

    def _our_lines(self, path: str) -> set[int]:
        """Lines we added or changed, PLUS the seam either side of a deletion.

        A pure deletion has an added-count of zero (`@@ -2 +1,0 @@`), so range()
        is empty and nothing reads as ours. Deleting a line is one of the more
        plausible ways a fork introduces a hole - drop an authorization guard and
        the finding lands on the surviving code, on a line we never touched.

        So a deletion claims the lines it sits BETWEEN. That over-claims by at
        most two lines per deletion, which is the right way to be wrong here: it
        can only move a finding into the bucket that gates.
        """
        if path in self._changed:
            return self._changed[path]
        lines: set[int] = set()
        for line in _git("diff", "-U0", self._base, "--", path).splitlines():
            match = _HUNK.match(line)
            if not match:
                continue
            start = int(match.group(1))
            count = int(match.group(2) or 1)
            if count == 0:
                # Deletion: `+start,0` means the removed text sat between
                # `start` and `start + 1` in the new file.
                lines.update({start, start + 1})
                continue
            lines.update(range(start, start + count))
        self._changed[path] = lines
        return lines

    def _exists_upstream(self, path: str) -> bool:
        result = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "cat-file", "-e", f"{self._base}:{path}"],
            capture_output=True,
            check=False,
        )
        return result.returncode == 0

    def is_ours(self, path: str, line: int | None) -> bool:
        if is_additive(path) or not self._exists_upstream(path):
            return True
        if line is None:
            # A file-level finding on an upstream file we edit: attribute to
            # upstream. Claiming it is ours on the strength of an unrelated edit
            # elsewhere in the file would put noise in the bucket that gates.
            return False
        return line in self._our_lines(path)

    def finding_is_ours(self, finding: dict) -> bool:
        """Ours if ANY site the finding touches is ours.

        A dataflow result spans source to sink; the vulnerability is ours the
        moment we wrote any step of it, wherever the scanner chose to report.
        """
        sites = finding.get("sites") or [(finding["path"], finding.get("line"))]
        return any(self.is_ours(path, line) for path, line in sites)


def _physical(location: dict) -> tuple[str | None, int | None]:
    """(path, line) from a SARIF location, or (None, None)."""
    phys = (location or {}).get("physicalLocation", {})
    uri = phys.get("artifactLocation", {}).get("uri")
    if not uri:
        return None, None
    return uri.removeprefix("file://").lstrip("/"), phys.get("region", {}).get("startLine")


def _all_sites(result: dict) -> list[tuple[str, int | None]]:
    """EVERY place a result touches - primary, related, and dataflow steps.

    Reading only `locations[0]` loses the finding. Semgrep taint-mode and CodeQL
    both report a dataflow result at the SINK, so a vulnerability introduced on
    the SOURCE line is reported on a line we never touched, and attributing by
    the primary location alone hands it to the inherited bucket - the gate goes
    green on a hole we just added.

    A finding is ours if ANY site it touches is ours. That errs towards gating,
    which is the correct direction for the bucket that fails the build.
    """
    sites: list[tuple[str, int | None]] = []

    def add(location: dict) -> None:
        path, line = _physical(location)
        if path:
            sites.append((path, line))

    for location in result.get("locations") or []:
        add(location)
    for location in result.get("relatedLocations") or []:
        add(location)
    for flow in result.get("codeFlows") or []:
        for thread in flow.get("threadFlows") or []:
            for step in thread.get("locations") or []:
                add(step.get("location") or {})
    return sites


def load_findings(sarif_path: Path) -> list[dict]:
    """Flatten SARIF results to {path, line, rule, level, message, sites}."""
    data = json.loads(sarif_path.read_text(encoding="utf-8"))
    findings: list[dict] = []

    for run in data.get("runs", []):
        tool = run.get("tool", {}).get("driver", {}).get("name", "scanner")
        for result in run.get("results", []):
            sites = _all_sites(result)
            if not sites:
                continue
            path, line = sites[0]
            findings.append(
                {
                    "tool": tool,
                    "path": path,
                    "line": line,
                    # Reported at the primary location, but ATTRIBUTED across
                    # all of them.
                    "sites": sites,
                    "rule": result.get("ruleId", "?"),
                    "level": result.get("level", "warning"),
                    "message": (result.get("message", {}).get("text") or "").strip(),
                }
            )
    return findings


def _render(findings: list[dict]) -> list[str]:
    out: list[str] = []
    for f in sorted(findings, key=lambda x: (x["path"], x["line"] or 0)):
        where = f"{f['path']}:{f['line']}" if f["line"] else f["path"]
        out.append(f"  [{f['level']}] {where}")
        out.append(f"      {f['rule']}")
        if f["message"]:
            out.append(f"      {f['message'][:140]}")
    return out


def _by_rule(findings: list[dict]) -> list[str]:
    counts: dict[str, int] = defaultdict(int)
    for f in findings:
        counts[f["rule"]] += 1
    return [
        f"  {count:4}  {rule}"
        for rule, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("sarif", type=Path, help="SARIF file from semgrep/CodeQL/...")
    parser.add_argument("--summary", type=Path, help="Write a markdown digest here.")
    parser.add_argument(
        "--json",
        type=Path,
        help="Write the attributed buckets here, for other tools to consume.",
    )
    parser.add_argument(
        "--base",
        default="",
        help="Upstream baseline (default: merge-base with upstream/main).",
    )
    args = parser.parse_args()

    if not args.sarif.is_file():
        print(f"ERROR: no such SARIF file: {args.sarif}", file=sys.stderr)
        return 1

    base = args.base or merge_base()
    if not base:
        # Failing closed here would gate the build on all 117 inherited
        # findings, which is exactly the unworkable state this tool exists to
        # avoid. Say so loudly and let the run continue.
        print(
            "ERROR: no upstream merge base (run: git fetch upstream).\n"
            "Cannot attribute findings; not gating.",
            file=sys.stderr,
        )
        return 0

    findings = load_findings(args.sarif)
    attributor = Attributor(base)
    accepted_rules = load_accepted()

    ours: list[dict] = []
    accepted: list[dict] = []
    inherited: list[dict] = []

    for finding in findings:
        if not attributor.finding_is_ours(finding):
            inherited.append(finding)
        elif (entry := is_accepted(finding, accepted_rules)) is not None:
            finding["reason"] = entry.get("reason", "")
            accepted.append(finding)
        else:
            ours.append(finding)

    print(f"Scanner findings: {len(findings)}  (baseline {base[:8]})")
    print(f"  OURS      : {len(ours)}   (gate)")
    print(f"  ACCEPTED  : {len(accepted)}   (ours, reviewed, suppressed)")
    print(f"  INHERITED : {len(inherited)}   (upstream, report only)\n")

    if ours:
        print("OURS - these gate the build:\n")
        print("\n".join(_render(ours)))
    else:
        print("Nothing unreviewed in our own code.")

    # Printed every run on purpose. A suppression that has quietly become wrong
    # should be visible to whoever next reads this, not buried in a config file.
    if accepted:
        print("\nACCEPTED - ours, reviewed, not gating:\n")
        for f in sorted(accepted, key=lambda x: (x["path"], x["line"] or 0)):
            where = f"{f['path']}:{f['line']}" if f["line"] else f["path"]
            print(f"  {where}")
            print(f"      {f['rule']}")
            print(f"      reason: {f['reason'][:160]}")

    # Attribution is expensive to compute and useful to more than this script -
    # security-triage.py sorts its drafting by it - so emit it rather than
    # letting a second tool re-derive "is this line ours" and drift from here.
    if args.json:
        args.json.write_text(
            json.dumps(
                {
                    "baseline": base,
                    "ours": ours,
                    "accepted": accepted,
                    "inherited": inherited,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
            newline="\n",
        )

    if args.summary:
        lines = [
            "## Scanner findings, attributed",
            "",
            f"Baseline `{base[:8]}` - a finding is OURS when its line is one we",
            "added or changed relative to upstream.",
            "",
            f"- **Ours: {len(ours)}** (gates)",
            f"- Accepted (ours, reviewed): {len(accepted)}",
            f"- Inherited from upstream: {len(inherited)} (report only)",
            "",
        ]
        if ours:
            lines += ["### Ours", "", "```", *_render(ours), "```", ""]
        if accepted:
            lines += [
                "### Accepted",
                "",
                "Ours, looked at, suppressed in `security/accepted.yaml`.",
                "",
                "```",
                *_render(accepted),
                "```",
                "",
            ]
        if inherited:
            lines += [
                "### Inherited - by rule",
                "",
                "Not actionable here: fixing upstream code diverges the fork. These",
                "move when we sync, or via an entry in `security/overrides.yaml`",
                "if one is severe AND reachable.",
                "",
                "```",
                *_by_rule(inherited),
                "```",
                "",
            ]
        args.summary.write_text("\n".join(lines), encoding="utf-8")

    return 1 if ours else 0


if __name__ == "__main__":
    sys.exit(main())
