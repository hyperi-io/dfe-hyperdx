#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/__tests__/test_lint_ours.py
#  Purpose:      Prove dfe-lint-ours.mjs only ever touches the fork it lives in
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Tests for scripts/dfe-lint-ours.mjs.

The script adds an ``upstream`` remote and fetches into whichever repository its
git calls run in. Run from another checkout, it wrote that remote and upstream's
history into the other repo, so every git call must be anchored to the fork.

Real git repos, and upstream's public URL rewritten to a local one, so nothing
here reaches the network.

Run::

    python3 -m unittest discover -s scripts/__tests__ -v
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "dfe-lint-ours.mjs"
UPSTREAM_URL = "https://github.com/hyperdxio/hyperdx.git"


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


def commit_all(repo: Path, message: str) -> None:
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", message)


class RunFromAnotherCheckoutTest(unittest.TestCase):
    """The caller's cwd is a different repo, as dfe-engine was when this broke."""

    def setUp(self) -> None:
        if shutil.which("node") is None:
            self.fail("node is not on PATH, so the lint script cannot be tested")
        root = Path(tempfile.mkdtemp(prefix="lint-ours-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)

        upstream = root / "upstream"
        upstream.mkdir()
        git(upstream, "init", "-q", "-b", "main")
        git(upstream, "config", "user.email", "test@dfe.hyperi.io")
        git(upstream, "config", "user.name", "test")
        (upstream / "README.md").write_text("upstream\n", encoding="utf-8")
        commit_all(upstream, "upstream")

        # A fork with no upstream remote yet, so the script has to add one.
        self.fork = root / "fork"
        git(root, "clone", "-q", str(upstream), str(self.fork))
        git(self.fork, "config", "user.email", "test@dfe.hyperi.io")
        git(self.fork, "config", "user.name", "test")
        (self.fork / "scripts").mkdir()
        shutil.copy(SCRIPT, self.fork / "scripts" / "dfe-lint-ours.mjs")
        ours = self.fork / "packages" / "demo" / "src" / "dfe"
        ours.mkdir(parents=True)
        (ours / "thing.ts").write_text("export const thing = 1;\n", encoding="utf-8")
        commit_all(self.fork, "fork")

        self.caller = root / "caller"
        self.caller.mkdir()
        git(self.caller, "init", "-q", "-b", "main")
        git(self.caller, "config", "user.email", "test@dfe.hyperi.io")
        git(self.caller, "config", "user.name", "test")
        (self.caller / "app.py").write_text("print('caller')\n", encoding="utf-8")
        commit_all(self.caller, "caller")

        env = dict(os.environ)
        env.update(
            {
                "GIT_CONFIG_COUNT": "1",
                "GIT_CONFIG_KEY_0": f"url.{upstream}.insteadOf",
                "GIT_CONFIG_VALUE_0": UPSTREAM_URL,
            }
        )
        self.result = subprocess.run(
            ["node", str(self.fork / "scripts" / "dfe-lint-ours.mjs"), "eslint"],
            cwd=self.caller,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    def test_the_callers_repo_gets_no_remote_and_no_refs(self) -> None:
        self.assertEqual(git(self.caller, "remote").stdout.strip(), "")
        self.assertEqual(git(self.caller, "for-each-ref", "refs/remotes").stdout.strip(), "")

    def test_the_fork_gets_the_remote_and_its_changes_are_found(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        self.assertIn("upstream", git(self.fork, "remote").stdout.split())
        # Only a file list resolved against the fork reaches the per-package step.
        self.assertIn("no changed files under an eslint-configured package", self.result.stdout)


if __name__ == "__main__":
    unittest.main()
