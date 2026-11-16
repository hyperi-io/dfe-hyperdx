#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/__tests__/test_lockfile_floor.py
#  Purpose:      Prove the lockfile floor check names what fell and ignores what did not
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Tests for lockfile-floor.py.

The comparison is pinned against small lockfiles written in yarn's own shape.
The command line runs the real script against a throwaway git repo, because the
base lockfile comes from `git show`.

Run::

    python3 -m unittest discover -s scripts/__tests__ -v
"""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "lockfile-floor.py"

_SPEC = importlib.util.spec_from_file_location("lockfile_floor", SOURCE)
assert _SPEC is not None and _SPEC.loader is not None
tool = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = tool
_SPEC.loader.exec_module(tool)

Entry = tuple[tuple[str, ...], str, str, str]


def lock(*entries: Entry) -> str:
    """A lockfile with one entry per (descriptors, name, version, protocol)."""
    out = ["__metadata:\n  version: 8\n  cacheKey: 10c0\n"]
    for descriptors, name, version, protocol in entries:
        header = ", ".join(descriptors)
        out.append(
            f'"{header}":\n  version: {version}\n'
            f'  resolution: "{name}@{protocol}{version}"\n  languageName: node\n'
        )
    return "\n".join(out)


def npm(descriptor: str, version: str) -> Entry:
    name = descriptor.split("@npm:")[0]
    return ((descriptor,), name, version, "npm:")


def fell(base: str, head: str) -> dict[str, list[str]]:
    return tool.below_floor(tool.parse_lockfile(base), tool.parse_lockfile(head))


class VersionOrderTest(unittest.TestCase):
    def test_semver_order(self) -> None:
        ascending = [
            "1.0.0-alpha",
            "1.0.0-alpha.1",
            "1.0.0-beta",
            "1.0.0-rc.2",
            "1.0.0",
            "1.0.1",
            "1.10.0",
            "2.0.0-next.5",
            "2.0.0-next.7",
            "2.0.0",
        ]
        keys = [tool.version_key(v) for v in ascending]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(len(set(keys)), len(keys))

    def test_not_semver(self) -> None:
        for value in ("", "latest", "1.0", "v1.2.3"):
            with self.subTest(value=value):
                self.assertIsNone(tool.version_key(value))


class ParseTest(unittest.TestCase):
    def test_keeps_every_descriptor_of_an_entry(self) -> None:
        text = lock(
            (("tar@npm:^6.0.0", "tar@npm:^6.2.1"), "tar", "6.2.1", "npm:"),
            npm("@babel/types@npm:^7.20.7", "7.29.11"),
        )
        self.assertEqual(
            tool.parse_lockfile(text),
            {
                "tar@npm:^6.0.0": ("tar", "6.2.1"),
                "tar@npm:^6.2.1": ("tar", "6.2.1"),
                "@babel/types@npm:^7.20.7": ("@babel/types", "7.29.11"),
            },
        )

    def test_skips_workspaces_and_patches(self) -> None:
        text = lock(
            (
                ("@hyperdx/api@workspace:packages/api",),
                "@hyperdx/api",
                "0.0.0",
                "workspace:",
            ),
            (("resolve@patch:resolve@npm%3A1.22.8",), "resolve", "1.22.8", "patch:"),
        )
        self.assertEqual(tool.parse_lockfile(text), {})


class BelowFloorTest(unittest.TestCase):
    def test_cases(self) -> None:
        cases = {
            "same": (
                lock(npm("tar@npm:^7.0.0", "7.5.22")),
                lock(npm("tar@npm:^7.0.0", "7.5.22")),
                [],
            ),
            "raised": (
                lock(npm("tar@npm:^7.0.0", "7.5.22")),
                lock(npm("tar@npm:^7.0.0", "7.6.0")),
                [],
            ),
            "descriptor fell": (
                lock(npm("tar@npm:^7.0.0", "7.5.22")),
                lock(npm("tar@npm:^7.0.0", "6.2.1")),
                ["tar"],
            ),
            "dropped dependency": (
                lock(npm("tar@npm:^7.0.0", "7.5.22")),
                lock(npm("other@npm:^1.0.0", "1.0.0")),
                [],
            ),
            "older copy resolves lower beside a current one": (
                lock(
                    npm("@babel/types@npm:^7.0.0", "7.29.11"),
                    npm("@babel/types@npm:^7.29.7", "7.29.11"),
                ),
                lock(
                    npm("@babel/types@npm:^7.0.0", "7.28.5"),
                    npm("@babel/types@npm:^7.29.7", "7.29.11"),
                ),
                ["@babel/types"],
            ),
            "range renamed and the line fell": (
                lock(npm("ip-address@npm:^10.1.0", "10.7.6")),
                lock(npm("ip-address@npm:^10.0.0", "10.1.0")),
                ["ip-address"],
            ),
            "range renamed and the line held": (
                lock(npm("ip-address@npm:^10.1.0", "10.7.6")),
                lock(npm("ip-address@npm:^10.0.0", "10.7.6")),
                [],
            ),
            "moved to a higher major": (
                lock(npm("ip-address@npm:^9.0.0", "9.0.5")),
                lock(npm("ip-address@npm:^10.0.0", "10.7.6")),
                [],
            ),
            "one of two lines fell": (
                lock(
                    npm("tar@npm:^6.0.0", "6.2.1"),
                    npm("tar@npm:^7.0.0", "7.5.22"),
                ),
                lock(
                    npm("tar@npm:^6.0.0", "6.2.1"),
                    npm("tar@npm:^7.0.0", "7.5.1"),
                ),
                ["tar"],
            ),
            "prerelease below its release": (
                lock(npm("resolve@npm:^2.0.0-next.5", "2.0.0-next.7")),
                lock(npm("resolve@npm:^2.0.0-next.5", "2.0.0-next.5")),
                ["resolve"],
            ),
        }
        for label, (base, head, expected) in cases.items():
            with self.subTest(label):
                self.assertEqual(sorted(fell(base, head)), expected)

    def test_evidence_names_the_descriptor(self) -> None:
        found = fell(
            lock(npm("axios@npm:^1.13.5", "1.20.0")),
            lock(npm("axios@npm:^1.13.5", "1.18.1")),
        )
        self.assertEqual(
            found, {"axios": ["axios@npm:^1.13.5 1.20.0 at base, now 1.18.1"]}
        )


class CommandLineTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="lockfile-floor-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        (self.dir / "scripts").mkdir()
        (self.dir / "security").mkdir()
        shutil.copy(SOURCE, self.dir / "scripts" / SOURCE.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "test@dfe.hyperi.io")
        self.git("config", "user.name", "test")
        self.write_lock(npm("tar@npm:^7.0.0", "7.5.22"))
        self.git("add", "-A")
        self.git("commit", "-qm", "base")
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")

    def git(self, *args: str) -> None:
        subprocess.run(
            ["git", *args], cwd=self.dir, check=True, capture_output=True, text=True
        )

    def write_lock(self, *entries: Entry) -> None:
        (self.dir / "yarn.lock").write_text(lock(*entries), encoding="utf-8")

    def run_tool(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(self.dir / "scripts" / SOURCE.name), *args],
            cwd=self.dir,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    def test_unchanged_lockfile_passes(self) -> None:
        result = self.run_tool()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_regression_fails_and_names_the_package(self) -> None:
        self.write_lock(npm("tar@npm:^7.0.0", "6.2.1"))
        result = self.run_tool()
        self.assertEqual(result.returncode, 1)
        self.assertIn("tar@npm:^7.0.0 7.5.22 at base, now 6.2.1", result.stdout)

    def test_names_lists_one_package_per_line(self) -> None:
        self.write_lock(npm("tar@npm:^7.0.0", "6.2.1"))
        result = self.run_tool("--names")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.split(), ["tar"])

    def test_branch_cut_before_main_moved_is_not_held_to_main(self) -> None:
        self.write_lock(npm("tar@npm:^7.0.0", "7.9.0"))
        self.git("commit", "-qam", "main moves on")
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")
        self.git("checkout", "-q", "-b", "older", "HEAD~1")
        result = self.run_tool()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_allowed_downgrade_passes_and_needs_a_reason(self) -> None:
        self.write_lock(npm("tar@npm:^7.0.0", "6.2.1"))
        allow = self.dir / "security" / "lockfile-floor-allow.txt"
        allow.write_text("tar upstream dropped 7.x on purpose\n", encoding="utf-8")
        self.assertEqual(self.run_tool().returncode, 0)
        allow.write_text("tar\n", encoding="utf-8")
        result = self.run_tool()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("has no reason", result.stderr)

    def test_unknown_base_is_an_error(self) -> None:
        result = self.run_tool("--base", "no-such-ref")
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
