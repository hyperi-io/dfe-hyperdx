#!/usr/bin/env bash
# Wrapper for yarn npm audit - Yarn 4+ (Berry) removed the built-in audit command,
# so we use "yarn npm audit" which works with yarn.lock. Parses --level from CI args.

set -euo pipefail

LEVEL="moderate"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --level)
      LEVEL="${2:-moderate}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

exec yarn npm audit --severity="$LEVEL"
