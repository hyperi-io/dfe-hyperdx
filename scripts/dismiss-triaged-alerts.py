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
# called". 'tolerable_risk' says we reach the sink and accept it anyway, so it
# is reserved for the entries that say so in their own reason - qs is the only
# one today. Never reach for it to make an unread alert go away.
VERDICTS: dict[str, tuple[str, str]] = {
    # Absent from the production image.
    "tar": ("not_used", f"{ABSENT} Reaches only via cacache and node-gyp."),
    "minimatch": ("not_used", ABSENT),
    "js-yaml": (
        "not_used",
        f"{ABSENT} Both copies are dev - 3.15.0 via jest, 4.1.1 via cosmiconfig.",
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
    "@babel/runtime": ("not_used", ABSENT),
    "smol-toml": ("not_used", f"{ABSENT} Reaches only via knip and nx."),
    "csv-parse": (
        "not_used",
        "Dev only - @changesets/cli via tty-table. Absent from the production "
        "image.",
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
    "ajv": ("not_used", "Resolves 8.20.0, above the < 8.18.0 range."),
    "cross-spawn": ("not_used", "Resolves 7.0.6, above the < 7.0.5 range."),
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
        "Our workspaces declare ^4.18.1 and resolve 4.18.1, above the range. "
        "The 4.17.x copies are dev only (@stoplight, concurrently, "
        "migrate-mongo) plus the browser SDK, which compiles no templates and "
        "takes no attacker-supplied paths.",
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
