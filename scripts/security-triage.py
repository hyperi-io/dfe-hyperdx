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

  --audit     Dependabot says HIGH. Is the vulnerable path REACHABLE in how DFE
              runs this fork? Drafts the `vector` prose the register demands, or
              says the advisory is unreachable and why.
  --code      Scanner findings on lines WE wrote (they gate the build). Real, or
              a false positive, and the `reason:` prose if the latter.
  --patches   A carried patch stopped applying after a merge. Did upstream fix
              it their own way, or did the code just move? Drafts which, and for
              a move, the re-derived hunk.
  --carried   For each pin and patch we still hold, has upstream landed an
              equivalent fix under a different shape? Version comparison misses
              this; reading the code does not.

MECHANICAL FIRST. Every finding answered deterministically is one that needs no
key, no network and no human, so the existing signals do as much as they can
before anything reaches the model: Dependabot's `scope` field settles
development-only advisories outright, and `attribute-findings.py` has already
sorted scanner findings into ours/inherited so only ours get drafted. The model
is asked the residue, not the pile.

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


def origin_slug() -> str:
    """`owner/repo` for the ORIGIN remote, or '' when it cannot be determined.

    Never use gh's `{owner}/{repo}` placeholders here. A fork always has two
    remotes, and with no default set gh resolves them to UPSTREAM - so the
    alerts query asks hyperdxio/hyperdx for its Dependabot data and gets a 403
    that reads like a missing token scope.
    """
    code, url = _run("git", "remote", "get-url", "origin")
    if code != 0 or not url.strip():
        return ""
    slug = url.strip().removesuffix(".git")
    if slug.startswith("git@"):
        slug = slug.partition(":")[2]
    elif "://" in slug:
        slug = slug.partition("://")[2].partition("/")[2]
    parts = [p for p in slug.split("/") if p]
    return "/".join(parts[-2:]) if len(parts) >= 2 else ""


def collect_dependabot() -> list[dict]:
    """Open high/critical Dependabot alerts, via the authenticated gh CLI.

    PREFERRED OVER `yarn npm audit` for one field: `dependency.scope`. A
    development-scoped advisory is in build tooling that never reaches the
    shipped image, which answers the reachability question outright and for
    free. Yarn's audit does not surface it, so every finding had to go to the
    model.

    Returns [] when gh is absent, unauthenticated, or the repo has alerts off,
    so the caller can fall back rather than report nothing.
    """
    slug = origin_slug()
    if not slug:
        return []
    code, out = _run(
        "gh",
        "api",
        f"repos/{slug}/dependabot/alerts?state=open&severity=critical,high&per_page=100",
        "--paginate",
    )
    if code != 0:
        return []
    try:
        alerts = json.loads(out)
    except json.JSONDecodeError:
        return []
    if not isinstance(alerts, list):
        return []

    collected: list[dict] = []
    for alert in alerts:
        dependency = alert.get("dependency") or {}
        advisory = alert.get("security_advisory") or {}
        vuln = alert.get("security_vulnerability") or {}
        collected.append(
            {
                "package": (dependency.get("package") or {}).get("name", "?"),
                "scope": dependency.get("scope") or "unknown",
                "manifest": dependency.get("manifest_path", ""),
                "severity": advisory.get("severity", "unknown"),
                "issue": advisory.get("summary", ""),
                "url": alert.get("html_url", ""),
                "range": (vuln.get("vulnerable_version_range") or ""),
                "patched": ((vuln.get("first_patched_version") or {}).get("identifier") or ""),
                "source": "dependabot",
            }
        )
    return collected


def collect_yarn_audit() -> list[dict]:
    """Fallback advisory source: `yarn npm audit`.

    Yarn exits non-zero when it finds anything, so the return code carries no
    error information and is deliberately ignored. No scope field here, so
    everything it returns has to be judged.
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
                "scope": "unknown",
                "manifest": "",
                "severity": children.get("Severity", "unknown"),
                "issue": children.get("Issue", ""),
                "url": children.get("URL", ""),
                "range": children.get("Vulnerable Versions", ""),
                "patched": children.get("Patched Versions", ""),
                "source": "yarn",
            }
        )
    return advisories


def collect_audit() -> tuple[list[dict], list[dict], str]:
    """Advisories split into (to_judge, answered_by_scope, provenance note).

    Every advisory answered mechanically is one that needs no key, no network
    and no human, so the split happens BEFORE anything reaches the model.
    """
    advisories = collect_dependabot()
    source = "Dependabot"
    if not advisories:
        advisories = collect_yarn_audit()
        source = "yarn npm audit (Dependabot unavailable)"

    if not advisories:
        return [], [], "No high or critical advisories reported."

    dev = [a for a in advisories if a["scope"] == "development"]
    rest = [a for a in advisories if a["scope"] != "development"]
    note = (
        f"{len(advisories)} high/critical advisory(ies) from {source}; "
        f"{len(dev)} development-scoped, {len(rest)} to judge."
    )
    return rest, dev, note


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
    advisories, dev_scoped, summary = collect_audit()
    lines = ["## Advisory triage", "", summary, ""]

    # Answered without a model: build tooling is not in the shipped image, so
    # the vulnerable path is not reachable in how DFE runs this fork.
    if dev_scoped:
        packages = ", ".join(sorted({a["package"] for a in dev_scoped}))
        lines += [
            f"**{len(dev_scoped)} answered by scope** - development-only "
            "dependencies, not present in the shipped image, so there is no "
            "runtime path to the vulnerable code.",
            "",
            f"<details><summary>{packages}</summary></details>",
            "",
        ]

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
        f"- {a['package']} [{a['severity']}, {a['scope']}] {a['issue']} "
        f"(vulnerable {a['range']}, patched {a['patched'] or 'none'}) {a['url']}"
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


def section_code(drafter: Drafter, attribution: Path) -> str:
    """Scanner findings, sorted by who wrote the line.

    Reads the buckets `attribute-findings.py --json` already computed rather
    than re-deriving them. Attribution is the expensive part and having two
    implementations of "is this line ours" is how they drift apart.
    """
    lines = ["## Code findings", ""]
    if not attribution.is_file():
        return "\n".join(
            lines
            + [
                f"No attribution file at `{attribution}`. Produce one with:",
                "",
                "```",
                "semgrep --config p/default --sarif --output semgrep.sarif",
                "scripts/attribute-findings.py semgrep.sarif --json attribution.json",
                "```",
            ]
        )

    try:
        data = json.loads(attribution.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return "\n".join(lines + [f"Could not read `{attribution}`: {exc}"])

    ours = data.get("ours") or []
    inherited = data.get("inherited") or []
    accepted = data.get("accepted") or []
    lines.append(
        f"{len(ours)} ours (gating), {len(accepted)} accepted, "
        f"{len(inherited)} inherited from upstream."
    )
    lines.append("")

    if not ours:
        lines.append("Nothing unreviewed in our own code - nothing to judge.")
        return "\n".join(lines)

    listing = "\n".join(
        f"- {f['path']}:{f.get('line', '?')} [{f.get('level', '?')}] {f.get('rule', '?')}\n"
        f"  {f.get('message', '')[:200]}"
        for f in ours[:MAX_ADVISORIES]
    )
    verdict = drafter.draft(
        f"{describe_deployment()}\n\n"
        f"These scanner findings are on lines WE wrote in a fork - they gate the "
        f"build, so a wrong call here is expensive in both directions.\n\n"
        f"{listing}\n\n"
        "For each, one line:\n"
        "  <path:line> | REAL | FALSE-POSITIVE | UNKNOWN | <one sentence why>\n"
        "For any marked FALSE-POSITIVE, draft the `reason:` prose for "
        "security/accepted.yaml - it must say why the reported condition CANNOT "
        "happen here, not that the rule is noisy."
    )
    if verdict is None:
        lines.append(f"NOT JUDGED - {drafter.unavailable}.")
    else:
        lines += [verdict, "", "Drafted. A human accepts before anything is suppressed."]
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
    parser.add_argument(
        "--code",
        action="store_true",
        help="Judge scanner findings attributed to us (needs --attribution).",
    )
    parser.add_argument("--patches", action="store_true", help="Judge patches that stopped applying.")
    parser.add_argument("--carried", action="store_true", help="Has upstream fixed what we carry?")
    parser.add_argument(
        "--attribution",
        type=Path,
        default=REPO_ROOT / "attribution.json",
        help="Buckets from `attribute-findings.py --json` (default ./attribution.json).",
    )
    parser.add_argument("--model", default=None, help=f"Model id (default {DEFAULT_MODEL}).")
    parser.add_argument("-o", "--output", help="Write the report here as well as to stdout.")
    args = parser.parse_args()

    if not (args.audit or args.code or args.patches or args.carried):
        parser.error("choose at least one of --audit, --code, --patches, --carried")

    drafter = Drafter(model=args.model)
    report = ["# Security triage", "", "Drafted for review. Nothing here has been applied.", ""]
    if args.audit:
        report.extend([section_audit(drafter), ""])
    if args.code:
        report.extend([section_code(drafter, args.attribution), ""])
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
