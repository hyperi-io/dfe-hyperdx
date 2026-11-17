# Backend

> **Scope.** This describes UPSTREAM HyperDX's API, which we do not modify, and
> where our `dfe/` layer sits in it. It is here so the fork's own docs are
> readable on their own. Upstream's [`agent_docs/`](../../agent_docs/) is the
> authority for upstream's parts.

## Structure

With DFE auth on, application routes run after upstream's session middleware and
our identity middleware. Health probes and `/metrics` mount before both.

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
  accTitle: L3 Components -- HyperDX API
  accDescr: The HyperDX UI calls the API. Inside, upstream's session middleware runs first, then the DFE identity middleware, then the internal routes or the ClickHouse proxy. The API asks the DFE engine about each session, keeps documents in DocumentDB and queries ClickHouse.
  app[["<b>HyperDX UI</b><br/><span>Next.js</span>"]]
  subgraph api["HyperDX API"]
    direction LR
    session("<b>Session</b><br/><span>Passport</span>") --> identity[["<b>DFE identity</b>"]]
    identity --> routes("<b>Internal routes</b>")
    identity --> proxy[["<b>ClickHouse proxy</b>"]]
  end
  engine("<b>DFE engine</b><br/><span>session and identity</span>")
  ch[("<b>ClickHouse</b>")]
  docdb[("<b>DocumentDB</b>")]
  app --> api
  api -->|sessions| engine
  api -->|queries| ch
  api -->|documents| docdb
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
  class app ui
  class session,identity,routes,proxy part
  class engine control
  class ch,docdb store
  style api fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
```

_Figure 1. L3 Components -- HyperDX API._ Up:
[L2 Services -- dfe-hyperdx](README.md#the-system). Down:
[L4 Detail -- Engine token check](oidc-authentication.md#the-flow),
[L4 Detail -- Query read path](data-flow.md#read-path).

| Part             | What it is                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session          | Upstream's Passport.js session auth (`passport-local-mongoose`), sessions stored through `connect-mongo`. Bypassed in local mode (`IS_LOCAL_APP_MODE`) |
| DFE identity     | Ours, `dfe/middleware/jwt-verify.ts`. Verifies the engine token and signs the user in, see [oidc-authentication.md](oidc-authentication.md)            |
| Internal routes  | `/dashboards`, `/saved-search`, `/sources`, `/connections`, `/team`, `/me`, `/ai` and the rest, plus our `/dfe` routes                                 |
| ClickHouse proxy | `/clickhouse-proxy`, which sends the browser's SQL to ClickHouse with the team connection's credentials                                                |
| External API     | `/api/v2/*`, Bearer auth on the user's `accessKey`, rate limited per key (`EXTERNAL_API_RATE_LIMIT_MAX` a minute). Engine-only in DFE mode             |
| OpAMP server     | A separate port that serves collector configuration, below                                                                                             |

In DFE mode `/alerts`, `/webhooks`, `/api/v2`, `/mcp` and personal access keys
refuse every human session, and `/connections`, `/sources` and `/team` let a
member read but not write. The engine's service token reaches team, source and
connection routes alone. The list is in
[what-we-changed.md](../fork/what-we-changed.md#authorization).

## OTel collector and OpAMP

Upstream's collector takes its receivers, connectors, exporters and pipeline
wiring from the API over OpAMP. DFE runs no such collector: the DFE pipeline
writes the telemetry tables, so this path is idle in a DFE deployment.

```mermaid
---
config:
  theme: base
  look: neo
  fontFamily: Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif
  themeVariables:
    fontSize: 15px
    lineColor: "#64748B"
    primaryTextColor: "#0F172A"
    edgeLabelBackground: "#FFFFFF"
    actorBkg: "#FFFFFF"
    actorBorder: "#94A3B8"
    actorTextColor: "#0F172A"
    actorLineColor: "#94A3B8"
    signalColor: "#64748B"
    signalTextColor: "#0F172A"
    sequenceNumberColor: "#FFFFFF"
    noteBkgColor: "#FFFFFF"
    noteBorderColor: "#94A3B8"
    noteTextColor: "#0F172A"
    labelBoxBkgColor: "#FFFFFF"
    labelBoxBorderColor: "#94A3B8"
    labelTextColor: "#0F172A"
    loopTextColor: "#0F172A"
  themeCSS: >-
    p{margin:0}
    .labelBkg{background:transparent!important}
    span.edgeLabel{display:inline-block;background:#FFFFFF!important;color:#1E293B;border:1px solid #94A3B8;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:500}
    span.edgeLabel p{background:transparent!important}
    .messageText{fill:#0F172A;stroke:#FFFFFF;stroke-width:4px;paint-order:stroke;stroke-linejoin:round}
    .loopText,.loopText tspan{fill:#0F172A;stroke:#FFFFFF;stroke-width:4px;paint-order:stroke;stroke-linejoin:round}
    .loopLine{stroke:#64748B}
    .actor{rx:10px;ry:10px;filter:drop-shadow(0 1px 2px rgba(15,23,42,.10)) drop-shadow(0 6px 14px rgba(15,23,42,.10))}
    .actor-line{stroke-dasharray:4 4}
---
sequenceDiagram
  accTitle: L4 Detail -- OpAMP collector configuration
  accDescr: The OpAMP supervisor reports to the API, the API answers with a generated collector configuration, and the supervisor starts the collector with it. Every later heartbeat gets the generated configuration and its hash.
  participant API as HyperDX API
  participant SUP as OpAMP supervisor
  participant COL as OTel collector
  participant CH as ClickHouse

  SUP->>API: AgentToServer, first heartbeat
  API->>API: buildOtelCollectorConfig
  API-->>SUP: ServerToAgent with RemoteConfig
  SUP->>COL: start with the generated config
  loop every heartbeat
    SUP->>API: AgentToServer, status
    API-->>SUP: ServerToAgent, config and hash
  end
  COL->>CH: write telemetry
```

_Figure 2. L4 Detail -- OpAMP collector configuration. Dashed arrows are
answers._ Up: [L3 Components -- HyperDX API](#structure).

The remote configuration covers receivers, connectors, exporters and pipeline
wiring, built from team settings. Processors and each pipeline's processor list
come from the bootstrap `docker/otel-collector/config.yaml` and an optional
custom file. That gives pipeline changes without a collector restart, API-key
enforcement when a team turns on `collectorAuthenticationEnforced`, and the
routing connector that sends rrweb events to their own pipeline and table. With
no `OPAMP_SERVER_URL` the collector runs standalone on
`docker/otel-collector/config.yaml` plus a standalone config file.

## Features

Browser SDKs capture DOM mutations as **rrweb** events, shipped as OTLP logs
with a `rr-web.event` attribute. The collector routes these to
`hyperdx_sessions`. The frontend reconstructs playback using rrweb's `Replayer`
class, correlated to logs and traces via `rum.sessionId`. The DFE console does
not offer session replay: the embed blocks `/sessions`.

A dashboard is a document in DocumentDB holding a set of **tiles**, each a
`SavedChartConfig` (source, display type, select, where, groupBy).
Dashboard-level filters apply across all tiles, and import and export use
versioned JSON templates. A saved search is a query against one Source, with a
Lucene or SQL `where`, kept in DocumentDB and listed in the sidebar by tag.

The AI assistant uses the Vercel AI SDK with Anthropic or OpenAI as the provider
(`AI_PROVIDER`). The backend introspects ClickHouse table metadata for schema
context, then returns chart, search and table configurations the frontend
renders directly.
