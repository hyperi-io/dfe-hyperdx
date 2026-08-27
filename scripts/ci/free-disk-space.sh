#!/usr/bin/env bash
# Reclaims runner disk before a large image build, then asserts the headroom.
#
# The OTel contrib set does not fit in the 14 GB a hosted runner guarantees, and
# without the assert the shortfall surfaces inside a Go compile 900 seconds in.
#
# The cleanup targets a GitHub-hosted image and is skipped anywhere it cannot
# run as root, because the toolcache on a self-hosted runner is shared state
# rather than per-job scratch. The assert still runs everywhere - a runner with
# the headroom passes on its own merits, one without fails here naming the
# number instead of dying in a Go compile.
set -euo pipefail

REQUIRED_GB="${1:-40}"

free_gb() {
  df --output=avail --block-size=1G / | tail -1 | tr -d ' '
}

if [ "$(id -u)" -eq 0 ]; then
  as_root=()
elif command -v sudo > /dev/null 2>&1 && sudo -n true 2>/dev/null; then
  as_root=(sudo)
else
  as_root=()
  skip_cleanup=1
fi

before="$(free_gb)"
echo "Free on / before cleanup: ${before} GB"

if [ -n "${skip_cleanup:-}" ]; then
  echo "Not root and no passwordless sudo - skipping cleanup, asserting only."
else
  # Preinstalled toolchains for languages this repo does not build; the callers
  # use only docker, curl and the runner's own node.
  "${as_root[@]}" rm -rf \
    /usr/local/lib/android \
    /usr/share/dotnet \
    /usr/local/.ghcup \
    /opt/ghc \
    /usr/share/swift \
    /usr/local/share/powershell \
    /usr/local/share/boost \
    /usr/local/lib/node_modules \
    /opt/hostedtoolcache \
    "${AGENT_TOOLSDIRECTORY:-/opt/hostedtoolcache}" 2>/dev/null || true

  "${as_root[@]}" docker image prune --all --force > /dev/null 2>&1 || true
fi

after="$(free_gb)"
echo "Free on / after cleanup:  ${after} GB (reclaimed $((after - before)) GB)"

if [ "${after}" -lt "${REQUIRED_GB}" ]; then
  echo "::error::Only ${after} GB free on / after cleanup, need ${REQUIRED_GB} GB." \
    "The build would fail inside a Go compile rather than here."
  df -h /
  exit 1
fi
