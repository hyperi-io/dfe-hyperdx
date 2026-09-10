# DFE HyperDX - local docker (capped) + reuse for dfe-docker / k8s

How to run the patched (upstream-2.29) HyperDX fork locally, with **hard memory
caps** so it never OOMs a dev laptop. The compose caps layer is the resource
SSoT that dfe-docker reuses and k8s mirrors.

## TL;DR - two modes

Both source the base compose + the DFE override + the caps layer. The only
difference is whether the app runs locally (dev, hot reload) or in a container.

### Dev (fast iteration - app local, infra in docker)

```sh
# 1. infra for the UI (ClickHouse + PostgreSQL + FerretDB), capped. Name the 3
#    services so compose does NOT build otel-collector/prometheus (heavy build,
#    not needed to iterate on look/feel; the app's self-telemetry is non-fatal):
docker compose --env-file .env.dfe \
  -f docker-compose.dev.yml -f docker-compose.dfe.dev.yml -f docker-compose.caps.yml \
  up -d ch-server postgres ferretdb

# 2. app + api locally (hot reload):
yarn app:dev:dfe
```

(Add `otel-collector otel-collector-json prometheus` to step 1 only if you need
telemetry ingestion; they require `OTEL_COLLECTOR_VERSION` from the base
`.env`.) App: http://localhost:8080 - API: http://localhost:8000. Needs
`.env.dfe` (dev creds; gitignored - copy from `.env.dfe-example`).

### Prod image (containerised app - closest to k8s)

```sh
docker compose --env-file .env --env-file .env.dfe \
  -f docker-compose.yml -f docker-compose.dfe.yml -f docker-compose.caps.yml up -d --build
```

Builds the fork app image (`docker/hyperdx/Dockerfile`) and runs everything in
containers. The `app` container's memory cap lives in `docker-compose.dfe.yml`
(a compose service needs an image/build to be capped, so it cannot sit in the
caps layer).

## Memory caps (docker-compose.caps.yml) - the resource SSoT

Layer this file LAST. `docker compose up` (v2) honours
`deploy.resources.limits.memory` outside swarm. Current ceilings:

| Service                     | limit | reservation | k8s note                         |
| --------------------------- | ----- | ----------- | -------------------------------- |
| ch-server (ClickHouse)      | 2g    | 512m        | dominant; drop to 1536m if tight |
| postgres (FerretDB backend) | 512m  | 128m        | DocumentDB ext                   |
| ferretdb                    | 256m  | 64m         | Mongo-wire shim                  |
| otel-collector / -json      | 300m  | -           | one each                         |
| prometheus                  | 300m  | -           | dev metrics                      |
| app (prod image only)       | 1g    | 256m        | in dfe.dfe.yml                   |

Dev ceiling ~= 3.4 GB. **Never run this stack uncapped on a laptop.**

These map 1:1 to Kubernetes:

```
deploy.resources.limits.memory       -> containers[].resources.limits.memory
deploy.resources.reservations.memory -> containers[].resources.requests.memory
```

## What is DFE-specific (what dfe-docker + k8s must replicate)

The fork keeps upstream HyperDX code pristine; DFE behaviour is additive
(`packages/*/src/dfe/**`) and driven by env + compose overrides:

- **MongoDB -> FerretDB + PostgreSQL/DocumentDB.** `docker-compose.dfe*.yml`
  replaces `db` (mongo) with `postgres` + `ferretdb`; the app speaks Mongo-wire
  to FerretDB unchanged. k8s: a PostgreSQL (DocumentDB ext) + FerretDB
  deployment.
- **OIDC trusted-header auth** (`DFE_AUTH_MODE=oidc-proxy`): an OIDC proxy
  (Envoy in k8s / oauth2-proxy in docker) terminates auth and forwards
  `x-forwarded-email` / `x-forwarded-groups`. Empty `DFE_AUTH_MODE` = upstream
  local login (fine for look/feel iteration).
- **ClickHouse connection + sources** via `DEFAULT_CONNECTIONS` /
  `DEFAULT_SOURCES` env (see `.env.dfe-example`).

## Reuse for Kaz (dfe-docker)

dfe-docker layers the SAME `docker-compose.caps.yml` (or copies the table above)
onto the HyperDX service. Pin the fork image by `tag@sha256` (per the DFE
SHA-pin rule).

`ghcr.io/hyperi-io/dfe-hyperdx` is the one registry path the fork publishes to.
hyperi-ci builds it from the root `Dockerfile` (`.hyperi-ci.yaml`, `publish.container`),
and `dfe-infra/helm/charts/hyperdx/values.yaml` deploys that same name. The
`docker.hyperdx.io/hyperdx/hyperdx` targets in the Makefile are upstream's own
release targets: we never run them, and rewriting them would buy a merge conflict
on every sync for nothing.

## Notes

- CH dev port is `HDX_DEV_CH_HTTP_PORT` (default 8123; no clash with the
  always-on dev CH on :18123).
- Empty ClickHouse still renders the themed UI - point `DEFAULT_CONNECTIONS` at
  a CH with real otel tables to see data.
- Teardown: `yarn dev:down` (or `docker compose ... down`).
