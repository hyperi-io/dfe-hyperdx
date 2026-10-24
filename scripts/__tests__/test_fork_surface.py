#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/__tests__/test_fork_surface.py
#  Purpose:      Prove the conflict-surface guard admits security patches only
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Tests for .githooks/fork-surface-check.py and the security patch series.

A security patch is stripped before every upstream merge, so the upstream file
it covers is not conflict surface and needs no `.fork-surface` entry. Anything
else in that file is. The guard runs as a subprocess against a throwaway repo,
because both halves of that are statements about git trees.

Run::

    python3 -m unittest discover -s scripts/__tests__ -v
"""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parents[2] / ".githooks" / "fork-surface-check.py"

UPSTREAM = "const limit = '32mb';\nconst other = 1;\n"
PATCHED = "const limit = '32mb', inflate = false;\nconst other = 1;\n"
PATCH = (
    "# advisory: GHSA-test\n"
    "diff --git a/server.js b/server.js\n"
    "--- a/server.js\n"
    "+++ b/server.js\n"
    "@@ -1,2 +1,2 @@\n"
    "-const limit = '32mb';\n"
    "+const limit = '32mb', inflate = false;\n"
    " const other = 1;\n"
)
PATCH_PATH = "security/patches/0001-no-inflate.patch"


def git(repo: Path, *args: str) -> str:
    """Run git in *repo*, raising with stderr attached when it fails."""
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    ).stdout.strip()


class SecurityPatchSurfaceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = Path(tempfile.mkdtemp(prefix="fork-surface-"))
        self.addCleanup(shutil.rmtree, self.repo, ignore_errors=True)
        (self.repo / ".githooks").mkdir()
        shutil.copy(HOOK, self.repo / ".githooks" / HOOK.name)

        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.email", "test@dfe.hyperi.io")
        git(self.repo, "config", "user.name", "test")
        self.write({"server.js": UPSTREAM})
        git(self.repo, "add", "server.js")
        git(self.repo, "commit", "-qm", "upstream")
        upstream = git(self.repo, "rev-parse", "HEAD")
        git(self.repo, "update-ref", "refs/remotes/upstream/main", upstream)

        # Our own file on top, so the range under test starts after the fork.
        self.write({"docs/ours.md": "ours\n"})
        git(self.repo, "add", "docs/ours.md")
        git(self.repo, "commit", "-qm", "fork")
        self.base = git(self.repo, "rev-parse", "HEAD")

    def write(self, files: dict[str, str]) -> None:
        for name, body in files.items():
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8", newline="\n")

    def commit(self, files: dict[str, str]) -> None:
        self.write(files)
        git(self.repo, "add", *files)
        git(self.repo, "commit", "-qm", "change")

    def guard(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(self.repo / ".githooks" / HOOK.name), *args],
            cwd=self.repo,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    def test_a_patch_over_an_uncatalogued_upstream_file_passes(self) -> None:
        self.commit({PATCH_PATH: PATCH, "server.js": PATCHED})
        result = self.guard("--base", self.base)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("BLOCKED", result.stderr)

    def test_a_direct_edit_to_that_file_is_still_blocked(self) -> None:
        self.commit({"server.js": PATCHED})
        result = self.guard("--base", self.base)

        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("BLOCKED", result.stderr)
        self.assertIn("server.js", result.stderr)

    def test_an_edit_beyond_the_patch_is_blocked(self) -> None:
        """The patch is stripped before a sync, so the extra line would conflict."""
        self.commit({PATCH_PATH: PATCH, "server.js": PATCHED + "const extra = 2;\n"})
        result = self.guard("--base", self.base)

        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("server.js", result.stderr)

    def test_a_staged_patch_and_its_target_pass_the_pre_commit_run(self) -> None:
        self.write({PATCH_PATH: PATCH, "server.js": PATCHED})
        git(self.repo, "add", PATCH_PATH, "server.js")
        result = self.guard()

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_an_unstaged_patch_does_not_cover_a_staged_edit(self) -> None:
        """The commit being made is what lands, so the index decides."""
        self.write({PATCH_PATH: PATCH, "server.js": PATCHED})
        git(self.repo, "add", "server.js")
        result = self.guard()

        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("server.js", result.stderr)


if __name__ == "__main__":
    unittest.main()
