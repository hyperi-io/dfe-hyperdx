# Data flow

> **Documentation status.** This page was carried over from the original
> embedding design and still reads in places as a PLAN ("changes required",
> "files to modify") rather than a description of what the code does today. The
> structure and diagrams have been corrected; the prose has not yet been
> re-verified against the code line by line. Treat a specific claim here as
> needing a check until this note is removed.

### Write Path (Telemetry Ingestion)

```mermaid
flowchart LR
    subgraph Sources["Sources"]
        A1["App (OTLP gRPC)"]
        A2["App (OTLP HTTP)"]
        A3["App (Fluentd)"]
        A4["Browser (rrweb events)"]
    end

    subgraph OTel_Collector["OTel Collector"]
        direction TB
        RX["Receivers<br/>otlp, fluentforward"]
        TX["Processors<br/>transform, batch,<br/>memory_limiter"]
        RT["Routing Connector<br/>(logs)"]
        EX1["Exporter<br/>clickhouse"]
        EX2["Exporter<br/>clickhouse/rrweb"]
    end

    subgraph ClickHouse["ClickHouse"]
        T1["otel_logs"]
        T2["otel_traces"]
        T3["otel_metrics_*"]
        T4["hyperdx_sessions"]
    end

    A1 -->|:4317| RX
    A2 -->|:4318| RX
    A3 -->|:24225| RX
    A4 -->|:4318| RX
    RX --> TX --> RT
    RT -->|rr-web.event present| EX2
    RT -->|default| EX1
    EX1 --> T1 & T2 & T3
    EX2 --> T4
```

Key details:

- **Receivers** accept OTLP (gRPC on 4317, HTTP on 4318) and Fluentd (24225)
- **Transform processor** parses JSON log bodies, infers severity, normalizes
  case
- **Routing connector** inspects log attributes - events with `rr-web.event` are
  routed to the session replay pipeline (`hyperdx_sessions` table)
- **ClickHouse exporter** writes to `otel_logs`, `otel_traces`, and five metric
  tables via the native TCP protocol (port 9000)

### Read Path (Query Execution)

```mermaid
sequenceDiagram
    participant Browser
    participant API as HyperDX API
    participant CH as ClickHouse

    Browser->>Browser: renderChartConfig(chartConfig)<br/> to  parameterized SQL
    Browser->>API: POST /api/clickhouse-proxy<br/>(SQL + connection ID)
    API->>API: Validate session<br/>Load Connection credentials
    API->>CH: Proxy HTTP request<br/>(injected auth headers)
    CH-->>API: Query results (JSON)
    API-->>Browser: Query results
```

The query engine (`renderChartConfig` in `common-utils`) runs **in the
browser**, generating parameterized ClickHouse SQL. The API acts as an
authenticated proxy - it never interprets the SQL, only validates the session
and injects ClickHouse credentials.

In **local mode** (single-user deployment), the browser queries ClickHouse
directly, bypassing the proxy entirely.

### Alert Evaluation (Disabled in DFE - See DFE Rules and Hunts)

> **DFE note:** The HyperDX alert checker is **not started** in DFE deployments.
> Detection and alerting are handled by the DFE platform's rules engine and hunt
> workflows, which query ClickHouse directly. The alert API routes are blocked
> via Casbin RBAC. The code below documents upstream HyperDX's built-in alerting
> for reference only.

```mermaid
flowchart LR
    subgraph check_alerts_Background_Task_DISABLED_IN_DFE["check-alerts (Background Task) - DISABLED IN DFE"]
        LOAD["Load active alerts"]
        BUILD["Build ChartConfig<br/>from alert source"]
        QUERY["Execute query<br/>on ClickHouse"]
        EVAL["Compare result<br/>vs threshold"]
        FIRE["Send webhook<br/>notification"]
        HIST["Write AlertHistory"]
    end

    DB["FerretDB -> PostgreSQL"] --> LOAD
    LOAD --> BUILD --> QUERY
    CH[(ClickHouse)] <--> QUERY
    QUERY --> EVAL
    EVAL -->|Triggered| FIRE --> HIST
    EVAL -->|OK| HIST
    FIRE --> WH["Slack / Generic /<br/>Incident.io Webhook"]
    HIST --> DB
```

The alert checker runs as a separate Node.js process on a per-minute schedule.
Each alert references either a Saved Search or a Dashboard tile, from which a
`ChartConfig` is derived and evaluated against ClickHouse. Webhook notifications
use Mustache templates with full alert context.
