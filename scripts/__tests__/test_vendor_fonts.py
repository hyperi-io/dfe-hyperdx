#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/__tests__/test_vendor_fonts.py
#  Purpose:      Prove vendor-fonts.py keeps every Google subset and its unicode-range
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Tests for scripts/vendor-fonts.py, offline, against a trimmed Google css2 reply.

Run::

    python3 -m unittest discover -s scripts/__tests__ -v
"""

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "vendor-fonts.py"
_spec = importlib.util.spec_from_file_location("vendor_fonts", SCRIPT)
assert _spec and _spec.loader
vf = importlib.util.module_from_spec(_spec)
sys.modules["vendor_fonts"] = vf  # dataclasses resolve annotations through it
_spec.loader.exec_module(vf)


def face(subset: str, weight: str, url: str, rng: str) -> str:
    return (
        f"/* {subset} */\n@font-face {{\n  font-family: 'X';\n  font-style: normal;\n"
        f"  font-weight: {weight};\n  font-display: swap;\n"
        f"  src: url({url}) format('woff2');\n  unicode-range: {rng};\n}}\n"
    )


STATIC = "".join(
    face(s, w, f"https://g/{s}-{w}.woff2", r)
    for s, r in (("cyrillic", "U+0400-045F"), ("latin", "U+0000-00FF"))
    for w in ("300", "400")
)
VARIABLE = face("greek", "100", "https://g/greek.woff2", "U+0370-03FF") + face(
    "greek", "700", "https://g/greek.woff2", "U+0370-03FF"
)
FAMILY = vf.Family("X Mono", "xMono", "x-mono", "--font-x-mono", ("300", "400"))


class ParseCss(unittest.TestCase):
    def test_groups_by_subset_in_google_order(self) -> None:
        subsets = vf.parse_css(STATIC)
        self.assertEqual([s.name for s in subsets], ["cyrillic", "latin"])
        self.assertEqual(subsets[0].unicode_range, "U+0400-045F")
        self.assertEqual(list(subsets[1].files), ["300", "400"])

    def test_one_url_for_every_weight_is_a_variable_file(self) -> None:
        cases = ((VARIABLE, True), (STATIC, False))
        for css, variable in cases:
            with self.subTest(variable=variable):
                self.assertIs(vf.is_variable(vf.parse_css(css)[0]), variable)


class Render(unittest.TestCase):
    def test_only_latin_carries_the_variable_and_preloads(self) -> None:
        cyrillic, latin = vf.parse_css(STATIC)
        other = vf.loader_ts(FAMILY, cyrillic)
        main = vf.loader_ts(FAMILY, latin)
        self.assertIn("const xMonoCyrillic = localFont(", other)
        self.assertIn("preload: false", other)
        self.assertNotIn("variable:", other)
        self.assertIn("const xMono = localFont(", main)
        self.assertIn("variable: '--font-x-mono'", main)
        self.assertNotIn("preload: false", main)
        for loader in (other, main):
            self.assertIn("{ prop: 'font-family', value: 'xMono' }", loader)

    def test_export_lists_every_subset(self) -> None:
        out = vf.export_ts(FAMILY, vf.parse_css(STATIC))
        self.assertIn("export const X_Mono = vendoredFont(xMono, 'X Mono', {", out)
        self.assertIn("weights: ['300', '400']", out)
        self.assertIn("cyrillic: xMonoCyrillic,", out)
        self.assertIn("latin: xMono,", out)


if __name__ == "__main__":
    unittest.main()
