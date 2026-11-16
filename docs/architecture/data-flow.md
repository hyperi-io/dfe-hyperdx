# Data flow

> **Scope.** This describes UPSTREAM HyperDX's architecture, which we do not
> modify. It is here so the fork's own docs are readable on their own.
> Upstream's [`agent_docs/`](../../agent_docs/) is the authority, and anything
> specific to DFE is called out as such.

## Write path

Upstream's collector takes OTLP and Fluentd input, and its routing connector
sends rrweb events to their own table and everything else to the OTel tables.

```mermaid
flowchart LR
    accTitle: L4 Detail -- Telemetry write path
    accDescr: Applications send OTLP and Fluentd input and browsers send rrweb events to the collector receivers. Processors transform and batch them, and the routing connector writes rrweb events to hyperdx_sessions and everything else to the OTel tables.

    subgraph sources["Sources"]
        otlp["Apps, OTLP"]
        fluent["Apps, Fluentd"]
        rrweb["Browsers, rrweb"]
    end

    receivers["Receivers"]
    processors["Processors"]
    routing{"rr-web.event<br/>present?"}
    sessions[("hyperdx_sessions")]
    otel[("otel_logs, traces,<br/>metrics")]

    sources --> receivers
    receivers --> processors
    processors --> routing
    routing -->|yes| sessions
    routing -->|no| otel

    classDef default fill:#F8FAFC,stroke:#64748B,stroke-width:1px,color:#0F172A
    classDef store fill:#DDF3EC,stroke:#00785A,stroke-width:1px,color:#0B3327
    classDef decision fill:#FCF1D6,stroke:#9A6700,stroke-width:1px,color:#3D2A00
    classDef ext fill:#EEF0F2,stroke:#6B7280,stroke-width:1px,stroke-dasharray:4 3,color:#1F2937
    classDef group fill:none,stroke:#64748B,stroke-width:1px,stroke-dasharray:2 4
    class otlp,fluent,rrweb ext
    class routing decision
    class sessions,otel store
    class sources group
```

<!-- prettier-ignore -->
*Figure 1. L4 Detail -- Telemetry write path. Dashed boxes are external.* Up: [Architecture](README.md).

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

<!-- prettier-ignore -->
*Figure 2. L4 Detail -- Query read path. Dashed arrows are answers.* Up: [L3 Components -- HyperDX API](backend.md#structure).

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
flowchart LR
    accTitle: L4 Detail -- Upstream alert evaluation
    accDescr: The alert checker loads active alerts from DocumentDB, builds each one's query, runs it on ClickHouse and compares the result with the threshold. A triggered alert sends a webhook and records history, and an alert within its threshold records history alone.

    alerts[("Alerts<br/>DocumentDB")]
    build["Load and<br/>build query"]
    query["Query<br/>ClickHouse"]
    check{"Threshold<br/>crossed?"}
    fire(["Send webhook,<br/>record history"])
    record(["Record history"])

    alerts --> build
    build --> query
    query --> check
    check -->|yes| fire
    check -->|no| record

    classDef default fill:#F8FAFC,stroke:#64748B,stroke-width:1px,color:#0F172A
    classDef store fill:#DDF3EC,stroke:#00785A,stroke-width:1px,color:#0B3327
    classDef decision fill:#FCF1D6,stroke:#9A6700,stroke-width:1px,color:#3D2A00
    class alerts store
    class check decision
```

<!-- prettier-ignore -->
*Figure 3. L4 Detail -- Upstream alert evaluation.* Up: [Architecture](README.md).

The checker runs once a minute. Each alert references a saved search or a
dashboard tile, from which a `ChartConfig` is derived and evaluated against
ClickHouse. Webhook bodies are templates with the alert's context.
