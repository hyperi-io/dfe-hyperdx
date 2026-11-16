# DFE HyperDX - local docker, capped

**Status: the caps layer does not load.** `docker-compose.caps.yml` still caps
two services the move to DocumentDB removed, `postgres` among them, so compose
rejects every command below that names it
(`service "postgres" has neither an image nor a build context specified`). Until
those blocks go, run the dev command without the caps files, since DocumentDB
has no cap either way. The container command stays blocked: without the caps
layer it starts ClickHouse and the collector uncapped.

How to run the fork locally with hard memory caps on ClickHouse and the
collectors. DocumentDB and the app stay uncapped. Both modes source the base
compose and the DFE override, and the caps layer goes last. The difference is
whether the app runs locally (dev, hot reload) or in a container.

For dev, `yarn dev:dfe` is the flow ([getting-started.md](getting-started.md)):
it starts DocumentDB in Docker and runs the API and app locally. The DFE dev
override scales ClickHouse and both collectors to zero, so ingest and ClickHouse
come from dfe-docker or a ClickHouse you point `DEFAULT_CONNECTIONS` at. To
bring the infra up yourself and run the app separately:

```sh
docker compose --env-file .env.dfe \
  -f docker-compose.dev.yml -f docker-compose.dfe.dev.yml \
  up -d documentdb

dotenvx run -f .env.dfe -f .env -- yarn app:dev:dfe
```

App: <http://localhost:8080>, API: <http://localhost:8000>. It needs `.env.dfe`
(dev credentials, gitignored, copied from `.env.dfe.example`).

To run the app in a container, the closest to k8s, once the caps file loads:

```sh
docker compose --env-file .env --env-file .env.dfe \
  -f docker-compose.yml -f docker-compose.dfe.yml -f docker-compose.caps.yml up -d
```

The `app` service runs the image `docker-compose.yml` names from `.env`
(`HDX_IMAGE_REPO`, `IMAGE_NAME_DOCKERHUB`, `IMAGE_VERSION`). No compose layer
caps it. Its Kubernetes limit is `resources` in `dfe/deploy/contract.json`.

## Memory caps

Layer `docker-compose.caps.yml` last. `docker compose up` (v2) honours
`deploy.resources.limits.memory` outside swarm.

| Service                | limit | reservation | Set in                        |
| ---------------------- | ----- | ----------- | ----------------------------- |
| ch-server (ClickHouse) | 2g    | 512m        | `docker-compose.caps.yml`     |
| otel-collector         | 300m  | -           | `docker-compose.caps.yml`     |
| otel-collector-json    | 300m  | -           | `docker-compose.caps.dev.yml` |
| prometheus             | 300m  | -           | `docker-compose.caps.dev.yml` |

The `documentdb` service has no cap. `otel-collector-json` and `prometheus` are
capped in the dev file because the prod stack defines neither. **Never run this
stack uncapped on a laptop.**

The compose keys map to Kubernetes one to one:

| Compose                                | Kubernetes                               |
| -------------------------------------- | ---------------------------------------- |
| `deploy.resources.limits.memory`       | `containers[].resources.limits.memory`   |
| `deploy.resources.reservations.memory` | `containers[].resources.requests.memory` |

## What is DFE-specific

The fork keeps upstream's code pristine wherever it can, and DFE behaviour is
under `packages/*/src/dfe/**`, driven by env and compose overrides:

- DocumentDB as the document store. `docker-compose.dfe*.yml` replaces `db`
  (mongo) with `documentdb`, and the app speaks Mongo-wire to its gateway
  unchanged. On k8s it is a DocumentDB cluster on CloudNativePG.
- Engine token auth (`DFE_AUTH_MODE=oidc-proxy`). The API verifies the engine's
  token from the `dfe_token` cookie against the engine's JWKS, see
  [oidc-authentication.md](../architecture/oidc-authentication.md). An empty
  `DFE_AUTH_MODE` is upstream's local login, fine for look-and-feel work.
- The ClickHouse connection and sources, through `DEFAULT_CONNECTIONS` and
  `DEFAULT_SOURCES` (see `.env.dfe.example`).

`ghcr.io/hyperi-io/dfe-hyperdx` is the one registry path the fork publishes to.
hyperi-ci builds it from the root `Dockerfile` (`release.container` in
`.hyperi-ci.yaml`), and the `dfe-hyperdx` chart hyperi-ci publishes from
`dfe/deploy/contract.json` deploys that same name. dfe-docker pins it by tag and
sets its own memory limit (`compose/limits.yml` there). The image targets in the
Makefile are upstream's release targets, named from `.env`: we never run them,
and rewriting them would buy a merge conflict on every sync for nothing.

The ClickHouse dev port is `HDX_DEV_CH_HTTP_PORT` (default 8123). An empty
ClickHouse still renders the themed UI, so point `DEFAULT_CONNECTIONS` at a
ClickHouse with OTel tables to see data. Tear down with
`docker compose --env-file .env.dfe -f docker-compose.dev.yml -f docker-compose.dfe.dev.yml down`.
