#!/bin/bash

export FRONTEND_URL="${FRONTEND_URL:-${HYPERDX_APP_URL:-http://localhost}:${HYPERDX_APP_PORT:-8080}}"
export OPAMP_PORT=${HYPERDX_OPAMP_PORT:-4320}
export HYPERDX_IMAGE="hyperdx"

if [ "${NEXT_PUBLIC_IS_LOCAL_MODE}" = "true" ]; then
  export IS_LOCAL_APP_MODE="DANGEROUSLY_is_local_app_mode💀"
  echo "WARNING: HyperDX authentication is DISABLED (local mode). Every request runs unauthenticated - do NOT expose this image to untrusted networks." >&2
else
  export IS_LOCAL_APP_MODE="${IS_LOCAL_APP_MODE:-REQUIRED_AUTH}"
fi

if [ -z "${DEFAULT_CONNECTIONS}" ] && [ -f "${DEFAULT_CONNECTIONS_FILE}" ]; then
  export DEFAULT_CONNECTIONS="$(cat "${DEFAULT_CONNECTIONS_FILE}")"
fi
if [ -z "${DEFAULT_SOURCES}" ] && [ -f "${DEFAULT_SOURCES_FILE}" ]; then
  export DEFAULT_SOURCES="$(cat "${DEFAULT_SOURCES_FILE}")"
fi

if [ -z "${NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES}" ] && [ -f "${NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES_FILE}" ]; then
  export NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES="$(cat "${NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES_FILE}")"
fi

ENV_JS="/app/packages/app/packages/app/public/__ENV.js"
if [ -d "$(dirname "${ENV_JS}")" ]; then
  node -e 'const fs=require("fs");const e={};for(const k in process.env){if(k.indexOf("NEXT_PUBLIC_")===0){e[k]=process.env[k];}}fs.writeFileSync(process.argv[1],"window.__ENV = "+JSON.stringify(e)+";\n");' "${ENV_JS}"
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
