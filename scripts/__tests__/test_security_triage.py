#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/__tests__/test_security_triage.py
#  Purpose:      Prove the triage report names its advisory source truthfully
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Tests for security-triage.py's choice of advisory source.

The report says where its advisories came from, and a reviewer reads that line
to decide whether the list is complete. Both sources are stubbed, so these run
with no network and no gh.

Run::

    python3 -m unittest discover -s scripts/__tests__ -v
"""

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

SOURCE = Path(__file__).resolve().parent.parent / "security-triage.py"

_SPEC = importlib.util.spec_from_file_location("security_triage", SOURCE)
assert _SPEC is not None and _SPEC.loader is not None
tool = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = tool
_SPEC.loader.exec_module(tool)

YARN_ADVISORY = {
    "package": "braces",
    "scope": "unknown",
    "manifest": "",
    "severity": "high",
    "issue": "stack exhaustion",
    "url": "",
    "range": "<=3.0.3",
    "patched": "",
    "source": "yarn",
}


class AdvisorySourceTest(unittest.TestCase):
    def test_no_open_alerts_is_not_reported_as_unavailable(self) -> None:
        with (
            mock.patch.object(tool, "collect_dependabot", return_value=([], "")),
            mock.patch.object(tool, "collect_yarn_audit", return_value=[YARN_ADVISORY]),
        ):
            _, _, note = tool.collect_audit()
        self.assertIn("Dependabot has no open high or critical alert", note)
        self.assertNotIn("unavailable", note)

    def test_a_failed_read_still_says_why(self) -> None:
        with (
            mock.patch.object(
                tool, "collect_dependabot", return_value=([], "no output")
            ),
            mock.patch.object(tool, "collect_yarn_audit", return_value=[YARN_ADVISORY]),
        ):
            _, _, note = tool.collect_audit()
        self.assertIn("Dependabot unavailable (no output)", note)


if __name__ == "__main__":
    unittest.main()
