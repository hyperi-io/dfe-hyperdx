# ClickHouse data model

> **Documentation status.** This page was carried over from the original
> embedding design and still reads in places as a PLAN ("changes required",
> "files to modify") rather than a description of what the code does today. The
> structure and diagrams have been corrected; the prose has not yet been
> re-verified against the code line by line. Treat a specific claim here as
> needing a check until this note is removed.

The central architectural innovation: HyperDX is not tied to any specific table
schema. The **Source** model maps ClickHouse table columns to semantic roles via
SQL expressions.

```mermaid
flowchart LR
    subgraph Configuration_FerretDB_PostgreSQL["Configuration (FerretDB -> PostgreSQL)"]
        CONN["Connection<br/>host, user, password"]
        SRC_LOG["Source (Log)<br/>from: default.otel_logs"]
        SRC_TRACE["Source (Trace)<br/>from: default.otel_traces"]
        SRC_SESSION["Source (Session)<br/>from: default.hyperdx_sessions"]
        SRC_METRIC["Source (Metric)<br/>from: default.otel_metrics_*"]
    end

    subgraph Expression_Mapping["Expression Mapping"]
        direction TB
        TS["timestampValueExpression<br/>-> TimestampTime"]
        BODY["bodyExpression<br/>-> Body"]
        SEV["severityTextExpression<br/>-> SeverityText"]
        TID["traceIdExpression<br/>-> TraceId"]
        SID["spanIdExpression<br/>-> SpanId"]
        SVC["serviceNameExpression<br/>-> ServiceName"]
    end

    subgraph ClickHouse_Tables["ClickHouse Tables"]
        T1["otel_logs"]
        T2["otel_traces"]
        T3["hyperdx_sessions"]
        T4["otel_metrics_*"]
    end

    CONN --- SRC_LOG & SRC_TRACE & SRC_SESSION & SRC_METRIC
    SRC_LOG --> TS & BODY & SEV & TID
    SRC_LOG --> T1
    SRC_TRACE --> T2
    SRC_SESSION --> T3
    SRC_METRIC --> T4

    SRC_LOG -.->|cross-references| SRC_TRACE
    SRC_LOG -.->|cross-references| SRC_SESSION
```

Each Source has 20+ expression fields that map semantic concepts (timestamp,
body, severity, trace ID, span ID, service name, etc.) to arbitrary SQL
expressions over the underlying table. Sources cross-reference each other
(`logSourceId`, `traceSourceId`, `sessionSourceId`, `metricSourceId`), enabling
navigation between telemetry types.

This means HyperDX can work on top of **any** ClickHouse table - you point it at
your existing schema and map the columns.

### ClickHouse Data Model

```mermaid
erDiagram
    otel_logs {
        DateTime TimestampTime PK
        DateTime64 Timestamp
        String TraceId
        String SpanId
        UInt8 TraceFlags
        String SeverityText
        Int32 SeverityNumber
        String ServiceName
        String Body
        Map ResourceAttributes
        Map LogAttributes
        String ScopeName
    }

    otel_traces {
        DateTime Timestamp PK
        String TraceId
        String SpanId
        String ParentSpanId
        String ServiceName
        String SpanName
        String SpanKind
        String StatusCode
        Map ResourceAttributes
        Map SpanAttributes
        UInt64 Duration
        Map Events_Timestamp
        Map Events_Name
        Map Events_Attributes
        Map Links_TraceId
        Map Links_SpanId
    }

    hyperdx_sessions {
        DateTime TimestampTime PK
        String TraceId
        String Body
        String ServiceName
        Map ResourceAttributes
        Map LogAttributes
    }

    otel_metrics_gauge {
        DateTime TimeUnix PK
        String MetricName
        String ServiceName
        Float64 Value
        Map ResourceAttributes
        Map MetricAttributes
    }

    otel_logs ||--o{ otel_traces : "TraceId"
    otel_logs ||--o{ hyperdx_sessions : "rum.sessionId"
    otel_traces ||--o{ hyperdx_sessions : "rum.sessionId"
```

All tables use:

- **MergeTree** engine with ZSTD compression
- **Partitioning** by `toDate(Timestamp)`
- **TTL** based on timestamp for automatic data expiry
- **Bloom filter indexes** on attribute map keys/values for fast filtering
- **tokenbf_v1** full-text index on Body/SpanName for text search
- **Materialized columns** for frequently-accessed nested attributes (e.g.,
  Kubernetes metadata, `rum.sessionId`)
