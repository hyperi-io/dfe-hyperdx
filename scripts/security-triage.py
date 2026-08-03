#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/security-triage.py
#  Purpose:      Draft the judgement calls in the sync cycle, for a human to accept
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Draft verdicts on the three questions the mechanical tooling cannot answer.

The rest of the cycle is deterministic: the merge either applies, the pin either
raises the floor, the patch either applies. These three do not reduce to a
comparison, which is why they were the steps still done by hand:

  --audit     `yarn npm audit` says HIGH. Is the vulnerable path REACHABLE in
              how DFE runs this fork? Drafts the `vector` prose the register
              demands, or says the advisory is unreachable and why.
  --patches   A carried patch stopped applying after a merge. Did upstream fix
              it their own way, or did the code just move? Drafts which, and for
              a move, the re-derived hunk.
  --carried   For each pin and patch we still hold, has upstream landed an
              equivalent fix under a different shape? Version comparison misses
              this; reading the code does not.

IT PROPOSES, IT DOES NOT DECIDE. Output is a markdown report for the sync PR.
Nothing here writes the register, applies a patch, or clears a finding.
FORK.md's bar - "npm audit says high is not a vector" - is a judgement the fork
owner makes, and a model that could clear its own findings would rebuild exactly
the alert queue the inverted posture exists to avoid.

DEGRADES RATHER THAN FAILS. With no ANTHROPIC_API_KEY, or with the SDK absent,
it prints the mechanical facts and says plainly which sections went unjudged. A
sync must not be blocked because a key expired.

Usage::

    scripts/security-triage.py --audit --patches --carried -o triage.md
    scripts/security-triage.py --audit --model claude-sonnet-5

Exit codes: 0 always, unless an explicitly requested section could not run at
all. This reports; the gates elsewhere decide.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
REGISTER = REPO_ROOT / "security" / "overrides.yaml"
PATCHES = REPO_ROOT / "security" / "patches"

DEFAULT_MODEL = "claude-opus-5"
MAX_TOKENS = 4096

# Enough advisories to be useful, few enough to stay inside one call. A fork
# four releases behind can carry hundreds; the top severities are the ones the
# bar could plausibly admit.
MAX_ADVISORIES = 40

SYSTEM = """\
You triage security findings for a long-lived FORK of an upstream product.

The fork's rule, which you must apply rather than second-guess:

  A finding is only actionable if severity is HIGH or CRITICAL **and** there is
  a REAL VECTOR - the vulnerable code path is actually reachable in how this
  deployment runs. A package being present is NOT a vector. Reachable means you
  can describe the path: what input, through which entry point, reaching which
  vulnerable call.

Most advisories against a transitive dependency are NOT reachable: the package
is present but the vulnerable function is never imported, or it is only
reachable from a path this deployment does not ship (a dev server, a CLI that is
not run, a cloud adapter that is not configured).

Default to UNREACHABLE. Saying "cannot determine" is a correct and useful
answer; inventing a plausible-sounding vector is the failure mode that makes
this whole exercise worthless.

Be terse and concrete. Australian English. Plain ASCII only - no smart quotes,
em dashes, arrows or emoji. No marketing language.\
"""


def _run(*args: str, cwd: Path | None = None) -> tuple[int, str]:
    """Run a command, returning (returncode, stdout+stderr)."""
    try:
        result = subprocess.run(
            args,
            cwd=cwd or REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except OSError as exc:
        return 1, str(exc)
    return result.returncode, (result.stdout or "") + (result.stderr or "")


class Drafter:
    """Anthropic Messages call, built lazily so no key is read unless used.

    ``call`` is injectable for tests - the same external-boundary injection the
    rest of the HyperI tooling uses instead of mocking the SDK.
    """

    def __init__(self, model: str | None = None, call=None):
        self.model = model or DEFAULT_MODEL
        self._call = call
        self._client = None
        self.unavailable = ""

    def _get_client(self):
        if self._client is None:
            import anthropic  # lazy - keep the mechanical paths import-free

            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not api_key:
                raise RuntimeError("ANTHROPIC_API_KEY not set")
            base_url = os.environ.get("ANTHROPIC_BASE_URL")
            if base_url:
                self._client = anthropic.Anthropic(api_key=api_key, base_url=base_url)
            else:
                self._client = anthropic.Anthropic(api_key=api_key)
        return self._client

    def _default_call(self, system: str, user: str, max_tokens: int) -> str:
        client = self._get_client()
        chunks: list[str] = []
        with client.messages.stream(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        ) as stream:
            for piece in stream.text_stream:
                chunks.append(piece)
        return "".join(chunks)

    def draft(self, user: str, max_tokens: int = MAX_TOKENS) -> str | None:
        """Return the model's text, or None when the boundary is unavailable."""
        call = self._call if self._call is not None else self._default_call
        try:
            return call(SYSTEM, user, max_tokens).strip()
        except ImportError:
            self.unavailable = "the anthropic SDK is not installed (pip install anthropic)"
        except RuntimeError as exc:
            self.unavailable = str(exc)
        except Exception as exc:  # noqa: BLE001 - any API failure degrades, never blocks
            self.unavailable = f"{type(exc).__name__}: {exc}"
        return None


def collect_audit() -> tuple[list[dict], str]:
    """High and critical advisories from `yarn npm audit`, newest format.

    Yarn exits non-zero when it finds anything, so the return code carries no
    error information and is deliberately ignored.
    """
    _, out = _run("yarn", "npm", "audit", "--recursive", "--json", "--severity", "high")
    advisories: list[dict] = []
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        value = record.get("value")
        children = record.get("children") or {}
        if not value or not isinstance(children, dict):
            continue
        advisories.append(
            {
                "package": value,
                "severity": children.get("Severity", "unknown"),
                "issue": children.get("Issue", ""),
                "url": children.get("URL", ""),
                "via": children.get("Dependents", children.get("Via", "")),
                "range": children.get("Vulnerable Versions", ""),
                "patched": children.get("Patched Versions", ""),
            }
        )
    if not advisories:
        return [], "No high or critical advisories reported."
    return advisories, f"{len(advisories)} high/critical advisory(ies)."


def describe_deployment() -> str:
    """What this fork actually ships, so reachability has something to bite on."""
    parts = ["HOW THIS FORK IS DEPLOYED (use this to judge reachability):"]
    for name in ("FORK.md", "DFE-DOCKER-LOCAL.md"):
        path = REPO_ROOT / name
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        parts.append(f"\n--- {name} (first 6000 chars) ---\n{text[:6000]}")
    return "\n".join(parts)


def section_audit(drafter: Drafter) -> str:
    advisories, summary = collect_audit()
    lines = ["## Advisory triage", "", summary, ""]
    if not advisories:
        return "\n".join(lines)

    shown = advisories[:MAX_ADVISORIES]
    if len(advisories) > len(shown):
        lines.append(
            f"Judging the first {len(shown)} of {len(advisories)} - the rest are "
            f"listed in the audit artefact, unjudged."
        )
        lines.append("")

    table = "\n".join(
        f"- {a['package']} [{a['severity']}] {a['issue']} "
        f"(vulnerable {a['range']}, patched {a['patched']}) {a['url']}"
        for a in shown
    )
    lines.extend(["<details><summary>Raw advisories</summary>", "", table, "", "</details>", ""])

    verdict = drafter.draft(
        f"{describe_deployment()}\n\n"
        f"ADVISORIES:\n{table}\n\n"
        "For each advisory give one line:\n"
        "  <package> | REACHABLE | UNREACHABLE | UNKNOWN | <one sentence why>\n"
        "Then, for any you marked REACHABLE only, draft a `vector:` paragraph in "
        "the shape the register wants: what input, through which entry point, "
        "reaching which vulnerable call. Nothing else."
    )
    if verdict is None:
        lines.append(f"NOT JUDGED - {drafter.unavailable}. The advisories above stand unreviewed.")
    else:
        lines.extend([verdict, "", "Drafted, not decided. A human accepts before anything is pinned."])
    return "\n".join(lines)


def section_patches(drafter: Drafter) -> str:
    lines = ["## Patches that no longer apply", ""]
    if not PATCHES.is_dir():
        return "\n".join(lines + ["No patch directory."])

    stale = []
    for patch in sorted(PATCHES.glob("*.patch")):
        forward, _ = _run("git", "apply", "--check", str(patch))
        reverse, _ = _run("git", "apply", "--check", "-R", str(patch))
        if forward != 0 and reverse != 0:
            stale.append(patch)

    if not stale:
        return "\n".join(lines + ["Every carried patch still applies."])

    for patch in stale:
        body = patch.read_text(encoding="utf-8")
        target = ""
        for line in body.splitlines():
            if line.startswith("+++ b/"):
                target = line[6:].strip()
                break
        current = ""
        if target and (REPO_ROOT / target).is_file():
            current = (REPO_ROOT / target).read_text(encoding="utf-8")[:8000]

        lines.extend([f"### {patch.name}", ""])
        verdict = drafter.draft(
            f"A security patch this fork carries no longer applies after an "
            f"upstream merge.\n\nTHE PATCH:\n```diff\n{body[:6000]}\n```\n\n"
            f"THE FILE NOW ({target}):\n```\n{current}\n```\n\n"
            "Answer in this order:\n"
            "1. VERDICT: FIXED-UPSTREAM (delete the patch) or MOVED (re-derive it) "
            "or UNCLEAR.\n"
            "2. One paragraph of evidence - name the code that carries the fix now, "
            "or name what changed under the patch.\n"
            "3. If MOVED, the re-derived diff against the file as it now stands."
        )
        if verdict is None:
            lines.append(f"NOT JUDGED - {drafter.unavailable}.")
        else:
            lines.append(verdict)
        lines.append("")
    return "\n".join(lines)


def section_carried(drafter: Drafter) -> str:
    lines = ["## Can anything we carry be dropped?", ""]
    register = REGISTER.read_text(encoding="utf-8") if REGISTER.is_file() else ""
    patches = sorted(p.name for p in PATCHES.glob("*.patch")) if PATCHES.is_dir() else []

    if "overrides: []" in register and not patches:
        return "\n".join(lines + ["Nothing carried - the goal state."])

    _, log = _run("git", "log", "--oneline", "-80", "upstream/main")
    verdict = drafter.draft(
        f"THE REGISTER:\n```yaml\n{register[:4000]}\n```\n\n"
        f"CARRIED PATCHES: {', '.join(patches) or 'none'}\n\n"
        f"RECENT UPSTREAM COMMITS:\n{log[:6000]}\n\n"
        "For each carried pin or patch, say whether upstream appears to have "
        "landed an equivalent fix - possibly under a different shape, which a "
        "version comparison would miss. One line each:\n"
        "  <name> | LIKELY-FIXED-UPSTREAM | STILL-NEEDED | UNKNOWN | <why, citing a commit>"
    )
    if verdict is None:
        lines.append(f"NOT JUDGED - {drafter.unavailable}.")
    else:
        lines.extend([verdict, "", "A LIKELY-FIXED entry is a prompt to verify and unwind, not an instruction."])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--audit", action="store_true", help="Triage advisories for reachability.")
    parser.add_argument("--patches", action="store_true", help="Judge patches that stopped applying.")
    parser.add_argument("--carried", action="store_true", help="Has upstream fixed what we carry?")
    parser.add_argument("--model", default=None, help=f"Model id (default {DEFAULT_MODEL}).")
    parser.add_argument("-o", "--output", help="Write the report here as well as to stdout.")
    args = parser.parse_args()

    if not (args.audit or args.patches or args.carried):
        parser.error("choose at least one of --audit, --patches, --carried")

    drafter = Drafter(model=args.model)
    report = ["# Security triage", "", "Drafted for review. Nothing here has been applied.", ""]
    if args.audit:
        report.extend([section_audit(drafter), ""])
    if args.patches:
        report.extend([section_patches(drafter), ""])
    if args.carried:
        report.extend([section_carried(drafter), ""])

    text = "\n".join(report)
    print(text)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
