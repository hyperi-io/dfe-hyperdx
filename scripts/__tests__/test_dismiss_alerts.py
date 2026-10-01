#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/__tests__/test_dismiss_alerts.py
#  Purpose:      Prove the refresh touches only dismissals that disagree
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Tests for dismiss-triaged-alerts.py's verdict table and refresh plan.

The refresh reopens and re-dismisses alerts on the live repo, so what it
selects is pinned here against plain alert data, with no network.

Run::

    python3 -m unittest discover -s scripts/__tests__ -v
"""

import importlib.util
import sys
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "dismiss-triaged-alerts.py"

_SPEC = importlib.util.spec_from_file_location("dismiss_triaged_alerts", SOURCE)
assert _SPEC is not None and _SPEC.loader is not None
tool = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = tool
_SPEC.loader.exec_module(tool)

# GitHub's accepted values for dismissed_reason on a Dependabot alert.
GITHUB_REASONS = {
    "fix_started",
    "inaccurate",
    "no_bandwidth",
    "not_used",
    "tolerable_risk",
}

VERDICTS = {
    "pkg-a": ("not_used", "Absent from the image."),
    "pkg-b": ("tolerable_risk", "Reached, and bounded."),
}


def alert(number: int, package: str, reason: str, comment: str | None) -> dict:
    return {
        "number": number,
        "dependency": {"package": {"name": package}},
        "dismissed_reason": reason,
        "dismissed_comment": comment,
    }


class VerdictTableTest(unittest.TestCase):
    def test_every_comment_fits_githubs_limit(self) -> None:
        for package, (_, comment) in tool.VERDICTS.items():
            with self.subTest(package=package):
                body = tool.dismissal_body(comment)
                self.assertLessEqual(len(body), tool.COMMENT_LIMIT)

    def test_every_reason_is_one_github_accepts(self) -> None:
        for package, (reason, _) in tool.VERDICTS.items():
            with self.subTest(package=package):
                self.assertIn(reason, GITHUB_REASONS)


class StaleDismissalsTest(unittest.TestCase):
    def test_a_dismissal_matching_its_verdict_is_left_alone(self) -> None:
        body = tool.dismissal_body("Absent from the image.")
        dismissed = [alert(1, "pkg-a", "not_used", body)]
        self.assertEqual(tool.stale_dismissals(dismissed, VERDICTS), [])

    def test_a_changed_reason_is_refreshed_and_says_so(self) -> None:
        body = tool.dismissal_body("Reached, and bounded.")
        dismissed = [alert(2, "pkg-b", "not_used", body)]
        [item] = tool.stale_dismissals(dismissed, VERDICTS)
        self.assertEqual(
            (item.number, item.old_reason, item.new_reason),
            (2, "not_used", "tolerable_risk"),
        )
        self.assertFalse(item.comment_changes)

    def test_a_changed_comment_alone_is_refreshed(self) -> None:
        dismissed = [alert(3, "pkg-a", "not_used", "An old claim. See the doc.")]
        [item] = tool.stale_dismissals(dismissed, VERDICTS)
        self.assertEqual(item.old_reason, item.new_reason)
        self.assertTrue(item.comment_changes)
        self.assertEqual(item.body, tool.dismissal_body("Absent from the image."))

    def test_a_dismissal_with_no_comment_is_refreshed(self) -> None:
        dismissed = [alert(4, "pkg-a", "not_used", None)]
        [item] = tool.stale_dismissals(dismissed, VERDICTS)
        self.assertTrue(item.comment_changes)

    def test_a_dismissal_with_no_verdict_is_never_touched(self) -> None:
        dismissed = [alert(5, "pkg-unknown", "inaccurate", "Dismissed by hand.")]
        self.assertEqual(tool.stale_dismissals(dismissed, VERDICTS), [])


if __name__ == "__main__":
    unittest.main()
