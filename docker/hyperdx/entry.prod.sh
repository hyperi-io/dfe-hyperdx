#!/bin/bash

export FRONTEND_URL="${FRONTEND_URL:-${HYPERDX_APP_URL:-http://localhost}:${HYPERDX_APP_PORT:-8080}}"
export OPAMP_PORT=${HYPERDX_OPAMP_PORT:-4320}
export HYPERDX_IMAGE="hyperdx"

# API auth mode. Safe default is REQUIRED_AUTH. When the image was built in
# local mode (NEXT_PUBLIC_IS_LOCAL_MODE=true, e.g. dfe-docker's no-auth local
# observability stack), default to the no-auth mode so the client and server
# agree - the client skips login in local mode, so REQUIRED_AUTH would break it.
# An explicit IS_LOCAL_APP_MODE in the environment always wins.
if [ "${NEXT_PUBLIC_IS_LOCAL_MODE}" = "true" ]; then
  export IS_LOCAL_APP_MODE="${IS_LOCAL_APP_MODE:-DANGEROUSLY_is_local_app_mode💀}"
else
  export IS_LOCAL_APP_MODE="${IS_LOCAL_APP_MODE:-REQUIRED_AUTH}"
fi

echo ""
echo "Visit the HyperDX UI at $FRONTEND_URL"
echo ""

# Use concurrently to run both the API and App servers
concurrently \
  "--kill-others-on-fail" \
  "--names=API,APP,ALERT-TASK" \
  "PORT=${HYPERDX_API_PORT:-8000} HYPERDX_APP_PORT=${HYPERDX_APP_PORT:-8080} node -r ./node_modules/@hyperdx/node-opentelemetry/build/src/tracing ./packages/api/build/index.js" \
  "cd ./packages/app/packages/app && HOSTNAME='${HYPERDX_APP_LISTEN_HOSTNAME:-0.0.0.0}' HYPERDX_API_PORT=${HYPERDX_API_PORT:-8000} PORT=${HYPERDX_APP_PORT:-8080} node server.js" \
  "node -r ./node_modules/@hyperdx/node-opentelemetry/build/src/tracing ./packages/api/build/tasks/index.js check-alerts"
