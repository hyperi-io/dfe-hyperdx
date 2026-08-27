#!/usr/bin/env bash
# Reclaims runner disk before a large image build, then asserts the headroom.
#
# The OTel contrib set does not fit in the 14 GB a hosted runner guarantees, and
# without the assert the shortfall surfaces inside a Go compile 900 seconds in.
#
# Measures the filesystem holding docker's data-root, NOT `/`. On a hosted
# runner they are the same; on ARC the daemon's storage can be a separate mount,
# where checking `/` reports headroom the build cannot use.
#
# Two levers, because the runners differ. A hosted runner carries ~8 GB of
# toolchains for languages this repo never builds, and a fresh builder with
# nothing to prune. A shared ARC daemon has no such toolchains and a builder
# cache that is the whole problem.
set -euo pipefail

REQUIRED_GB="${1:-40}"

docker_root() {
  docker info --format '{{.DockerRootDir}}' 2> /dev/null || true
}

TARGET="$(docker_root)"
[ -d "${TARGET:-}" ] || TARGET=/

free_gb() {
  df --output=avail --block-size=1G "$TARGET" | tail -1 | tr -d ' '
}

if [ "$(id -u)" -eq 0 ]; then
  as_root=()
elif command -v sudo > /dev/null 2>&1 && sudo -n true 2> /dev/null; then
  as_root=(sudo)
else
  as_root=()
  skip_toolchains=1
fi

before="$(free_gb)"
echo "Measuring ${TARGET} (docker data-root)"
echo "Free before cleanup: ${before} GB"

# Preinstalled toolchains for languages this repo does not build. Absent on ARC,
# and skipped without root because a self-hosted toolcache is shared state
# rather than per-job scratch.
if [ -n "${skip_toolchains:-}" ]; then
  echo "Not root and no passwordless sudo - skipping toolchain removal."
else
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
    "${AGENT_TOOLSDIRECTORY:-/opt/hostedtoolcache}" 2> /dev/null || true
fi

# The buildkit cache is what a previous multi-stage build left behind, so it is
# the lever that pays on a shared daemon. The gha cache this build reads is
# remote and unaffected.
docker builder prune --all --force > /dev/null 2>&1 || true
docker image prune --all --force > /dev/null 2>&1 || true

after="$(free_gb)"
echo "Free after cleanup:  ${after} GB (reclaimed $((after - before)) GB)"

if [ "${after}" -lt "${REQUIRED_GB}" ]; then
  echo "::error::Only ${after} GB free on ${TARGET}, need ${REQUIRED_GB} GB." \
    "The build would fail inside a Go compile rather than here."
  df -h "$TARGET"
  docker system df || true
  exit 1
fi
