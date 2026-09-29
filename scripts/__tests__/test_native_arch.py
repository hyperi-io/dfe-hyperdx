#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/__tests__/test_native_arch.py
#  Purpose:      Prove native-arch.mjs keeps one arch's binaries and fails on any other
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Tests for scripts/native-arch.mjs.

The image's build stages install every published arch's prebuilt packages, and
this script is what stops the runtime tree carrying the wrong machine's binary.
A binary it fails to catch still loads nowhere but the build host, and nothing
else in the build notices.

Each test builds a throwaway node_modules tree with real ELF headers.

Run::

    python3 -m unittest discover -s scripts/__tests__ -v
"""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "native-arch.mjs"

X86_64 = 62
AARCH64 = 183


def elf(machine: int) -> bytes:
    """A 64-bit little-endian ELF header for ``machine``, padded past e_machine."""
    ident = b"\x7fELF" + bytes([2, 1, 1]) + bytes(9)
    return ident + (2).to_bytes(2, "little") + machine.to_bytes(2, "little") + bytes(44)


def package(root: Path, name: str, manifest: dict, files: dict[str, bytes]) -> Path:
    pkg = root / "node_modules" / name
    pkg.mkdir(parents=True)
    (pkg / "package.json").write_text(json.dumps({"name": name, **manifest}), encoding="utf-8")
    for rel, data in files.items():
        target = pkg / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return pkg


class NativeArchTest(unittest.TestCase):
    def setUp(self) -> None:
        if shutil.which("node") is None:
            self.fail("node is not on PATH, so the native-arch gate cannot be tested")
        self.root = Path(tempfile.mkdtemp(prefix="native-arch-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def run_script(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["node", str(SCRIPT), *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    def two_arch_tree(self) -> tuple[Path, Path]:
        x64 = package(
            self.root,
            "@img/sharp-linux-x64",
            {"cpu": ["x64"], "os": ["linux"]},
            {"lib/sharp.node": elf(X86_64)},
        )
        arm64 = package(
            self.root,
            "@img/sharp-linux-arm64",
            {"cpu": ["arm64"], "os": ["linux"]},
            {"lib/sharp.node": elf(AARCH64)},
        )
        package(self.root, "sharp", {}, {"index.js": b"module.exports = 1;\n"})
        return x64, arm64

    def test_arm64_keeps_its_own_package_and_drops_the_x64_one(self) -> None:
        x64, arm64 = self.two_arch_tree()
        result = self.run_script("arm64", str(self.root))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(x64.exists())
        self.assertTrue((arm64 / "lib" / "sharp.node").exists())
        self.assertTrue((self.root / "node_modules" / "sharp" / "index.js").exists())

    def test_amd64_keeps_its_own_package_and_drops_the_arm64_one(self) -> None:
        x64, arm64 = self.two_arch_tree()
        result = self.run_script("amd64", str(self.root))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((x64 / "lib" / "sharp.node").exists())
        self.assertFalse(arm64.exists())

    def test_a_negated_cpu_entry_excludes_the_target(self) -> None:
        pkg = package(self.root, "not-on-arm", {"cpu": ["!arm64"]}, {"a.node": elf(X86_64)})
        result = self.run_script("arm64", str(self.root))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(pkg.exists())

    def test_a_foreign_binary_outside_a_cpu_package_fails_the_build(self) -> None:
        # Prebuilds shipped for every arch in one package carry no cpu field.
        package(
            self.root,
            "bundles-prebuilds",
            {},
            {"prebuilds/linux-x64/addon.node": elf(X86_64)},
        )
        result = self.run_script("arm64", str(self.root))
        self.assertEqual(result.returncode, 1)
        self.assertIn("prebuilds/linux-x64/addon.node", result.stderr)
        self.assertIn("not aarch64", result.stderr)

    def test_files_that_are_not_elf_or_too_short_are_ignored(self) -> None:
        package(
            self.root,
            "odd-files",
            {},
            {"empty.bin": b"", "short.bin": b"\x7fELF", "text.js": b"x".ljust(64, b"x")},
        )
        (self.root / "node_modules" / "broken").mkdir()
        (self.root / "node_modules" / "broken" / "package.json").write_text("{", encoding="utf-8")
        result = self.run_script("arm64", str(self.root))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_an_unknown_arch_is_a_usage_error(self) -> None:
        result = self.run_script("riscv64", str(self.root))
        self.assertEqual(result.returncode, 2)
        self.assertIn("usage", result.stderr)

    def test_no_directory_is_a_usage_error(self) -> None:
        result = self.run_script("arm64")
        self.assertEqual(result.returncode, 2)
        self.assertIn("usage", result.stderr)


if __name__ == "__main__":
    unittest.main()
