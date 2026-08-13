# Project:   hyperi-hyperdx
# File:      Dockerfile
# Purpose:   production container image (API + App) published to GHCR by hyperi-ci
#
# License:   MIT
# Copyright: (c) 2026 HYPERI PTY LIMITED
#
# Auto-built + published to ghcr.io/hyperi-io/hyperi-hyperdx by hyperi-ci
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
#
# The DFE fork changes are applied in-place to the mainline source (the
# .dfe[CHG] copies match their originals), so the standard nx build below
# produces the DFE build with no swap step.

ARG NODE_VERSION=22.22

# base ############################################################################################
FROM node:${NODE_VERSION}-alpine AS node_base

WORKDIR /app

COPY .yarn ./.yarn
COPY .yarnrc.yml yarn.lock package.json nx.json .prettierrc .prettierignore ./tsconfig.base.json ./
COPY ./packages/common-utils ./packages/common-utils
COPY ./packages/api/jest.config.js ./packages/api/tsconfig.json ./packages/api/tsconfig.build.json ./packages/api/package.json ./packages/api/
COPY ./packages/app/jest.config.js ./packages/app/tsconfig.json ./packages/app/tsconfig.build.json ./packages/app/package.json ./packages/app/next.config.mjs ./packages/app/mdx.d.ts ./packages/app/eslint.config.mjs ./packages/app/

# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat

RUN yarn install --mode=skip-build && yarn cache clean


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

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT_STANDALONE=true
ARG NEXT_PUBLIC_IS_LOCAL_MODE=true
ENV NEXT_PUBLIC_IS_LOCAL_MODE=$NEXT_PUBLIC_IS_LOCAL_MODE
ARG NEXT_PUBLIC_HDX_LOCAL_DEFAULT_CONNECTIONS=
ENV NEXT_PUBLIC_HDX_LOCAL_DEFAULT_CONNECTIONS=$NEXT_PUBLIC_HDX_LOCAL_DEFAULT_CONNECTIONS
ARG NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES=
ENV NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES=$NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES

ARG NEXT_PUBLIC_THEME=hyperi
ENV NEXT_PUBLIC_THEME=$NEXT_PUBLIC_THEME
ENV NX_DAEMON=false
RUN npx nx run-many --target=build --projects=@hyperdx/common-utils,@hyperdx/api,@hyperdx/app
RUN rm -rf node_modules && yarn workspaces focus @hyperdx/api --production


# prod ############################################################################################
FROM node:${NODE_VERSION}-alpine AS prod

LABEL org.opencontainers.image.vendor="HyperI" \
      org.opencontainers.image.title="HyperI HyperDX Production" \
      org.opencontainers.image.description="HyperI HyperDX (DFE fork) production image with API and App services" \
      org.opencontainers.image.source="https://github.com/hyperi-io/hyperi-hyperdx" \
      org.opencontainers.image.licenses="MIT"

ARG CODE_VERSION

ENV CODE_VERSION=$CODE_VERSION
ENV NODE_ENV=production
ARG NEXT_PUBLIC_IS_LOCAL_MODE=true
ENV NEXT_PUBLIC_IS_LOCAL_MODE=$NEXT_PUBLIC_IS_LOCAL_MODE

# Install libs used for the start script
RUN npm install -g concurrently@9.1.0

USER node

# Set up API and App
WORKDIR /app
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/api/build ./packages/api/build
COPY --chown=node:node ./packages/api/bin ./packages/api/bin
COPY --chown=node:node --from=builder /app/packages/common-utils/dist ./packages/common-utils/dist
COPY --chown=node:node --from=node_base /app/packages/common-utils/node_modules ./packages/common-utils/node_modules
COPY --chown=node:node --from=builder /app/packages/app/.next/standalone ./packages/app
COPY --chown=node:node --from=builder /app/packages/app/.next/static ./packages/app/packages/app/.next/static
COPY --chown=node:node --from=builder /app/packages/app/public ./packages/app/packages/app/public

# Set up start script
COPY --chown=node:node ./docker/hyperdx/refresh-env.js /etc/local/refresh-env.js
COPY --chown=node:node ./docker/hyperdx/entry.prod.sh /etc/local/entry.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8000/health',r=>r.statusCode===200?process.exit(0):process.exit(1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["sh", "/etc/local/entry.sh"]
