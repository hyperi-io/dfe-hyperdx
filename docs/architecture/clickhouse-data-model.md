# ClickHouse data model

> **Scope.** This describes UPSTREAM HyperDX's architecture, which we do not
> modify. It is here so the fork's own docs are readable on their own.
> Upstream's [`agent_docs/`](../../agent_docs/) is the authority, and anything
> specific to DFE is called out as such.

HyperDX is not tied to any table schema. The **Source** model maps ClickHouse
table columns to semantic roles through SQL expressions. A connection holds the
ClickHouse login, and each source points one kind of telemetry at one table
through that connection.

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
  accTitle: L4 Detail -- Sources and tables
  accDescr: A connection holds the ClickHouse login. Log, trace, session and metric sources each read their own table through it.
  conn("<b>Connection</b><br/><span>host, user, password</span>")
  subgraph sources["Sources and their tables"]
    direction TB
    subgraph p1["Logs"]
      direction LR
      srclog("<b>Log source</b>") -->|reads| logs[("<b>otel_logs</b>")]
    end
    subgraph p2["Traces"]
      direction LR
      srctrace("<b>Trace source</b>") -->|reads| traces[("<b>otel_traces</b>")]
    end
    subgraph p3["Sessions"]
      direction LR
      srcsession("<b>Session source</b>") -->|reads| sessions[("<b>hyperdx_sessions</b>")]
    end
    subgraph p4["Metrics"]
      direction LR
      srcmetric("<b>Metric source</b>") -->|reads| metrics[("<b>otel_metrics_*</b>")]
    end
    p1 ~~~ p2 ~~~ p3 ~~~ p4
  end
  conn -->|login| sources
  class conn,srclog,srctrace,srcsession,srcmetric part
  class logs,traces,sessions,metrics store
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
  style sources fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
  style p1 fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
  style p2 fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
  style p3 fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
  style p4 fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
```

_Figure 1. L4 Detail -- Sources and tables._ Up: [Architecture](README.md).

A source's expression fields map semantic concepts to SQL over its table:
`timestampValueExpression`, `bodyExpression`, `severityTextExpression`,
`traceIdExpression`, `spanIdExpression`, `serviceNameExpression` and many more.
Sources cross-reference each other (`logSourceId`, `traceSourceId`,
`sessionSourceId`, `metricSourceId`), which is how the UI moves between
telemetry types. So HyperDX can work on top of any ClickHouse table: point it at
your schema and map the columns.

In DFE the engine owns sources. A team is seeded with `main` and `hunts`, and
the platform team with the OTel tables and ClickHouse's `system` database as
well
([what-we-changed.md](../fork/what-we-changed.md#dfe-integration-features)).

## Tables

Logs and traces join on `TraceId`, and traces join a browser session through the
`rum.sessionId` attribute.

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
    primaryColor: "#FFFFFF"
    primaryBorderColor: "#94A3B8"
    tertiaryColor: "#F4F6F8"
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
erDiagram
  direction LR
  accTitle: L4 Detail -- Upstream telemetry tables
  accDescr: otel_logs and otel_traces share TraceId, and otel_traces links to hyperdx_sessions through the rum.sessionId attribute.
  otel_logs {
    DateTime64 Timestamp
    String TraceId
    String ServiceName
    Map LogAttributes
  }
  otel_traces {
    DateTime64 Timestamp
    String TraceId
    String SpanId
    UInt64 Duration
  }
  hyperdx_sessions {
    DateTime TimestampTime
    String TraceId
    Map LogAttributes
  }
  otel_logs }o--o{ otel_traces : "TraceId"
  otel_traces }o--o{ hyperdx_sessions : "rum.sessionId"
```

_Figure 2. L4 Detail -- Upstream telemetry tables. Key columns only._ Up:
[Architecture](README.md).

The schema is in `docker/otel-collector/schema/seed/`. The telemetry tables are
MergeTree with ZSTD codecs, partitioned by day and expired by a TTL on their
timestamp. Rollups are SummingMergeTree, and `00008_otel_metrics_timeseries.sql`
adds a TimeSeries table. The primary `otel_logs` and `otel_traces` schemas use
`text` indexes on attribute maps, trace ids and the body or span name. The
`_compat` schemas and `hyperdx_sessions` use bloom filter and `tokenbf_v1`
indexes. Kubernetes resource attributes, and `rum.sessionId` on traces, are
materialised columns. The metrics land in five tables, `otel_metrics_gauge`,
`_sum`, `_histogram`, `_exponential_histogram` and `_summary`.
