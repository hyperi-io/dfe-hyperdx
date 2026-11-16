# Deployment

**The document store is DocumentDB, and HyperDX does not know.** Mongoose,
`connect-mongo`, `passport-local-mongoose`, `migrate-mongo` and every model and
route work unchanged: `MONGO_URI` points at the DocumentDB gateway.

---

## The data layer

The API's models and its session store both reach DocumentDB over an ordinary
`mongodb://` connection.

```mermaid
flowchart LR
    accTitle: L4 Detail -- Document store
    accDescr: The unmodified HyperDX API models and the connect-mongo session store connect to DocumentDB through its Mongo wire-protocol gateway.

    subgraph app["HyperDX, unmodified"]
        models["API models<br/>Mongoose"]
        sessions["Session store<br/>connect-mongo"]
    end

    docdb[("DocumentDB<br/>PostgreSQL 18")]

    app -->|mongodb://| docdb

    classDef default fill:#F8FAFC,stroke:#64748B,stroke-width:1px,color:#0F172A
    classDef store fill:#DDF3EC,stroke:#00785A,stroke-width:1px,color:#0B3327
    classDef group fill:none,stroke:#64748B,stroke-width:1px,stroke-dasharray:2 4
    class docdb store
    class app group
```

<!-- prettier-ignore -->
*Figure 1. L4 Detail -- Document store.* Up: [L3 Components -- HyperDX API](backend.md#structure).

The gateway speaks the MongoDB wire protocol, so standard drivers and tools
(`mongosh`, Compass, `mongodump`) connect with an ordinary `mongodb://` string.
Documents land in PostgreSQL as BSON through the DocumentDB extensions, which
brings PostgreSQL's backup, replication and monitoring to the data. On
Kubernetes the DocumentDB operator runs the cluster on CloudNativePG (dfe-infra
`helm/charts/documentdb`).

In compose, the override is `docker-compose.dfe.yml`, which replaces the `db`
service and repoints the app. **Read that file for the values**: reproducing
them here makes a second copy to go stale.

Two things about it are easy to get wrong:

- TLS and SCRAM-SHA-256. The gateway rejects plain connections. `MONGO_URI` sets
  `tls=true`, a `tlsCAFile` for the CA that the `documentdb-tls` service mints,
  and `authMechanism=SCRAM-SHA-256`.
- The gateway listens on 10260 in the container. Compose reaches it at
  `documentdb:10260`, and the dev override publishes it as 27017.

Credentials come from the environment (`POSTGRES_USER`, `POSTGRES_PASSWORD`),
not from literals in the compose file.

---

## Service topology

In the compose stack, applications send telemetry to the collector and users
reach the app, and both write to or read ClickHouse.

```mermaid
flowchart LR
    accTitle: L4 Detail -- Compose services
    accDescr: Instrumented applications send OTLP to the otel-collector, which writes ClickHouse. Users reach the app container, which queries ClickHouse and keeps its documents in DocumentDB.

    senders["Instrumented<br/>applications"]
    users["Users"]
    otel["otel-collector"]
    app["app<br/>UI, API, OpAMP"]
    ch[("ClickHouse")]
    docdb[("DocumentDB")]

    senders -->|OTLP| otel
    users -->|UI and API| app
    otel -->|writes| ch
    app -->|queries| ch
    app -->|documents| docdb

    classDef default fill:#F8FAFC,stroke:#64748B,stroke-width:1px,color:#0F172A
    classDef store fill:#DDF3EC,stroke:#00785A,stroke-width:1px,color:#0B3327
    classDef ext fill:#EEF0F2,stroke:#6B7280,stroke-width:1px,stroke-dasharray:4 3,color:#1F2937
    class senders,users ext
    class ch,docdb store
```

<!-- prettier-ignore -->
*Figure 2. L4 Detail -- Compose services. Dashed boxes are external.* Up: [Architecture](README.md).

The `app` container bundles the Next.js frontend and the Express API. The
collector runs in **OpAMP supervisor mode**: it takes its pipeline from the
API's OpAMP server at runtime rather than from a static file, which is why the
API is both a query server and a control plane. It scrapes ClickHouse's
Prometheus metrics as well as writing telemetry. Image tags and ports live in
the compose files, and
[../development/docker-local.md](../development/docker-local.md) covers running
it locally.

In the DFE platform the console frames the app and the API verifies the engine's
token, see [oidc-authentication.md](oidc-authentication.md). The DFE pipeline
writes the telemetry, so no collector of HyperDX's runs there. Alerting stays
upstream's code with nobody able to create an alert
([ADR 0002](../decisions/0002-alerting-disabled-for-dfe-rules.md)).
