# dfe-hyperdx architecture

dfe-hyperdx is the search, charts and dashboards inside the DFE console, built
from a fork of HyperDX. The console frames it, the DFE engine signs every
session in, and it reads ClickHouse as the team's own user.

```mermaid
---
config:
  theme: base
  look: neo
  fontFamily: Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif
  flowchart:
    curve: linear
    nodeSpacing: 40
    rankSpacing: 64
    padding: 18
    wrappingWidth: 280
    htmlLabels: true
  elk:
    preset: modelOrder
  themeVariables:
    fontSize: 15px
    lineColor: "#64748B"
    primaryTextColor: "#0F172A"
    clusterBorder: "#0072B2"
    edgeLabelBackground: "#FFFFFF"
  themeCSS: >-
    p{margin:0}
    .node[data-look] rect,.node[data-look] path,.node[data-look] polygon,.node[data-look] .outer-path{filter:drop-shadow(0 1px 2px rgba(15,23,42,.10)) drop-shadow(0 6px 14px rgba(15,23,42,.10))}
    .node rect{rx:10px;ry:10px}
    .cluster rect{rx:16px;ry:16px}
    .node .label div{min-width:150px}
    .node.decision .label div{min-width:0}
    .cluster[data-look] rect{filter:none}
    .nodeLabel{line-height:1.35}
    .nodeLabel b{font-weight:600;font-size:15px;letter-spacing:-0.01em}
    .nodeLabel span{font-size:12.5px;font-weight:400;color:#334155}
    .cluster-label span.nodeLabel{display:inline-block;background:#FFFFFF;color:#0B2A3F;border:1.5px solid #0072B2;border-radius:999px;padding:2px 12px;font-size:11.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
    .flowchart-link{stroke-width:1.75px}
    .labelBkg{background:transparent!important}
    span.edgeLabel{display:inline-block;background:#FFFFFF!important;color:#1E293B;border:1px solid #94A3B8;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:500}
    span.edgeLabel p{background:transparent!important}
    .label-icon{width:20px;height:20px;vertical-align:-4px;margin-right:6px}
    .ingest .label-icon{color:#0E8A7D}
    .xform .label-icon{color:#7B4FB0}
    .load .label-icon{color:#0072B2}
    .bus .label-icon{color:#A8517F}
    .store .label-icon{color:#00785A}
    .ui .label-icon{color:#D9480F}
    .ext .label-icon{color:#64748B}
---
flowchart TB
  accTitle: L2 Services -- dfe-hyperdx
  accDescr: The DFE console frames the HyperDX UI, which calls the HyperDX API. The API asks the DFE engine about each session, queries ClickHouse and keeps its documents in DocumentDB. The dashboard provisioner writes shipped dashboards to DocumentDB.
  console("<b>DFE console</b><br/><span>dfe-ui</span>")
  subgraph hdx["dfe-hyperdx"]
    direction LR
    app[["<b>HyperDX UI</b><br/><span>Next.js</span>"]]
    api[["<b>HyperDX API</b><br/><span>Express</span>"]]
    provisioner("<b>Dashboard provisioner</b><br/><span>writes the shipped dashboards</span>")
  end
  subgraph back["Behind it"]
    direction LR
    engine("<b>DFE engine</b><br/><span>session and identity</span>")
    ch[("<b>ClickHouse</b>")]
    docdb[("<b>DocumentDB</b>")]
  end
  console -->|frames| app
  app --> api
  api -->|sessions| engine
  api -->|queries| ch
  api -->|documents| docdb
  provisioner -->|dashboards| docdb
  class console ui
  class app,api,provisioner part
  class engine control
  class ch,docdb store
  classDef ext fill:#F4F6F8,stroke:#94A3B8,stroke-width:1.5px,stroke-dasharray:5 4,color:#0F172A
  classDef ingest fill:#FFFFFF,stroke:#0E8A7D,stroke-width:3px,color:#0F172A
  classDef xform fill:#FFFFFF,stroke:#7B4FB0,stroke-width:3px,color:#0F172A
  classDef load fill:#FFFFFF,stroke:#0072B2,stroke-width:3px,color:#0F172A
  classDef bus fill:#FFFFFF,stroke:#A8517F,stroke-width:3px,color:#0F172A
  classDef store fill:#FFFFFF,stroke:#00785A,stroke-width:3px,color:#0F172A
  classDef ui fill:#FFFFFF,stroke:#D9480F,stroke-width:3px,color:#0F172A
  classDef decision fill:#FFFFFF,stroke:#9A6700,stroke-width:3px,color:#0F172A
  classDef error fill:#FFFFFF,stroke:#C2410C,stroke-width:3px,color:#0F172A
  classDef control fill:#FFFFFF,stroke:#334155,stroke-width:3px,color:#0F172A
  classDef part fill:#FFFFFF,stroke:#94A3B8,stroke-width:1.5px,color:#0F172A
  style hdx fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
  style back fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
```

_Figure 1. L2 Services -- dfe-hyperdx._ Up: top of dfe-hyperdx. Down:
[L3 Components -- HyperDX UI](architecture/frontend.md),
[L3 Components -- HyperDX API](architecture/backend.md).

## How data flows

1. The **DFE console** frames the **HyperDX UI** in chromeless mode, and plants
   the engine token in the `dfe_token` cookie on the shared parent domain.
2. The **HyperDX UI** builds chart SQL in the browser and sends it through the
   API's ClickHouse proxy. Everything else goes through the API's REST routes.
3. The **HyperDX API** verifies the engine token itself and asks the **DFE
   engine** which team the session is on.
4. It queries **ClickHouse** as that team's own ClickHouse user, so ClickHouse
   GRANTs and row policies decide what it reads.
5. Saved searches, dashboards and alerts live in **DocumentDB**, scoped by team.
6. The **Dashboard provisioner** reads the dashboard content dfe-engine writes
   and syncs it into DocumentDB once a minute.

## Components

| Part                  | Role                                                                                                                                          | Page                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| HyperDX UI            | Search, charts and dashboards, framed by the console. Upstream's frontend, unchanged except for branding and our `dfe/` additions             | [architecture/frontend.md](architecture/frontend.md)                        |
| HyperDX API           | Upstream's Express API with our identity middleware, team seeding and request validation in `packages/api/src/dfe/`                           | [architecture/backend.md](architecture/backend.md)                          |
| Dashboard provisioner | A scheduled task in the API package (`tasks/provisionDashboards`) that writes the shipped dashboards. Our middleware locks them against edits | [fork/what-we-changed.md](fork/what-we-changed.md#dfe-integration-features) |

## External dependencies

| Dependency | Needed for                                                                          | Swappable                                                                                              |
| ---------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| DFE engine | Every session, each team's ClickHouse connection, and the shipped dashboard content | No                                                                                                     |
| ClickHouse | Every query                                                                         | Any ClickHouse the engine names a connection for                                                       |
| DocumentDB | Users, teams, saved searches, dashboards and alerts                                 | Any MongoDB-wire store. DFE ships DocumentDB ([ADR 0006](decisions/0006-documentdb-document-store.md)) |

## Deployment variants

One image ships, `ghcr.io/hyperi-io/dfe-hyperdx`, and dfe-infra's chart deploys
it beside the rest of DFE. dfe-engine is the controlling repo for the HyperDX
integration.

- On Kubernetes the UI sits on its own subdomain, and the console reaches it
  through `HYPERDX_URL`.
- In the Docker compose stack it shares the console's host on another port,
  `HYPERDX_PORT` on the console side.
- For local development `yarn dev:dfe` runs the app and API from a checkout
  against DocumentDB in Docker
  ([development/getting-started.md](development/getting-started.md)).

## Design considerations

| Aspect      | How it is handled                                                                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security    | HyperDX's own password login is off. The API verifies the engine's ES384 token, and a team holds only its own ClickHouse connection. A team holding another ClickHouse user refuses the session |
| Reliability | Team seeding takes one claim per team, atomic across replicas, and retries once the 30-second claim lapses                                                                                      |
| Operations  | Health probes and `/metrics` mount before the identity middleware. A startup task deletes any connection that is not its team's own                                                             |

## Why it's built this way

| Decision                          | Reason                                                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication is the engine's    | The console signs the user in once, and every DFE surface trusts the same token                                                                                      |
| Authorization is the engine's too | The engine decides which ClickHouse user a session reads as, and ClickHouse GRANTs enforce it, so access is decided in one place                                     |
| DocumentDB, not MongoDB           | MongoDB's licence rules it out of DFE. DocumentDB speaks the same wire protocol, so HyperDX runs unchanged ([ADR 0006](decisions/0006-documentdb-document-store.md)) |
| Our code under `dfe/` directories | An upstream merge never conflicts there. Every in-place edit to an upstream file is listed in `.fork-surface` ([fork/design.md](fork/design.md))                     |
| JSON native throughout            | DFE tables use ClickHouse's JSON type, and the fork reads that type natively                                                                                         |

## Diagram map

- Figure 1. L2 Services -- dfe-hyperdx (this page)
  - [L3 Components -- HyperDX UI](architecture/frontend.md)
  - [L3 Components -- HyperDX API](architecture/backend.md)
    - [L4 Detail -- Authorization layers](architecture/authorization.md)
    - [L4 Detail -- Identity mode](architecture/oidc-authentication.md)
    - [L4 Detail -- Seeding a team connection](architecture/team-identity.md)
  - [L4 Detail -- Telemetry write path](architecture/data-flow.md)
  - [L4 Detail -- Sources and tables](architecture/clickhouse-data-model.md)
  - [L4 Detail -- Compose services](architecture/deployment.md)
- [L4 Detail -- Package dependencies](architecture/README.md)
- [The fork's diagrams](fork/README.md)

## What's next

- [Architecture pages](architecture/README.md): every page in this section, and
  where the code lives
- [The fork](fork/README.md): what we changed and how we keep it in step with
  upstream
- [Local development](development/README.md)
- [Decisions](decisions/README.md)
