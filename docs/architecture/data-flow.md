# Data flow

> **Scope.** This describes UPSTREAM HyperDX's architecture, which we do not
> modify. It is here so the fork's own docs are readable on their own.
> Upstream's [`agent_docs/`](../../agent_docs/) is the authority, and anything
> specific to DFE is called out as such.

## Write path

Upstream's collector takes OTLP and Fluentd input, and its routing connector
sends rrweb events to their own table and everything else to the OTel tables.

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
  accTitle: L4 Detail -- Telemetry write path
  accDescr: Applications send OTLP and Fluentd input and browsers send rrweb events to the collector receivers. Processors transform and batch them, and the routing connector writes rrweb events to hyperdx_sessions and everything else to the OTel tables.
  subgraph path["Write path"]
    direction TB
    subgraph sources["Sources"]
      direction LR
      otlp("<b>Apps</b><br/><span>OTLP</span>")
      fluent("<b>Apps</b><br/><span>Fluentd</span>")
      rrweb("<b>Browsers</b><br/><span>rrweb</span>")
      otlp ~~~ fluent ~~~ rrweb
    end
    subgraph collect["Collector"]
      direction LR
      receivers("<b>Receivers</b>")
      processors("<b>Processors</b><br/><span>transform and batch</span>")
      receivers --> processors
    end
    subgraph route["Routing connector"]
      direction LR
      routing{"<b>rr-web.event<br/>present?</b>"}
      sessions[("<b>hyperdx_sessions</b>")]
      otel[("<b>otel_logs, traces, metrics</b>")]
      routing -->|yes| sessions
      routing -->|no| otel
    end
    sources --> collect --> route
  end
  class otlp,fluent,rrweb ext
  class receivers,processors part
  class routing decision
  class sessions,otel store
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
  style path fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
  style sources fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
  style collect fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
  style route fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
```

_Figure 1. L4 Detail -- Telemetry write path. Dashed boxes are external._ Up:
[Architecture](README.md).

- Receivers accept OTLP (gRPC on 4317, HTTP on 4318) and Fluentd (24225).
- The transform processor parses JSON log bodies, infers severity and normalises
  case. Batch and memory limiter processors follow.
- The routing connector checks the `rr-web.event` log attribute.
- The ClickHouse exporter writes `otel_logs`, `otel_traces` and five metric
  tables over the native protocol.

DFE runs none of this. The DFE pipeline writes the telemetry tables, and no
OpAMP-managed collector of HyperDX's is deployed.

## Read path

The browser renders the SQL, and the API adds the team connection's credentials
on the way to ClickHouse.

```mermaid
---
config:
  theme: base
  fontFamily: Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif
  themeVariables:
    fontSize: 15px
    lineColor: "#64748B"
    primaryTextColor: "#0F172A"
    actorBkg: "#FFFFFF"
    actorBorder: "#94A3B8"
    actorTextColor: "#0F172A"
    actorLineColor: "#64748B"
    signalColor: "#64748B"
    signalTextColor: "#0F172A"
    noteBkgColor: "#FFFFFF"
    noteBorderColor: "#94A3B8"
    noteTextColor: "#0F172A"
  themeCSS: >-
    .messageText{paint-order:stroke;stroke:#FFFFFF;stroke-width:3px;stroke-linejoin:round}
---
sequenceDiagram
  accTitle: L4 Detail -- Query read path
  accDescr: The browser renders a chart config to SQL and posts it to the ClickHouse proxy. The API checks the session, loads the connection's credentials and forwards the query to ClickHouse, then returns the results.
  participant Browser as Browser
  participant API as HyperDX API
  participant CH as ClickHouse

  Browser->>Browser: renderChartConfig to parameterised SQL
  Browser->>API: POST /api/clickhouse-proxy, SQL and connection id
  API->>API: check session, load connection credentials
  API->>CH: forward with the connection's ClickHouse user
  CH-->>API: query results
  API-->>Browser: query results
```

_Figure 2. L4 Detail -- Query read path. Dashed arrows are answers._ Up:
[L3 Components -- HyperDX API](backend.md#structure).

The query engine (`renderChartConfig` in `common-utils`) runs **in the
browser**, generating parameterised ClickHouse SQL. The API is an authenticated
proxy: it never interprets the SQL, it checks the session and sets
`X-ClickHouse-User` and `X-ClickHouse-Key` from the connection. In DFE mode it
first drops every credential the caller sent (`dropClientCredentials`).

In **local mode** (`IS_LOCAL_MODE`, a single-user deployment), the browser
queries ClickHouse directly, bypassing the proxy.

## Alert evaluation

The alert checker task starts with the image in DFE as well, but nobody can
create an alert for it to evaluate. In DFE mode `/alerts` and `/webhooks` refuse
every human session, the engine's service token reaches team, source and
connection routes alone, and the console sends a visit to `/alerts` back to
`/search`. Detection and alerting are the DFE rules engine's and its hunts,
which query ClickHouse directly
([ADR 0002](../decisions/0002-alerting-disabled-for-dfe-rules.md)). The flow
below is upstream's, for reference.

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
  accTitle: L4 Detail -- Upstream alert evaluation
  accDescr: The alert checker loads active alerts from DocumentDB, builds each one's query, runs it on ClickHouse and compares the result with the threshold. A triggered alert sends a webhook and records history, and an alert within its threshold records history alone.
  subgraph cycle["Alert check"]
    direction TB
    subgraph ev["Evaluate"]
      direction LR
      alerts[("<b>Alerts</b><br/><span>DocumentDB</span>")]
      build("<b>Load and build query</b>")
      query("<b>Query</b><br/><span>ClickHouse</span>")
      alerts --> build --> query
    end
    subgraph res["Compare"]
      direction LR
      check{"<b>Threshold<br/>crossed?</b>"}
      fire(["<b>Send webhook, record history</b>"])
      record(["<b>Record history</b>"])
      check -->|yes| fire
      check -->|no| record
    end
    ev --> res
  end
  class alerts store
  class build,query,fire,record part
  class check decision
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
  style cycle fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
  style ev fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
  style res fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
```

_Figure 3. L4 Detail -- Upstream alert evaluation._ Up:
[Architecture](README.md).

The checker runs once a minute. Each alert references a saved search or a
dashboard tile, from which a `ChartConfig` is derived and evaluated against
ClickHouse. Webhook bodies are templates with the alert's context.
