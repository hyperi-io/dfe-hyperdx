#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/__tests__/test_attribution.py
#  Purpose:      Prove the gate cannot be walked past
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Tests for attribute-findings.py, the tool that decides what gates the build.

It had none, and an adversarial review found two ways a vulnerability WE
introduced was classified as upstream's and never gated. Both are pinned here:
a dataflow finding reported at an untouched sink, and a vulnerability introduced
by DELETING a line.

Real git repos and real SARIF, because every claim the tool makes is a claim
about a diff.

Run::

    python3 -m unittest discover -s scripts/__tests__ -v
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "attribute-findings.py"


def git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    )


class ForkRepo:
    """Upstream commit, then a fork commit on top - the shape of this repo."""

    def __init__(self, upstream_body: str) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="attribution-"))
        self.scripts = self.dir / "scripts"
        self.scripts.mkdir()
        shutil.copy(SOURCE, self.scripts / "attribute-findings.py")
        (self.dir / "security").mkdir()

        git(self.dir, "init", "-q", "-b", "main")
        git(self.dir, "config", "user.email", "test@dfe.hyperi.io")
        git(self.dir, "config", "user.name", "test")

        self.target = self.dir / "app.js"
        self.target.write_text(upstream_body, encoding="utf-8")
        git(self.dir, "add", "-A")
        git(self.dir, "commit", "-qm", "upstream")
        sha = git(self.dir, "rev-parse", "HEAD").stdout.strip()
        git(self.dir, "update-ref", "refs/remotes/upstream/main", sha)

    def fork_change(self, body: str) -> None:
        self.target.write_text(body, encoding="utf-8")
        git(self.dir, "add", "-A")
        git(self.dir, "commit", "-qm", "our change")

    def write_sarif(self, result: dict) -> Path:
        path = self.dir / "results.sarif"
        path.write_text(
            json.dumps(
                {
                    "runs": [
                        {"tool": {"driver": {"name": "semgrep"}}, "results": [result]}
                    ]
                }
            ),
            encoding="utf-8",
        )
        return path

    def accepted(self, body: str) -> None:
        (self.dir / "security" / "accepted.yaml").write_text(body, encoding="utf-8")

    def run(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [str(self.scripts / "attribute-findings.py"), *args],
            cwd=self.dir,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    def cleanup(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)


def at(path: str, line: int | None) -> dict:
    location = {"physicalLocation": {"artifactLocation": {"uri": path}}}
    if line is not None:
        location["physicalLocation"]["region"] = {"startLine": line}
    return location


class DataflowTest(unittest.TestCase):
    """A finding reported at the SINK must still be ours if we wrote the source.

    Semgrep taint-mode and CodeQL both report at the sink. Attributing on the
    primary location alone let a vulnerability we introduced pass as upstream's.
    """

    def setUp(self) -> None:
        self.repo = ForkRepo(
            'const q = "SELECT 1";\nconst safe = q;\ndb.query(safe);\n'
        )
        self.addCleanup(self.repo.cleanup)
        # We change line 2 only; the sink on line 3 is untouched.
        self.repo.fork_change(
            'const q = "SELECT 1";\nconst safe = q + req.query.id;\ndb.query(safe);\n'
        )

    def test_codeflow_source_on_our_line_gates(self) -> None:
        sarif = self.repo.write_sarif(
            {
                "ruleId": "js.sql-injection",
                "level": "error",
                "message": {"text": "SQL injection"},
                "locations": [at("app.js", 3)],
                "codeFlows": [
                    {"threadFlows": [{"locations": [{"location": at("app.js", 2)}]}]}
                ],
            }
        )
        result = self.repo.run(str(sarif))
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("OURS      : 1", result.stdout)

    def test_related_location_on_our_line_gates(self) -> None:
        sarif = self.repo.write_sarif(
            {
                "ruleId": "js.sql-injection",
                "level": "error",
                "message": {"text": "SQL injection"},
                "locations": [at("app.js", 3)],
                "relatedLocations": [at("app.js", 2)],
            }
        )
        self.assertEqual(self.repo.run(str(sarif)).returncode, 1)

    def test_a_finding_wholly_on_upstream_lines_still_does_not_gate(self) -> None:
        """The widening must not swallow the inherited bucket."""
        sarif = self.repo.write_sarif(
            {
                "ruleId": "js.some-rule",
                "level": "error",
                "message": {"text": "unrelated"},
                "locations": [at("app.js", 3)],
                "codeFlows": [
                    {"threadFlows": [{"locations": [{"location": at("app.js", 1)}]}]}
                ],
            }
        )
        result = self.repo.run(str(sarif))
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("INHERITED : 1", result.stdout)


class DeletionTest(unittest.TestCase):
    """Removing a guard is a vulnerability we introduced, on a line we deleted."""

    def setUp(self) -> None:
        self.repo = ForkRepo(
            'function h(req) {\n  if (!req.user) throw new Error("denied");\n  doPrivileged();\n}\n'
        )
        self.addCleanup(self.repo.cleanup)
        self.repo.fork_change("function h(req) {\n  doPrivileged();\n}\n")

    def test_a_finding_beside_our_deletion_gates(self) -> None:
        sarif = self.repo.write_sarif(
            {
                "ruleId": "js.missing-authz",
                "level": "error",
                "message": {"text": "privileged call with no authorization check"},
                "locations": [at("app.js", 2)],
            }
        )
        result = self.repo.run(str(sarif))
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("OURS      : 1", result.stdout)


class AcceptanceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = ForkRepo("const a = 1;\nconst b = 2;\n")
        self.addCleanup(self.repo.cleanup)
        self.repo.fork_change("const a = evil();\nconst b = 2;\n")

    def test_folded_prose_cannot_rebind_the_path(self) -> None:
        """A reason ending in `path:` must stay prose, not retarget the entry.

        Otherwise an acceptance declared against a harmless file silently
        suppresses a real finding somewhere else - and reading the YAML as YAML
        would not reveal it, because a real parser keeps the block as text.
        """
        self.repo.accepted(
            "accepted:\n"
            "  - rule: js.dangerous\n"
            "    path: some/harmless/file.ts\n"
            "    reason: >-\n"
            "      This is fine because reasons.\n"
            "      path: app.js\n"
        )
        sarif = self.repo.write_sarif(
            {
                "ruleId": "js.dangerous",
                "level": "error",
                "message": {"text": "dangerous call"},
                "locations": [at("app.js", 1)],
            }
        )
        result = self.repo.run(str(sarif))
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("OURS      : 1", result.stdout)

    def test_a_genuine_acceptance_still_suppresses(self) -> None:
        self.repo.accepted(
            "accepted:\n"
            "  - rule: js.dangerous\n"
            "    path: app.js\n"
            "    reason: >-\n"
            "      Test-only path, no runtime reachability.\n"
        )
        sarif = self.repo.write_sarif(
            {
                "ruleId": "js.dangerous",
                "level": "error",
                "message": {"text": "dangerous call"},
                "locations": [at("app.js", 1)],
            }
        )
        result = self.repo.run(str(sarif))
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("ACCEPTED  : 1", result.stdout)


class AdditiveTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = ForkRepo("const a = 1;\n")
        self.addCleanup(self.repo.cleanup)

    def test_a_finding_in_a_dfe_path_is_always_ours(self) -> None:
        sarif = self.repo.write_sarif(
            {
                "ruleId": "js.dangerous",
                "level": "error",
                "message": {"text": "dangerous"},
                "locations": [at("packages/api/src/dfe/thing.ts", 4)],
            }
        )
        self.assertEqual(self.repo.run(str(sarif)).returncode, 1)


if __name__ == "__main__":
    unittest.main()
