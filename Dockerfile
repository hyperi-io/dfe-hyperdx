# Project:   dfe-hyperdx
# File:      Dockerfile
# Purpose:   production container image (API + App) published to GHCR by hyperi-ci
#
# License:   MIT
# Copyright: (c) 2026 HYPERI PTY LIMITED
#
# Auto-built + published to ghcr.io/hyperi-io/dfe-hyperdx by hyperi-ci
# (publish.container in .hyperi-ci.yaml). This is a self-contained, flattened
# equivalent of the `prod` target in docker/hyperdx/Dockerfile: it builds with a
# plain `docker build .` (no --build-context, no --target) because hyperi-ci's
# container stage drives a single, contextless build.
#
# Scope: the API + App service image only. It shares an external ClickHouse
# (dfe-docker) and talks to FerretDB/Mongo at runtime -- ClickHouse, Mongo and
# the OTel collector are NOT bundled here (that is upstream's all-in-one target,
# deliberately excluded). Runtime config (connections, sources, theme, auth
# mode) comes from env at container start, not baked into the image.

# Tag and digest travel as one value, so a bump or a --build-arg override replaces both.
# Debian trixie, not upstream's Alpine: on glibc the prebuilt native bindings load their -gnu builds with no compat shim.
ARG NODE_IMAGE=node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe

# base ############################################################################################
# Install and build run on the build host's arch: their output is platform-independent JS, and an emulated Next build times out.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS node_base

WORKDIR /app

COPY .yarn ./.yarn
COPY .yarnrc.yml yarn.lock package.json nx.json .prettierrc .prettierignore ./tsconfig.base.json ./
COPY ./packages/common-utils ./packages/common-utils
COPY ./packages/api/jest.config.js ./packages/api/tsconfig.json ./packages/api/tsconfig.build.json ./packages/api/package.json ./packages/api/
COPY ./packages/app/jest.config.js ./packages/app/tsconfig.json ./packages/app/tsconfig.build.json ./packages/app/package.json ./packages/app/next.config.mjs ./packages/app/mdx.d.ts ./packages/app/css.d.ts ./packages/app/eslint.config.mjs ./packages/app/

# Every published arch's prebuilt packages, so the Next trace carries each and app_tree keeps the target's.
RUN yarn config set supportedArchitectures.cpu --json '["x64","arm64"]' \
    && yarn install --mode=skip-build && yarn cache clean


# builder #########################################################################################
FROM node_base AS builder

WORKDIR /app

# Flattened build contexts: copy source straight from the repo root instead of
# --build-context api=./packages/api / app=./packages/app.
COPY ./packages/api/src ./packages/api/src
COPY ./packages/app/src ./packages/app/src
COPY ./packages/app/pages ./packages/app/pages
COPY ./packages/app/public ./packages/app/public
COPY ./packages/app/styles ./packages/app/styles
COPY ./packages/app/types ./packages/app/types
# Next only finds the proxy file beside pages/, and it is what sends the embed
# frame-ancestors CSP; without it the image answers with no CSP at all.
COPY ./packages/app/proxy.ts ./packages/app/proxy.ts
# next.config.mjs copies this into public/ for the in-app "What's new" viewer
# and THROWS when it is absent, so the app build needs it in the context.
COPY ./CHANGELOG.md ./CHANGELOG.md

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT_STANDALONE=true
ARG NEXT_PUBLIC_IS_LOCAL_MODE=false
ENV NEXT_PUBLIC_IS_LOCAL_MODE=$NEXT_PUBLIC_IS_LOCAL_MODE
ARG NEXT_PUBLIC_HDX_LOCAL_DEFAULT_CONNECTIONS=
ENV NEXT_PUBLIC_HDX_LOCAL_DEFAULT_CONNECTIONS=$NEXT_PUBLIC_HDX_LOCAL_DEFAULT_CONNECTIONS
ARG NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES=
ENV NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES=$NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES

ARG NEXT_PUBLIC_THEME=hyperi
ENV NEXT_PUBLIC_THEME=$NEXT_PUBLIC_THEME
ENV NX_DAEMON=false
RUN npx nx run-many --target=build --projects=@hyperdx/common-utils,@hyperdx/api,@hyperdx/app


# prod_deps #######################################################################################
# The api's production dependencies, resolved for the target arch alone.
FROM node_base AS prod_deps

ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) cpu=x64 ;; \
      arm64) cpu=arm64 ;; \
      *) echo "no yarn cpu for TARGETARCH=$TARGETARCH" >&2; exit 1 ;; \
    esac \
    && yarn config set supportedArchitectures.cpu --json "[\"$cpu\"]" \
    && rm -rf node_modules && yarn workspaces focus @hyperdx/api --production


# app_tree ########################################################################################
# The runtime /app, assembled on the build host so nothing here runs emulated.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS app_tree

WORKDIR /app
COPY --from=prod_deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/api/build ./packages/api/build
COPY ./packages/api/bin ./packages/api/bin
COPY --from=builder /app/packages/common-utils/dist ./packages/common-utils/dist
COPY --from=node_base /app/packages/common-utils/node_modules ./packages/common-utils/node_modules
COPY --from=builder /app/packages/app/.next/standalone ./packages/app
COPY --from=builder /app/packages/app/.next/static ./packages/app/packages/app/.next/static
COPY --from=builder /app/packages/app/public ./packages/app/packages/app/public

# Drops the other arch's prebuilt packages, and fails the build on any binary not built for the target.
ARG TARGETARCH
RUN --mount=type=bind,source=scripts/native-arch.mjs,target=/usr/local/lib/native-arch.mjs \
    node /usr/local/lib/native-arch.mjs "$TARGETARCH" /app


# prod ############################################################################################
FROM ${NODE_IMAGE} AS prod

LABEL org.opencontainers.image.vendor="HyperI" \
      org.opencontainers.image.title="HyperI HyperDX Production" \
      org.opencontainers.image.description="HyperI HyperDX (DFE fork) production image with API and App services" \
      org.opencontainers.image.source="https://github.com/hyperi-io/dfe-hyperdx" \
      org.opencontainers.image.licenses="MIT"

ARG CODE_VERSION

ENV CODE_VERSION=$CODE_VERSION
ENV NODE_ENV=production
ARG NEXT_PUBLIC_IS_LOCAL_MODE=false
ENV NEXT_PUBLIC_IS_LOCAL_MODE=$NEXT_PUBLIC_IS_LOCAL_MODE

# Install libs used for the start script
RUN npm install -g concurrently@9.1.0
# concurrently's --kill-others-on-fail walks the process tree with ps, which the slim base lacks: without it the kill path crashes on ENOENT.
# Unpinned on purpose: a Debian point release drops the superseded version from the mirror, so a pinned one fails the build.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends procps && rm -rf /var/lib/apt/lists/*

USER node

# Set up API and App
WORKDIR /app
COPY --chown=node:node --from=app_tree /app ./

# Set up start script
COPY --chown=node:node ./docker/hyperdx/refresh-env.js /etc/local/refresh-env.js
COPY --chown=node:node ./docker/hyperdx/entry.prod.sh /etc/local/entry.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "require('http').get('http://localhost:8000/health',r=>r.statusCode===200?process.exit(0):process.exit(1)).on('error',()=>process.exit(1))"]

ENTRYPOINT ["sh", "/etc/local/entry.sh"]
