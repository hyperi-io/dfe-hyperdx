# DFE development guide

Developing against the DFE fork of HyperDX. The fork's default branch is the DFE
branch and releases are cut from it. Upstream syncs are in
[sync-cycle.md](../fork/sync-cycle.md), and the design in
[the architecture docs](../architecture/README.md).

Upstream's [AGENTS.md](../../AGENTS.md) covers the development setup. The DFE
differences are the compose invocation and one env file:

```bash
cp .env.dfe.example .env.dfe
```

`.env.dfe` is gitignored and required: `yarn dev:dfe` fails without it. The
example has working dev values, and the DocumentDB credentials are the keys it
needs.

## Local dev: `yarn dev:dfe`

```bash
yarn dev:dfe
```

This starts DocumentDB in Docker (replacing upstream MongoDB) and runs the API,
the Next.js app and the common-utils watcher as local processes. It does NOT
start ClickHouse or the otel collectors: the DFE override scales them to zero,
because ingest belongs to the DFE stack (dfe-docker, or a local ClickHouse you
point `DEFAULT_CONNECTIONS` at in `.env.dfe`). The collectors are never built
either, because the override drops their build and names the prebuilt image.

The local API keeps its documents in DocumentDB in Docker and reads whatever
ClickHouse `DEFAULT_CONNECTIONS` names. With `DFE_AUTH_MODE=oidc-proxy` it
trusts the engine's signing key as well.

```mermaid
flowchart LR
    accTitle: L4 Detail -- Local dev with dev:dfe
    accDescr: The Next.js app proxies API calls to the local API. The API keeps documents in DocumentDB running in Docker, fetches the engine's JWKS in oidc-proxy mode, and reads ClickHouse when DEFAULT_CONNECTIONS names one.

    subgraph local["Local processes"]
        app["Next.js app"]
        api["API"]
    end

    subgraph docker["Docker"]
        docdb[("DocumentDB")]
    end

    engine["dfe-engine :8003"]
    ch[("ClickHouse")]

    app -->|api proxy| api
    api -->|documents| docdb
    api -.->|JWKS| engine
    api -.->|queries| ch

    classDef default fill:#F8FAFC,stroke:#64748B,stroke-width:1px,color:#0F172A
    classDef store fill:#DDF3EC,stroke:#00785A,stroke-width:1px,color:#0B3327
    classDef ext fill:#EEF0F2,stroke:#6B7280,stroke-width:1px,stroke-dasharray:4 3,color:#1F2937
    classDef group fill:none,stroke:#64748B,stroke-width:1px,stroke-dasharray:2 4
    class docdb,ch store
    class engine ext
    class local,docker group
```

_Figure 1. L4 Detail -- Local dev with dev:dfe. Dotted arrows depend on settings
in .env.dfe._ Up: [Development](README.md).

Ports are FIXED under `dev:dfe`: API 8000, app 8080, DocumentDB 27017 (published
on all interfaces), from `.env` defaults. The per-worktree port slots and the
:9900 dev portal belong to upstream `yarn dev`, not this flow, so two `dev:dfe`
checkouts collide. To retarget by hand: the API and the app BOTH read `PORT`, so
run them as separate processes with distinct `PORT` values and set
`HYPERDX_API_PORT` so the app's `/api` proxy finds the API.

`DFE_AUTH_MODE` in `.env.dfe` is the master switch: empty disables the DFE
identity layer entirely, `oidc-proxy` verifies engine-signed JWTs, and
`header-dev` trusts dev headers. With it enabled, the fork trusts the engine's
ES384 signing key over JWKS and the `/dfe/*` routes forward the caller's
`dfe_token` to the engine. Both settings live in `.env.dfe`:

```sh
DFE_ENGINE_JWKS_URL=http://localhost:8003/.well-known/jwks.json
DFE_ENGINE_ISSUER=https://dfe.local/api
```

`engineOrigin()` derives the engine base URL from the JWKS URL, so no second
variable is needed. Verify the engine side is up before starting the fork:

```bash
curl -s http://localhost:8003/.well-known/jwks.json
# -> {"keys":[{"kty":"EC","crv":"P-384",...,"alg":"ES384",...}]}
```

The engine's local boot is documented in
[dfe-engine docs/local-dev.md](https://github.com/hyperi-io/dfe-engine/blob/main/docs/local-dev.md).

## Production and config

```bash
docker compose --env-file .env --env-file .env.dfe \
  -f docker-compose.yml -f docker-compose.dfe.yml up -d
```

`docker-compose.dfe.yml` overrides the `app` service's `MONGO_URI`. Name both
env files: `.env.dfe` holds the DocumentDB login, and without it compose starts
DocumentDB with a blank user and password.

DocumentDB serves the MongoDB wire protocol:

- The MongoDB DATA LAYER is unchanged: Mongoose, connect-mongo and
  passport-local-mongoose all work through DocumentDB (the fork's additions live
  mainly under `packages/*/src/dfe/`, guarded by the conflict-surface check in
  `.github/workflows/fork-surface.yml`)
- DocumentDB is PostgreSQL with the DocumentDB extensions and a Mongo
  wire-protocol gateway in one container
- Port 27017 matches upstream MongoDB. The gateway needs TLS and a SCRAM-SHA-256
  login, so `MONGO_URI` follows the example at the top of
  `docker-compose.dfe.dev.yml`
- Images are pinned in `docker-compose.dfe.dev.yml`

Where config lives:

| File                            | Purpose                                      |
| ------------------------------- | -------------------------------------------- |
| `.env`                          | Upstream defaults (image versions, ports)    |
| `.env.dfe.example`              | Template for `.env.dfe` -- copy first        |
| `.env.dfe`                      | DFE overrides (auth mode, engine, conns)     |
| `packages/api/.env.development` | Local API dev config                         |
| `docker-compose.dfe.dev.yml`    | DFE dev compose override (DocumentDB, no CH) |
| `docker-compose.dfe.yml`        | DFE production compose override              |
