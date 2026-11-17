# Architecture pages

The [architecture page](../architecture.md) has the parts and why it is built this way. These pages go one level down, and this one says where the code lives.

## Where things live

`app`, `api` and `cli` all build on `common-utils`, which holds the query
engine.

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
flowchart LR
  accTitle: L4 Detail -- Package dependencies
  accDescr: The app, api and cli packages each depend on common-utils.
  app("<b>packages/app</b>")
  api("<b>packages/api</b>")
  cli("<b>packages/cli</b>")
  cu("<b>packages/common-utils</b>")
  app --> cu
  api --> cu
  cli --> cu
  class app,api,cli,cu part
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
```

*Figure 1. L4 Detail -- Package dependencies.* Up: [L2 Services -- dfe-hyperdx](../architecture.md).

| Package                   | Role                                                           |
| ------------------------- | -------------------------------------------------------------- |
| `@hyperdx/app`            | Frontend: search, dashboards, session replay                   |
| `@hyperdx/api`            | REST API, OpAMP server, MCP server, ClickHouse proxy           |
| `@hyperdx/common-utils`   | Isomorphic query engine, Lucene-to-SQL parser, Zod types       |
| `@hyperdx/cli`            | Terminal CLI and TUI (`hdx`)                                   |
| `@hyperdx/otel-collector` | Custom OTel Collector build, plus ClickHouse schema migrations |
| `@hyperdx/hdx-eval`       | Benchmarks the MCP server against observability scenarios      |

Our additions live under `packages/api/src/dfe/**`, `packages/app/src/dfe/**`
and `packages/common-utils/src/dfe/**`, so they cannot collide with upstream.
Compose files and collector config are in `docker/`.

The rest of this section, page by page:

| Topic                                                          | Doc                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| How telemetry gets from an SDK to a chart                      | [data-flow.md](data-flow.md)                           |
| How a search becomes SQL                                       | [clickhouse-data-model.md](clickhouse-data-model.md)   |
| Frontend structure and state                                   | [frontend.md](frontend.md)                             |
| API structure and the OpAMP and MCP servers                    | [backend.md](backend.md)                               |
| The engine token and how the API verifies it                   | [oidc-authentication.md](oidc-authentication.md)       |
| Who is allowed to see what                                     | [authorization.md](authorization.md)                   |
| Which team a user lands on, its connection, the startup repair | [team-identity.md](team-identity.md)                   |
| Turning a saved search into a DFE rule                         | [query-to-rule-pipeline.md](query-to-rule-pipeline.md) |
| DocumentDB, service topology                                   | [deployment.md](deployment.md)                         |
| Why we chose what we chose                                     | [../decisions/](../decisions/README.md)                |

These pages describe what the code does. Where a design has changed, the
superseded reasoning lives in [../decisions/](../decisions/README.md).
