#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/__tests__/test_resolve_fork_deleted.py
#  Purpose:      Prove the sync keeps fork-deleted files deleted, and nothing else
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Tests for scripts/resolve-fork-deleted.py.

The script is a statement about git's index after a conflicted merge, so the
test makes a real one: a base commit, a fork branch that deletes and edits, an
upstream branch that edits the same files, then `git merge`. Run::

    python3 -m unittest discover -s scripts/__tests__ -v
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = "resolve-fork-deleted.py"

# path -> (base, fork, upstream). None means the side deleted the file.
FILES: dict[str, tuple[str, str | None, str | None]] = {
    # Fork deleted, upstream edited, listed by exact path.
    "listed/modify-delete.yml": ("a\n", None, "a upstream\n"),
    # Fork deleted, upstream edited, listed by glob.
    "globbed/modify-delete.yml": ("a\n", None, "a upstream\n"),
    # Fork deleted, upstream edited, NOT listed.
    "unlisted/modify-delete.yml": ("a\n", None, "a upstream\n"),
    # Both edited the same line, NOT listed.
    "unlisted/text.txt": ("a\n", "a fork\n", "a upstream\n"),
    # Both edited the same line, but the path IS listed.
    "listed/text.yml": ("a\n", "a fork\n", "a upstream\n"),
    # We edited, upstream deleted, and the path is listed.
    "listed/upstream-deleted.yml": ("a\n", "a fork\n", None),
}

FORK_DELETED = """\
# comment
listed/modify-delete.yml
listed/text.yml
listed/upstream-deleted.yml

globbed/*.yml
"""


def git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=check,
    )


def write_side(repo: Path, index: int) -> None:
    """Apply one column of FILES (1 = fork, 2 = upstream) to the work tree."""
    for path, versions in FILES.items():
        target = repo / path
        content = versions[index]
        if content is None:
            git(repo, "rm", "-q", "--", path)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")


class ResolveForkDeletedTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = Path(tempfile.mkdtemp(prefix="fork-deleted-"))
        self.addCleanup(shutil.rmtree, self.repo, ignore_errors=True)

        (self.repo / "scripts").mkdir()
        shutil.copy(SOURCE_ROOT / SCRIPT, self.repo / "scripts" / SCRIPT)

        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.email", "test@dfe.hyperi.io")
        git(self.repo, "config", "user.name", "test")
        git(self.repo, "config", "rerere.enabled", "false")

        for path, versions in FILES.items():
            (self.repo / path).parent.mkdir(parents=True, exist_ok=True)
            (self.repo / path).write_text(versions[0], encoding="utf-8")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", "base")

        git(self.repo, "checkout", "-q", "-b", "upstream")
        write_side(self.repo, 2)
        git(self.repo, "commit", "-qam", "upstream edits")

        git(self.repo, "checkout", "-q", "main")
        write_side(self.repo, 1)
        (self.repo / ".fork-deleted").write_text(FORK_DELETED, encoding="utf-8")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", "fork")

        merged = git(self.repo, "merge", "--no-edit", "upstream", check=False)
        self.assertNotEqual(merged.returncode, 0, "the fixture must conflict")

    def unmerged(self) -> set[str]:
        out = git(self.repo, "diff", "--name-only", "--diff-filter=U").stdout
        return set(out.split())

    def run_script(self) -> subprocess.CompletedProcess:
        return subprocess.run(
            [str(self.repo / "scripts" / SCRIPT)],
            cwd=self.repo,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    def test_fixture_has_every_conflict_shape(self) -> None:
        self.assertEqual(self.unmerged(), set(FILES))

    def test_resolves_only_listed_modify_delete(self) -> None:
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)

        resolved = {
            "listed/modify-delete.yml",
            "globbed/modify-delete.yml",
        }
        self.assertEqual(self.unmerged(), set(FILES) - resolved)
        for path in resolved:
            self.assertIn(path, result.stdout)
            self.assertFalse((self.repo / path).exists(), path)
        for path in set(FILES) - resolved:
            self.assertNotIn(path, result.stdout)

    def test_leaves_the_text_conflict_markers_alone(self) -> None:
        self.run_script()
        for path in ("listed/text.yml", "unlisted/text.txt"):
            text = (self.repo / path).read_text(encoding="utf-8")
            self.assertIn("<<<<<<<", text, path)

    def test_second_run_finds_nothing(self) -> None:
        self.run_script()
        again = self.run_script()
        self.assertEqual(again.returncode, 0)
        self.assertEqual(again.stdout, "")


if __name__ == "__main__":
    unittest.main()
