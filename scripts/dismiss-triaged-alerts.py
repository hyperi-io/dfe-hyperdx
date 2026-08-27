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

    scripts/dismiss-triaged-alerts.py --dry-run
    scripts/dismiss-triaged-alerts.py
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

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
# called". 'tolerable_risk' would claim we accept a live risk, and none of
# these are live.
VERDICTS: dict[str, tuple[str, str]] = {
    # Absent from the production image.
    "tar": ("not_used", f"{ABSENT} Reaches only via cacache and node-gyp."),
    "minimatch": ("not_used", ABSENT),
    "js-yaml": ("not_used", ABSENT),
    "postcss": ("not_used", ABSENT),
    "nanoid": ("not_used", ABSENT),
    "image-size": ("not_used", ABSENT),
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
    "@babel/runtime": ("not_used", ABSENT),
    # In the image, but the version we resolve is outside the advisory range.
    "ajv": ("not_used", "Resolves 8.20.0, above the < 8.18.0 range."),
    "cross-spawn": ("not_used", "Resolves 7.0.6, above the < 7.0.5 range."),
    "fast-uri": ("not_used", "Resolves 3.1.4, above both 2.x ranges."),
    "semver": (
        "not_used",
        "Resolves 6.3.1, BELOW the >= 7.0.0 range rather than above it.",
    ),
    "@hono/node-server": (
        "not_used",
        "Resolves 1.19.17, below the >= 2.0.0 range. The traversal is also "
        "Windows-only and the image is Alpine.",
    ),
    # In the image and in range, but nothing an attacker can drive.
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
        "The advisory needs an attacker-controlled definition or JSON "
        "descriptor loaded through reflection, and says applications decoding "
        "with trusted schemas are not affected. We serialise OTLP against a "
        "compiled schema and load no descriptor.",
    ),
    "lodash": (
        "not_used",
        "Our workspaces declare ^4.18.1 and resolve 4.18.1, above the range. "
        "The 4.17.x copies are dev only (@stoplight, concurrently, "
        "migrate-mongo) plus the browser SDK, which compiles no templates and "
        "takes no attacker-supplied paths.",
    ),
    # OpenTelemetry: in range, but api/src/index.ts starts metrics only.
    "@opentelemetry/core": (
        "not_used",
        "Baggage propagation needs a propagator on a tracing SDK. "
        "packages/api/src/index.ts starts a MeterProvider and HostMetrics "
        "only - no NodeSDK, no tracer, no propagators registered.",
    ),
    "@opentelemetry/propagator-jaeger": (
        "not_used",
        "Needs OTEL_PROPAGATORS to include jaeger. That string appears nowhere "
        "in the repo - not code, compose or env - and OTel defaults to "
        "tracecontext plus baggage.",
    ),
    "@opentelemetry/exporter-prometheus": (
        "not_used",
        "The crash needs the exporter's own HTTP server. We never instantiate "
        "it; our metrics endpoint is prom-client directly in "
        "dfe/observability/metrics.ts. It arrives only because sdk-node "
        "bundles every exporter.",
    ),
    "@opentelemetry/sdk-node": (
        "not_used",
        "Same Prometheus exporter crash. No exporter is instantiated - "
        "packages/api/src/index.ts starts metrics only.",
    ),
    "@opentelemetry/auto-instrumentations-node": (
        "not_used",
        "Same Prometheus exporter crash. No exporter is instantiated - "
        "packages/api/src/index.ts starts metrics only.",
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
    "hono": ("not_used", "No reachable sink; the server does not route through hono."),
    "qs": ("not_used", "No call site passes request-derived input to the sink."),
    "uuid": ("not_used", "No call site reaches the vulnerable path."),
    "bn.js": ("not_used", "No call site reaches the vulnerable path."),
}


def gh(args: list[str]) -> str:
    """Run gh and return stdout, raising with stderr attached on failure."""
    result = subprocess.run(
        ["gh", *args], capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def open_alerts() -> list[dict]:
    raw = gh(
        [
            "api",
            f"repos/{REPO}/dependabot/alerts",
            "--paginate",
            "-X",
            "GET",
            "-f",
            "state=open",
            "-f",
            "per_page=100",
        ]
    )
    return json.loads(raw)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="Print what would be dismissed."
    )
    args = parser.parse_args()

    for package, (_, comment) in VERDICTS.items():
        full = f"{comment} See {DOC}."
        if len(full) > COMMENT_LIMIT:
            print(
                f"{package}: comment is {len(full)} chars, limit is "
                f"{COMMENT_LIMIT}. Shorten it.",
                file=sys.stderr,
            )
            return 1

    alerts = open_alerts()
    dismissed = skipped = 0

    for alert in alerts:
        package = alert["dependency"]["package"]["name"]
        number = alert["number"]
        verdict = VERDICTS.get(package)
        if verdict is None:
            print(f"  KEEP  #{number} {package} - no verdict recorded")
            skipped += 1
            continue

        reason, comment = verdict
        body = f"{comment} See {DOC}."
        if args.dry_run:
            print(f"  would dismiss #{number} {package} ({reason})")
            dismissed += 1
            continue

        gh(
            [
                "api",
                "-X",
                "PATCH",
                f"repos/{REPO}/dependabot/alerts/{number}",
                "-f",
                "state=dismissed",
                "-f",
                f"dismissed_reason={reason}",
                "-f",
                f"dismissed_comment={body}",
                "--silent",
            ]
        )
        print(f"  dismissed #{number} {package}")
        dismissed += 1

    verb = "would dismiss" if args.dry_run else "dismissed"
    print(f"\n{verb} {dismissed}, kept {skipped} open of {len(alerts)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
