#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/__tests__/test_fork_cycle.py
#  Purpose:      Prove the sync cycle's mechanical guarantees
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Tests for the upstream-pin / security-layer tooling.

These run the real scripts as subprocesses against real throwaway git repos,
because every guarantee they make is a statement about git: what the merge base
is, what upstream's manifest said there, whether a patch still applies. A test
with a stubbed git would prove nothing about any of that.

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

SOURCE_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ("security-override.py", "upstream-pin.py")

UPSTREAM_MANIFEST = {
    "name": "hyperdx",
    "version": "2.0.0",
    "scripts": {"build": "nx build"},
    "resolutions": {
        "express": "^4.20.0",
        "brace-expansion": "^2.0.2",
        "cookie": "^0.7.0",
    },
}


def git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    """Run git in *repo*, raising with stderr attached when it fails."""
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    )


class ForkFixture:
    """A throwaway repo shaped like the fork: upstream history plus our commits."""

    def __init__(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="fork-cycle-"))
        self.scripts = self.dir / "scripts"
        self.scripts.mkdir()
        for name in SCRIPTS:
            shutil.copy(SOURCE_ROOT / name, self.scripts / name)
        (self.dir / "security").mkdir()

        git(self.dir, "init", "-q", "-b", "main")
        git(self.dir, "config", "user.email", "test@dfe.hyperi.io")
        git(self.dir, "config", "user.name", "test")

        self.write_manifest(UPSTREAM_MANIFEST)
        (self.dir / "app.js").write_text("const greeting = 'hello';\n", encoding="utf-8")
        git(self.dir, "add", "-A")
        git(self.dir, "commit", "-qm", "upstream")
        self.upstream_sha = git(self.dir, "rev-parse", "HEAD").stdout.strip()
        git(self.dir, "update-ref", "refs/remotes/upstream/main", self.upstream_sha)

        # Our fork commit, on top - the merge base stays at the upstream commit.
        self.set_register([])
        git(self.dir, "add", "-A")
        git(self.dir, "commit", "-qm", "fork")

    def write_manifest(self, data: dict) -> None:
        (self.dir / "package.json").write_text(
            json.dumps(data, indent=2) + "\n", encoding="utf-8"
        )

    def manifest(self) -> dict:
        return json.loads((self.dir / "package.json").read_text(encoding="utf-8"))

    def set_register(self, entries: list[dict]) -> None:
        """Write security/overrides.yaml in the documented shape."""
        if not entries:
            body = "overrides: []\n"
        else:
            blocks = []
            for entry in entries:
                blocks.append(
                    f"  - package: {entry['package']}\n"
                    f"    range: \"{entry['range']}\"\n"
                    f"    advisory: {entry.get('advisory', 'GHSA-x')}\n"
                    f"    severity: {entry.get('severity', 'critical')}\n"
                    f"    vector: >-\n"
                    f"      {entry.get('vector', 'Reachable on the ingest path.')}\n"
                    f"    upstream: https://example.invalid/1\n"
                    f"    added: 2026-08-04\n"
                )
            body = "overrides:\n" + "\n".join(blocks)
        (self.dir / "security" / "overrides.yaml").write_text(body, encoding="utf-8")

    def add_patch(self, name: str, diff: str) -> Path:
        patches = self.dir / "security" / "patches"
        patches.mkdir(exist_ok=True)
        path = patches / name
        path.write_text(diff, encoding="utf-8")
        return path

    def run(self, script: str, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [str(self.scripts / script), *args],
            cwd=self.dir,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    def cleanup(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)


class SecurityLayerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.fork = ForkFixture()
        self.addCleanup(self.fork.cleanup)

    def test_empty_register_leaves_upstream_block_untouched(self) -> None:
        before = (self.fork.dir / "package.json").read_bytes()
        self.assertEqual(self.fork.run("security-override.py", "--apply").returncode, 0)
        self.assertEqual((self.fork.dir / "package.json").read_bytes(), before)

    def test_apply_raises_the_floor_and_appends_new_packages(self) -> None:
        self.fork.set_register(
            [
                {"package": "brace-expansion", "range": ">=2.9.9"},
                {"package": "some-parser", "range": ">=1.2.3"},
            ]
        )
        result = self.fork.run("security-override.py", "--apply")
        self.assertEqual(result.returncode, 0, result.stderr)

        block = self.fork.manifest()["resolutions"]
        self.assertEqual(block["brace-expansion"], ">=2.9.9")
        self.assertEqual(block["some-parser"], ">=1.2.3")
        # Upstream's keys keep their positions; ours append. A reordered block
        # conflicts wholesale on the next merge.
        self.assertEqual(
            list(block), ["express", "brace-expansion", "cookie", "some-parser"]
        )

    def test_a_pin_below_upstreams_own_is_left_inert(self) -> None:
        """A stale pin must never drag the tree back onto the vulnerable line."""
        self.fork.set_register([{"package": "brace-expansion", "range": ">=2.0.0"}])
        result = self.fork.run("security-override.py", "--apply")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SUPERSEDED", result.stdout)
        self.assertEqual(self.fork.manifest()["resolutions"]["brace-expansion"], "^2.0.2")

    def test_unapply_apply_round_trip_is_byte_identical(self) -> None:
        self.fork.set_register([{"package": "some-parser", "range": ">=1.2.3"}])
        self.fork.run("security-override.py", "--apply")
        applied = (self.fork.dir / "package.json").read_bytes()

        self.fork.run("security-override.py", "--unapply")
        self.fork.run("security-override.py", "--apply")
        self.assertEqual((self.fork.dir / "package.json").read_bytes(), applied)

    def test_unapply_restores_upstreams_block_exactly(self) -> None:
        """The guarantee the whole design rests on: no delta at merge time."""
        self.fork.set_register([{"package": "some-parser", "range": ">=1.2.3"}])
        self.fork.run("security-override.py", "--apply")
        self.fork.run("security-override.py", "--unapply")

        self.assertEqual(
            self.fork.manifest()["resolutions"], UPSTREAM_MANIFEST["resolutions"]
        )

    def test_apply_never_reformats_the_rest_of_the_manifest(self) -> None:
        """package.json is catalogued upstream surface - only the block may move."""
        self.fork.set_register([{"package": "some-parser", "range": ">=1.2.3"}])
        self.fork.run("security-override.py", "--apply")

        text = (self.fork.dir / "package.json").read_text(encoding="utf-8")
        self.assertIn('"scripts": {\n    "build": "nx build"\n  }', text)
        self.assertEqual(self.fork.manifest()["version"], "2.0.0")

    def test_an_entry_after_the_empty_marker_is_not_lost(self) -> None:
        """`overrides: []` must not swallow the rest of the file.

        The shipped register carries that marker with the example commented out
        BELOW it, so the natural way to add a pin - uncomment, forget the
        marker - left every entry invisible while every command reported
        success.
        """
        (self.fork.dir / "security" / "overrides.yaml").write_text(
            "overrides: []\n"
            "  - package: some-parser\n"
            '    range: ">=1.2.3"\n'
            "    advisory: GHSA-x\n"
            "    severity: critical\n"
            "    vector: >-\n"
            "      Reachable on the ingest path.\n"
            "    upstream: https://example.invalid/1\n"
            "    added: 2026-08-05\n",
            encoding="utf-8",
        )
        result = self.fork.run("security-override.py", "--list")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("some-parser", result.stdout)

    def test_an_uncomparable_range_keeps_the_pin(self) -> None:
        """A `patch:` spec parses to nothing; that must not read as redundant.

        An unreadable range compared as lower than everything, so the pin was
        dropped AND the tool printed that upstream ships something higher.
        """
        self.fork.set_register(
            [{"package": "brace-expansion", "range": "patch:brace-expansion@2.0.2#./p.patch"}]
        )
        result = self.fork.run("security-override.py", "--apply")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("SUPERSEDED", result.stdout)
        self.assertEqual(
            self.fork.manifest()["resolutions"]["brace-expansion"],
            "patch:brace-expansion@2.0.2#./p.patch",
        )

    def test_an_or_range_keeps_its_real_floor(self) -> None:
        """`^0.7.2 || ^1.0.0` is the standard "fixed in 0.7.2 and 1.0.0" shape.

        Reading only as far as the first unparseable character gave (0, 7),
        which sorts BELOW upstream's own (0, 7, 0) - so a live pin against a
        vulnerable 0.7.0 was dropped as superseded, on a printed claim that
        upstream ships something higher.
        """
        self.fork.set_register([{"package": "cookie", "range": "^0.7.2 || ^1.0.0"}])
        result = self.fork.run("security-override.py", "--apply")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("SUPERSEDED", result.stdout)
        self.assertEqual(
            self.fork.manifest()["resolutions"]["cookie"], "^0.7.2 || ^1.0.0"
        )

    def test_a_bounded_range_keeps_its_real_floor(self) -> None:
        """`>=4.21.3 <5.0.0` floors at 4.21.3, not at the truncated (4, 21)."""
        self.fork.set_register([{"package": "express", "range": ">=4.21.3 <5.0.0"}])
        result = self.fork.run("security-override.py", "--apply")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("SUPERSEDED", result.stdout)
        self.assertEqual(
            self.fork.manifest()["resolutions"]["express"], ">=4.21.3 <5.0.0"
        )

    def test_an_or_range_upstream_has_overtaken_is_still_superseded(self) -> None:
        """The floor must stay comparable - refusing every OR range would just
        invert the bug, holding dead pins forever."""
        self.fork.set_register([{"package": "cookie", "range": "^0.6.0 || ^1.0.0"}])
        result = self.fork.run("security-override.py", "--apply")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SUPERSEDED", result.stdout)
        self.assertEqual(self.fork.manifest()["resolutions"]["cookie"], "^0.7.0")

    def test_verify_enforces_the_severity_bar(self) -> None:
        """--verify is the only register check on a PR, so it must validate."""
        self.fork.set_register(
            [{"package": "some-parser", "range": ">=1.2.3", "severity": "moderate"}]
        )
        result = self.fork.run("security-override.py", "--verify")

        self.assertEqual(result.returncode, 1)
        self.assertIn("does not meet the bar", result.stderr)

    def test_verify_fails_on_a_hand_edited_block(self) -> None:
        manifest = self.fork.manifest()
        manifest["resolutions"]["lodash"] = "^4.17.21"
        self.fork.write_manifest(manifest)

        result = self.fork.run("security-override.py", "--verify")
        self.assertEqual(result.returncode, 1)
        self.assertIn("declared nowhere", result.stderr)

    def test_verify_fails_when_a_declared_pin_is_not_applied(self) -> None:
        self.fork.set_register([{"package": "some-parser", "range": ">=1.2.3"}])
        result = self.fork.run("security-override.py", "--verify")

        self.assertEqual(result.returncode, 1)
        self.assertIn("declared but not applied", result.stderr)

    def test_register_rejects_a_severity_below_the_bar(self) -> None:
        self.fork.set_register(
            [{"package": "some-parser", "range": ">=1.2.3", "severity": "moderate"}]
        )
        result = self.fork.run("security-override.py", "--apply")

        self.assertEqual(result.returncode, 1)
        self.assertIn("does not meet the bar", result.stderr)

    def test_register_rejects_a_missing_vector(self) -> None:
        """The vector is the field that gets skipped, so it has to be enforced."""
        (self.fork.dir / "security" / "overrides.yaml").write_text(
            "overrides:\n"
            "  - package: some-parser\n"
            '    range: ">=1.2.3"\n'
            "    advisory: GHSA-x\n"
            "    severity: critical\n"
            "    upstream: https://example.invalid/1\n"
            "    added: 2026-08-04\n",
            encoding="utf-8",
        )
        result = self.fork.run("security-override.py", "--apply")

        self.assertEqual(result.returncode, 1)
        self.assertIn("missing required field 'vector'", result.stderr)

    def test_folded_vector_prose_is_gathered(self) -> None:
        """`vector: >-` is the documented shape, so it must parse."""
        self.fork.set_register(
            [
                {
                    "package": "some-parser",
                    "range": ">=1.2.3",
                    "vector": "Untrusted event bodies reach parse() unauthenticated.",
                }
            ]
        )
        result = self.fork.run("security-override.py", "--list")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Untrusted event bodies reach parse()", result.stdout)


class MidMergeTest(unittest.TestCase):
    """--apply runs while a merge is in flight, when HEAD is still the old commit."""

    def setUp(self) -> None:
        self.fork = ForkFixture()
        self.addCleanup(self.fork.cleanup)

        # A newer upstream that moved one of its own pins and added another.
        git(self.fork.dir, "checkout", "-q", "-b", "newer", self.fork.upstream_sha)
        newer = json.loads(json.dumps(UPSTREAM_MANIFEST))
        newer["resolutions"]["brace-expansion"] = "^2.1.2"
        newer["resolutions"]["@asyncapi/specs"] = "6.11.1"
        self.fork.write_manifest(newer)
        git(self.fork.dir, "commit", "-qam", "upstream 2")
        self.newer_sha = git(self.fork.dir, "rev-parse", "HEAD").stdout.strip()
        git(self.fork.dir, "update-ref", "refs/remotes/upstream/main", self.newer_sha)
        git(self.fork.dir, "checkout", "-q", "main")

    def test_apply_uses_the_upstream_being_merged_not_the_one_left_behind(self) -> None:
        self.fork.run("security-override.py", "--unapply")
        subprocess.run(
            ["git", "merge", "--no-commit", "--no-ff", self.newer_sha],
            cwd=self.fork.dir,
            capture_output=True,
            check=False,
        )
        self.assertEqual(self.fork.run("security-override.py", "--apply").returncode, 0)

        block = self.fork.manifest()["resolutions"]
        self.assertEqual(block["brace-expansion"], "^2.1.2")
        self.assertIn("@asyncapi/specs", block)


class BraceInAValueTest(unittest.TestCase):
    """A resolution value is free text - the block scanner must skip strings.

    Yarn's `patch:` protocol is the realistic carrier. A naive brace count would
    find the wrong end of the block and silently corrupt the manifest.
    """

    def setUp(self) -> None:
        self.fork = ForkFixture()
        self.addCleanup(self.fork.cleanup)

        git(self.fork.dir, "checkout", "-q", "-b", "braced", self.fork.upstream_sha)
        upstream = json.loads(json.dumps(UPSTREAM_MANIFEST))
        upstream["resolutions"]["weird"] = "patch:weird@1.0.0#./p{0}.patch"
        self.fork.write_manifest(upstream)
        git(self.fork.dir, "commit", "-qam", "upstream with a braced value")
        git(self.fork.dir, "update-ref", "refs/remotes/upstream/main", "HEAD")
        git(self.fork.dir, "checkout", "-q", "main")
        git(self.fork.dir, "merge", "-q", "--no-edit", "braced")

    def test_the_block_and_everything_after_it_survive(self) -> None:
        self.fork.set_register([{"package": "some-parser", "range": ">=1.2.3"}])
        result = self.fork.run("security-override.py", "--apply")
        self.assertEqual(result.returncode, 0, result.stderr)

        manifest = self.fork.manifest()
        self.assertEqual(manifest["resolutions"]["weird"], "patch:weird@1.0.0#./p{0}.patch")
        self.assertEqual(manifest["resolutions"]["some-parser"], ">=1.2.3")
        self.assertEqual(manifest["version"], "2.0.0")
        self.assertEqual(manifest["scripts"], {"build": "nx build"})


def lockfile(versions: dict[str, str]) -> str:
    """A yarn.lock resolving each package to exactly one version."""
    return "".join(
        f'"{name}@npm:^{version}":\n'
        f"  version: {version}\n"
        f'  resolution: "{name}@npm:{version}"\n\n'
        for name, version in versions.items()
    )


class RedundancyCheckTest(unittest.TestCase):
    """--check asks whether upstream has caught up, so it reads UPSTREAM's lockfile.

    Our own lockfile cannot answer that: with the pin in force it resolves at or
    above the pin's floor by construction, so reading it reported every live pin
    redundant and told us to delete a security fix upstream does not have.
    """

    def setUp(self) -> None:
        self.fork = ForkFixture()
        self.addCleanup(self.fork.cleanup)

    def upstream_ships(self, versions: dict[str, str]) -> None:
        """Move the merge base to an upstream commit carrying this lockfile."""
        git(self.fork.dir, "checkout", "-q", "-b", "locked", self.fork.upstream_sha)
        (self.fork.dir / "yarn.lock").write_text(lockfile(versions), encoding="utf-8")
        git(self.fork.dir, "add", "yarn.lock")
        git(self.fork.dir, "commit", "-qm", "upstream lockfile")
        git(self.fork.dir, "update-ref", "refs/remotes/upstream/main", "HEAD")
        git(self.fork.dir, "checkout", "-q", "main")
        git(self.fork.dir, "merge", "-q", "--no-edit", "locked")

    def we_resolve(self, versions: dict[str, str]) -> None:
        (self.fork.dir / "yarn.lock").write_text(lockfile(versions), encoding="utf-8")

    def test_a_pin_holding_our_tree_above_upstream_is_not_redundant(self) -> None:
        self.upstream_ships({"some-parser": "1.2.0"})
        self.we_resolve({"some-parser": "1.2.5"})
        self.fork.set_register([{"package": "some-parser", "range": "^1.2.3"}])

        result = self.fork.run("security-override.py", "--check")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("REDUNDANT", result.stdout)
        self.assertIn("upstream ships 1.2.0", result.stdout)

    def test_a_pin_upstream_has_caught_up_with_is_redundant(self) -> None:
        self.upstream_ships({"some-parser": "1.3.0"})
        self.we_resolve({"some-parser": "1.3.0"})
        self.fork.set_register([{"package": "some-parser", "range": "^1.2.3"}])

        result = self.fork.run("security-override.py", "--check")

        self.assertEqual(result.returncode, 1)
        self.assertIn("[REDUNDANT] some-parser ^1.2.3 - upstream now ships 1.3.0", result.stdout)

    def test_a_package_only_our_tree_pulls_in_keeps_its_pin(self) -> None:
        """Upstream's lockfile says nothing about a dependency only we added."""
        self.upstream_ships({"other": "1.0.0"})
        self.we_resolve({"other": "1.0.0", "some-parser": "1.2.5"})
        self.fork.set_register([{"package": "some-parser", "range": "^1.2.3"}])

        result = self.fork.run("security-override.py", "--check")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("REDUNDANT", result.stdout)

    def test_no_upstream_lockfile_declines_rather_than_passing(self) -> None:
        self.we_resolve({"some-parser": "1.2.5"})
        self.fork.set_register([{"package": "some-parser", "range": "^1.2.3"}])

        result = self.fork.run("security-override.py", "--check")

        self.assertEqual(result.returncode, 1)
        self.assertIn("Declining", result.stdout)
        self.assertNotIn("REDUNDANT", result.stdout)


class PatchSeriesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.fork = ForkFixture()
        self.addCleanup(self.fork.cleanup)
        self.diff = (
            "--- a/app.js\n"
            "+++ b/app.js\n"
            "@@ -1 +1 @@\n"
            "-const greeting = 'hello';\n"
            "+const greeting = 'hello';  // hardened\n"
        )

    def test_apply_then_unapply_restores_the_file(self) -> None:
        self.fork.add_patch("0001-harden.patch", self.diff)
        original = (self.fork.dir / "app.js").read_text(encoding="utf-8")

        self.assertEqual(self.fork.run("security-override.py", "--apply").returncode, 0)
        self.assertIn("hardened", (self.fork.dir / "app.js").read_text(encoding="utf-8"))

        self.assertEqual(self.fork.run("security-override.py", "--unapply").returncode, 0)
        self.assertEqual((self.fork.dir / "app.js").read_text(encoding="utf-8"), original)

    def test_apply_is_idempotent(self) -> None:
        """The sync workflow may retry, so applying twice must not double-apply."""
        self.fork.add_patch("0001-harden.patch", self.diff)
        self.fork.run("security-override.py", "--apply")
        result = self.fork.run("security-override.py", "--apply")

        self.assertEqual(result.returncode, 0, result.stderr)
        body = (self.fork.dir / "app.js").read_text(encoding="utf-8")
        self.assertEqual(body.count("hardened"), 1)

    def test_verify_fails_while_a_patch_is_unapplied(self) -> None:
        self.fork.add_patch("0001-harden.patch", self.diff)
        result = self.fork.run("security-override.py", "--verify")

        self.assertEqual(result.returncode, 1)
        self.assertIn("NOT applied", result.stderr)

    def test_a_patch_whose_code_moved_is_reported_not_forced(self) -> None:
        """Upstream moving the code under a patch is the signal, not a crash."""
        self.fork.add_patch("0001-harden.patch", self.diff)
        (self.fork.dir / "app.js").write_text(
            "const salutation = 'howdy';\n", encoding="utf-8"
        )
        result = self.fork.run("security-override.py", "--apply")

        self.assertEqual(result.returncode, 1)
        self.assertIn("NEED A HUMAN", result.stderr)
        self.assertIn("the tree has moved", result.stderr)
        self.assertIn("0001-harden.patch", result.stderr)


class AmbiguousPatchTest(unittest.TestCase):
    """A patch that applies in BOTH directions must be refused, not guessed at.

    The shape below is ordinary: the fix swaps an argument order, and upstream
    later added a second call site ABOVE the patched one that is already in the
    safe order. git apply searches backward from the hunk header, finds its own
    post-image at that earlier site, and reverse-applies there cleanly.

    So the patch reverses AND applies. Deciding by which check runs first reads
    the fix as present while it is absent, and reversing on that belief rewrites
    upstream's correct call site INTO the vulnerable order - turning one
    vulnerable site into two, immediately before the merge.
    """

    BODY = (
        "guard();\n"
        "call(token, user);\n"  # upstream's, already correct
        "log();\n"
        "guard();\n"
        "call(user, token);\n"  # the one the patch targets - still vulnerable
        "log();\n"
    )
    DIFF = (
        "--- a/app.js\n"
        "+++ b/app.js\n"
        "@@ -4,3 +4,3 @@\n"
        " guard();\n"
        "-call(user, token);\n"
        "+call(token, user);\n"
        " log();\n"
    )

    def setUp(self) -> None:
        self.fork = ForkFixture()
        self.addCleanup(self.fork.cleanup)
        self.fork.add_patch("0001-arg-order.patch", self.DIFF)
        (self.fork.dir / "app.js").write_text(self.BODY, encoding="utf-8")

    def test_verify_refuses_to_certify_a_both_ways_patch(self) -> None:
        result = self.fork.run("security-override.py", "--verify")

        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("ambiguous", result.stderr)
        self.assertIn("0001-arg-order.patch", result.stderr)

    def test_unapply_leaves_an_ambiguous_patch_alone(self) -> None:
        result = self.fork.run("security-override.py", "--unapply")

        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(
            (self.fork.dir / "app.js").read_text(encoding="utf-8"),
            self.BODY,
            "reversed a guess - the second call site was rewritten",
        )
        self.assertIn("BOTH directions", result.stderr)

    def test_apply_leaves_an_ambiguous_patch_alone(self) -> None:
        result = self.fork.run("security-override.py", "--apply")

        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(
            (self.fork.dir / "app.js").read_text(encoding="utf-8"), self.BODY
        )
        self.assertIn("BOTH directions", result.stderr)


class UpstreamPinTest(unittest.TestCase):
    def setUp(self) -> None:
        self.fork = ForkFixture()
        self.addCleanup(self.fork.cleanup)

    def _write_pin(self, sha: str, ref: str = "@hyperdx/app@2.29.0") -> None:
        (self.fork.dir / ".upstream-version").write_text(
            f"upstream_ref: '{ref}'\nupstream_sha: {sha}\nsynced: 2026-07-07\n",
            encoding="utf-8",
        )

    def test_verify_passes_when_the_pin_matches_the_merge_base(self) -> None:
        self._write_pin(self.fork.upstream_sha)
        result = self.fork.run("upstream-pin.py", "--verify")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("pin agrees with the tree", result.stdout)

    def test_verify_fails_when_a_merge_moved_the_base_but_not_the_pin(self) -> None:
        self._write_pin("0" * 40)
        result = self.fork.run("upstream-pin.py", "--verify")

        self.assertEqual(result.returncode, 1)
        self.assertIn("PIN DISAGREES WITH THE TREE", result.stderr)

    def test_set_records_the_resolved_sha(self) -> None:
        result = self.fork.run("upstream-pin.py", "--set", self.fork.upstream_sha)
        self.assertEqual(result.returncode, 0, result.stderr)

        body = (self.fork.dir / ".upstream-version").read_text(encoding="utf-8")
        self.assertIn(self.fork.upstream_sha, body)
        self.assertEqual(self.fork.run("upstream-pin.py", "--verify").returncode, 0)

    def test_set_names_a_branch_by_its_release_tag(self) -> None:
        """The scheduled sync merges upstream/main; a branch name is not a pin."""
        git(self.fork.dir, "tag", "@hyperdx/app@2.29.0", self.fork.upstream_sha)
        result = self.fork.run("upstream-pin.py", "--set", "upstream/main")

        self.assertEqual(result.returncode, 0, result.stderr)
        body = (self.fork.dir / ".upstream-version").read_text(encoding="utf-8")
        self.assertIn("@hyperdx/app@2.29.0", body)
        self.assertNotIn("upstream_ref: 'upstream/main'", body)

    def test_set_marks_a_branch_ahead_of_its_last_tag(self) -> None:
        """Pinning past a release must not silently claim to BE that release."""
        git(self.fork.dir, "tag", "@hyperdx/app@2.29.0", self.fork.upstream_sha)
        git(self.fork.dir, "checkout", "-q", "-b", "ahead", self.fork.upstream_sha)
        (self.fork.dir / "app.js").write_text("// moved on\n", encoding="utf-8")
        git(self.fork.dir, "commit", "-qam", "past the tag")
        git(self.fork.dir, "update-ref", "refs/remotes/upstream/main", "HEAD")
        git(self.fork.dir, "checkout", "-q", "main")

        self.fork.run("upstream-pin.py", "--set", "upstream/main")
        body = (self.fork.dir / ".upstream-version").read_text(encoding="utf-8")
        self.assertIn("@hyperdx/app@2.29.0+", body)

    def test_set_refuses_a_ref_that_does_not_resolve(self) -> None:
        result = self.fork.run("upstream-pin.py", "--set", "@hyperdx/app@9.9.9")

        self.assertEqual(result.returncode, 1)
        self.assertIn("does not resolve", result.stderr)


if __name__ == "__main__":
    unittest.main()
