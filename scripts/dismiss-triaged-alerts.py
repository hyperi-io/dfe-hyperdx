#!/usr/bin/env python3
# Project:   dfe-hyperdx
# File:      scripts/dismiss-triaged-alerts.py
# Purpose:   Dismiss Dependabot alerts we have triaged, with the reason attached
#
# License:   MIT (inherits upstream hyperdxio/hyperdx)
# Copyright: (c) 2026 HYPERI PTY LIMITED
"""Dismiss the Dependabot alerts a sync has judged unreachable.

An inherited fork collects alerts against upstream's dependency tree faster
than anyone reads them, and an unread queue is the same as no queue. This
applies a triage that has already been done and written up, so the verdict and
its reasoning end up on the alert itself rather than in someone's memory.

VERDICTS ARE DATA, NOT ARGUMENT. Every entry names a package and the reason its
alerts do not apply. The full trace lives in docs/fork/security-sync.md - the
comment here is capped at GitHub's 280 characters and points at it.

WHAT IS NOT HERE IS THE POINT. A package absent from this table keeps its
alerts open. systeminformation is deliberately absent: it is the one that was
real, and it is pinned in security/overrides.yaml instead.

Re-run it after a sync. Alerts GitHub has reopened against a new version are
picked up again, and anything new stays open until a human has looked at it.

--refresh also walks the DISMISSED alerts and re-dismisses any whose reason or
comment differs from its verdict, so a corrected verdict reaches the alerts
dismissed under the old one. GitHub only dismisses an open alert, so each is
reopened and then dismissed again. A dismissed alert with no verdict is left
alone.

    scripts/dismiss-triaged-alerts.py --dry-run
    scripts/dismiss-triaged-alerts.py
    scripts/dismiss-triaged-alerts.py --dry-run --refresh
    scripts/dismiss-triaged-alerts.py --refresh
"""

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass

REPO = "hyperi-io/dfe-hyperdx"
DOC = "docs/fork/security-sync.md"

# GitHub rejects a dismissed_comment over 280 characters, so each reason states
# the finding and defers the trace to the doc.
COMMENT_LIMIT = 280

ABSENT = (
    "Not in the shipped image. docker/hyperdx/Dockerfile:101 focuses "
    "@hyperdx/api --production, so the image carries 331 of 2691 packages and "
    "this one is not among them."
)

# package -> (dismissed_reason, why)
#
# 'not_used' is GitHub's reason for "the vulnerable code is not reachable
# here", which covers both "the package is absent" and "the sink is never
# called". 'tolerable_risk' says we reach the sink and accept it anyway, so it
# is reserved for the entries that say so in their own reason - qs is the only
# one today. Never reach for it to make an unread alert go away.
VERDICTS: dict[str, tuple[str, str]] = {
    # Absent from the production image.
    "tar": ("not_used", f"{ABSENT} Reaches only via cacache and node-gyp."),
    "minimatch": (
        "not_used",
        "Absent from the api focus. 3.1.2 ships only in Next's trace for "
        "pages/api/[...all], which loads the api only when "
        "HDX_PREVIEW_INLINE_API is 'true', and no DFE deploy sets it. 9.0.4 is "
        "dev only.",
    ),
    "js-yaml": (
        "not_used",
        "Absent from the api focus. 4.1.1 ships only in Next's trace for "
        "pages/api/[...all], which loads the api only when "
        "HDX_PREVIEW_INLINE_API is 'true', and no DFE deploy sets it. 3.15.0 is "
        "dev only, via jest.",
    ),
    "postcss": ("not_used", ABSENT),
    "nanoid": ("not_used", ABSENT),
    "image-size": (
        "not_used",
        f"{ABSENT} Dev only - @storybook/nextjs is its one parent.",
    ),
    "brace-expansion": ("not_used", ABSENT),
    "tmp": ("not_used", ABSENT),
    "nx": ("not_used", ABSENT),
    "serialize-javascript": ("not_used", ABSENT),
    "validator": ("not_used", ABSENT),
    "esbuild": ("not_used", ABSENT),
    "rollup": ("not_used", ABSENT),
    "sharp": ("not_used", ABSENT),
    "ws": ("not_used", ABSENT),
    "elliptic": ("not_used", ABSENT),
    "yaml": ("not_used", ABSENT),
    "@babel/runtime": (
        "not_used",
        "Dev via @changesets/cli. The image's Next trace ships only "
        "helpers/interopRequireDefault.js, not the regex helper the advisory "
        "concerns.",
    ),
    "smol-toml": ("not_used", f"{ABSENT} Reaches only via knip and nx."),
    "csv-parse": (
        "not_used",
        "Dev only - @changesets/cli via tty-table. Absent from the production image.",
    ),
    "@humanfs/node": (
        "not_used",
        "Dev only - eslint is its one parent. Absent from the production image.",
    ),
    "colord": (
        "not_used",
        "Dev only - stylelint is its one parent. Never reaches the image or the "
        "browser bundle.",
    ),
    "@vitest/mocker": (
        "not_used",
        "Dev only - @storybook/builder-webpack5 is its one parent. GitHub's "
        "scope field reads the lockfile, not the image, and calls this runtime.",
    ),
    "webpack-dev-middleware": (
        "not_used",
        "Dev only - @storybook/builder-webpack5 under @storybook/nextjs, an app "
        "devDependency, and only storybook dev serves it. GitHub's scope field "
        "reads the lockfile, not the image, and calls this runtime.",
    ),
    # Build-time only: they shape the bundle, they do not run in it.
    "browserslist": (
        "not_used",
        "Build-time only, via babel, webpack and next. Both advisories need an "
        "untrusted browserslist-stats.json; ours is a repo file, never input.",
    ),
    "baseline-browser-mapping": (
        "not_used",
        "Build-time only, via browserslist and next target resolution. It never "
        "runs at request time and never reaches the browser bundle.",
    ),
    "postcss-selector-parser": (
        "not_used",
        "Build-time CSS only - postcss-modules, postcss-nested, stylelint. "
        "Selectors come from our own stylesheets, never from a request.",
    ),
    # In the image, but the version we resolve is outside the advisory range.
    "ajv": (
        "not_used",
        "The image resolves 8.20.0, above both the < 6.14.0 and < 8.18.0 "
        "ranges. The 6.12.6 copy is build tooling - schema-utils 3 under the "
        "webpack plugins.",
    ),
    "cross-spawn": (
        "not_used",
        "The image resolves 7.0.6, above both the < 6.0.6 and < 7.0.5 ranges. "
        "The 5.1.0 copy is dev only - spawndamnit under @changesets/cli.",
    ),
    "semver": (
        "not_used",
        "Every image copy resolves 7.5.2 or later, outside both ranges. The "
        "5.7.1 and 7.0.0 copies are dev only - nodemon, simple-update-notifier "
        "and @changesets/cli.",
    ),
    "@hono/node-server": (
        "not_used",
        "Resolves 1.19.17, below the >= 2.0.0 range. The traversal is also "
        "Windows-only and the image is Linux.",
    ),
    "axios": (
        "not_used",
        "The image's copy, via @slack/webhook, resolves 1.20.0, the fix. The "
        "1.18.1 these match is nx's exact pin, a root devDependency absent from "
        "the image, and nx 23.2.1 still pins it.",
    ),
    # In the image and in range, but nothing an attacker can drive.
    "fast-uri": (
        "not_used",
        "Resolves 3.1.4, INSIDE the < 3.1.6 ranges. Reached only by ajv via the "
        "MCP SDK, which parses URIs from our own schemas and fetches none, so "
        "host confusion has no requester behind it. /mcp is service-only.",
    ),
    "fflate": (
        "not_used",
        "Ships in the browser bundle via rrweb and the session recorder, which "
        "compress. The advisory is unzipSync on malformed ZIP64 and nothing "
        "here unzips anything.",
    ),
    "@ai-sdk/provider-utils": (
        "not_used",
        "In the image, but /ai/assistant throws unless AI_PROVIDER or "
        "ANTHROPIC_API_KEY is set and DFE sets neither. Request text is capped "
        "at 10000 chars by zod before the SDK sees it.",
    ),
    "path-to-regexp": (
        "not_used",
        "ReDoS is in route-pattern compilation. Route patterns are our own "
        "source; an attacker supplies a URL, never a route definition.",
    ),
    "picomatch": (
        "not_used",
        "ReDoS needs a crafted glob. Our globs come from config, and every "
        "parent here is build tooling - jest, rollup, knip, micromatch.",
    ),
    "protobufjs": (
        "not_used",
        "@hyperdx/browser inlines protobufjs/minimal as a prebuilt bundle, "
        "so the recorder's old copy never ships to the browser. The advisory "
        "also needs an attacker-controlled descriptor via reflection; we "
        "decode OTLP against a compiled schema.",
    ),
    "lodash": (
        "not_used",
        "Our workspaces resolve 4.18.1, above the range. concurrently runs the "
        "entrypoint on its own 4.17.21 and never calls template, unset or omit. "
        "Other 4.17.x copies are dev or the browser SDK, which compiles no "
        "templates and takes no attacker paths.",
    ),
    # OpenTelemetry: in range. bin/hyperdx preloads a tracing NodeSDK whenever
    # HYPERDX_API_KEY or OTEL_EXPORTER_OTLP_HEADERS is set; index.ts starts
    # metrics separately either way.
    "@opentelemetry/core": (
        "tolerable_risk",
        "Reached: bin/hyperdx's preload starts a NodeSDK whenever "
        "HYPERDX_API_KEY or OTEL_EXPORTER_OTLP_HEADERS is set, defaulting to "
        "tracecontext plus baggage propagators. Bounded by Node's 16 KB "
        "header cap, so tolerable.",
    ),
    "@opentelemetry/propagator-jaeger": (
        "not_used",
        "Needs OTEL_PROPAGATORS to include jaeger. That string appears nowhere "
        "in the repo - not code, compose or env - and OTel defaults to "
        "tracecontext plus baggage.",
    ),
    "@opentelemetry/exporter-prometheus": (
        "not_used",
        "The crash needs the exporter's own HTTP server. The preloaded "
        "NodeSDK builds it (sdk.js:105-106, port 9464) only when "
        "OTEL_METRICS_EXPORTER includes prometheus, and nothing sets that. "
        "Our metrics endpoint is prom-client in metrics.ts.",
    ),
    "@opentelemetry/sdk-node": (
        "not_used",
        "Same Prometheus exporter crash. bin/hyperdx's preload does start "
        "this SDK, but the exporter binds only when OTEL_METRICS_EXPORTER "
        "includes prometheus, and nothing sets that.",
    ),
    "@opentelemetry/auto-instrumentations-node": (
        "not_used",
        "Same Prometheus exporter crash. bin/hyperdx's preload does start "
        "this SDK, but the exporter binds only when OTEL_METRICS_EXPORTER "
        "includes prometheus, and nothing sets that.",
    ),
    # Already above the range on the copy that matters.
    "ip-address": (
        "not_used",
        "packages/api/package.json declares ^10.3.1 and the lock resolves "
        "10.3.1, above the <= 10.3.0 range. isPrivateIp uses that copy. "
        "RE-CHECK EVERY SYNC - a merge dragging it below 10.3.1 makes this a "
        "real unauthenticated SSRF.",
    ),
    "fast-xml-parser": ("not_used", "Upstream already pins ^4.5.6."),
    # Medium or low with no reachable sink.
    "hono": (
        "not_used",
        "In the image via @modelcontextprotocol/sdk, never imported. No Hono "
        "app is constructed - api/src/mcp/app.ts runs "
        "StreamableHTTPServerTransport on an express router.",
    ),
    # The one sink an attacker DOES reach. Medium, so below the pin bar.
    "qs": (
        "tolerable_risk",
        "Reached: express parses req.query and body-parser urlencoded bodies "
        "with qs 6.14.2/6.15.3. Both advisories are medium DoS, below the pin "
        "bar, and the caller is an OIDC-authenticated tenant user.",
    ),
    "uuid": ("not_used", "No call site reaches the vulnerable path."),
    "bn.js": ("not_used", "No call site reaches the vulnerable path."),
}


@dataclass(frozen=True, slots=True)
class StaleDismissal:
    """A dismissed alert whose reason or comment differs from its verdict.

    Attributes:
        number: Alert number.
        package: Package the alert is raised against.
        old_reason: The dismissed_reason GitHub holds now.
        new_reason: The dismissed_reason the verdict records.
        comment_changes: Whether the dismissed_comment differs from the verdict's.
        body: The dismissed_comment to write.
    """

    number: int
    package: str
    old_reason: str
    new_reason: str
    comment_changes: bool
    body: str


def dismissal_body(comment: str) -> str:
    """Return the dismissed_comment written for a verdict's comment."""
    return f"{comment} See {DOC}."


def stale_dismissals(
    dismissed: list[dict], verdicts: dict[str, tuple[str, str]]
) -> list[StaleDismissal]:
    """List the dismissed alerts that disagree with their verdict.

    Args:
        dismissed: Dismissed alerts as the Dependabot API returns them.
        verdicts: package -> (dismissed_reason, comment), shaped like VERDICTS.

    Returns:
        One entry per alert to re-dismiss. An alert with no verdict is omitted.
    """
    stale = []
    for alert in dismissed:
        package = alert["dependency"]["package"]["name"]
        verdict = verdicts.get(package)
        if verdict is None:
            continue
        reason, comment = verdict
        body = dismissal_body(comment)
        old_reason = alert.get("dismissed_reason") or ""
        comment_changes = (alert.get("dismissed_comment") or "") != body
        if old_reason == reason and not comment_changes:
            continue
        stale.append(
            StaleDismissal(
                alert["number"], package, old_reason, reason, comment_changes, body
            )
        )
    return stale


def gh(args: list[str]) -> str:
    """Run gh and return stdout, raising with stderr attached on failure."""
    result = subprocess.run(
        ["gh", *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def alerts(state: str) -> list[dict]:
    """Return every Dependabot alert in one state.

    Args:
        state: The state the API filters on, such as open or dismissed.

    Returns:
        The alerts across every page.
    """
    raw = gh(
        [
            "api",
            f"repos/{REPO}/dependabot/alerts",
            "--paginate",
            "-X",
            "GET",
            "-f",
            f"state={state}",
            "-f",
            "per_page=100",
        ]
    )
    return json.loads(raw)


def patch(number: int, fields: list[str]) -> None:
    """Send one PATCH to an alert.

    Args:
        number: Alert number.
        fields: key=value pairs for the request body.
    """
    args = ["api", "-X", "PATCH", f"repos/{REPO}/dependabot/alerts/{number}"]
    for field in fields:
        args += ["-f", field]
    gh([*args, "--silent"])


def dismiss(number: int, reason: str, body: str) -> None:
    """Dismiss an open alert with its reason and comment.

    Args:
        number: Alert number.
        reason: GitHub's dismissed_reason.
        body: The dismissed_comment, already within COMMENT_LIMIT.
    """
    patch(
        number,
        ["state=dismissed", f"dismissed_reason={reason}", f"dismissed_comment={body}"],
    )


def dismiss_open(dry_run: bool) -> None:
    """Dismiss every open alert that has a verdict, and keep the rest open.

    Args:
        dry_run: Print what would be dismissed without changing anything.
    """
    found = alerts("open")
    dismissed = skipped = 0

    for alert in found:
        package = alert["dependency"]["package"]["name"]
        number = alert["number"]
        verdict = VERDICTS.get(package)
        if verdict is None:
            print(f"  KEEP  #{number} {package} - no verdict recorded")
            skipped += 1
            continue

        reason, comment = verdict
        if dry_run:
            print(f"  would dismiss #{number} {package} ({reason})")
        else:
            dismiss(number, reason, dismissal_body(comment))
            print(f"  dismissed #{number} {package}")
        dismissed += 1

    verb = "would dismiss" if dry_run else "dismissed"
    print(f"\n{verb} {dismissed}, kept {skipped} open of {len(found)}.")


def refresh_dismissed(dry_run: bool) -> None:
    """Re-dismiss every dismissed alert whose reason or comment has gone stale.

    Args:
        dry_run: Print what would change without changing anything.

    Raises:
        RuntimeError: A re-dismiss failed after its reopen, which leaves that
            alert open until a plain run dismisses it.
    """
    dismissed = alerts("dismissed")
    unrecorded = 0
    for alert in dismissed:
        package = alert["dependency"]["package"]["name"]
        if package not in VERDICTS:
            print(f"  KEEP  #{alert['number']} {package} - no verdict recorded")
            unrecorded += 1

    stale = stale_dismissals(dismissed, VERDICTS)
    verb = "would refresh" if dry_run else "refreshed"
    for item in stale:
        if not dry_run:
            patch(item.number, ["state=open"])
            try:
                dismiss(item.number, item.new_reason, item.body)
            except RuntimeError as exc:
                raise RuntimeError(
                    f"#{item.number} is reopened but not dismissed; a plain run "
                    f"dismisses it again. {exc}"
                ) from exc
        comment = "comment changes" if item.comment_changes else "comment unchanged"
        print(
            f"  {verb} #{item.number} {item.package}: "
            f"{item.old_reason} -> {item.new_reason}, {comment}"
        )

    current = len(dismissed) - len(stale) - unrecorded
    print(
        f"\n{verb} {len(stale)}, {current} already match, {unrecorded} have no "
        f"verdict, of {len(dismissed)} dismissed."
    )


def main() -> int:
    """Check every verdict fits GitHub's limit, then apply the verdicts."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="Print what would change."
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Also re-dismiss dismissed alerts whose reason or comment differs "
        "from the current verdict.",
    )
    args = parser.parse_args()

    for package, (_, comment) in VERDICTS.items():
        full = dismissal_body(comment)
        if len(full) > COMMENT_LIMIT:
            print(
                f"{package}: comment is {len(full)} chars, limit is "
                f"{COMMENT_LIMIT}. Shorten it.",
                file=sys.stderr,
            )
            return 1

    dismiss_open(args.dry_run)
    if args.refresh:
        print()
        refresh_dismissed(args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
