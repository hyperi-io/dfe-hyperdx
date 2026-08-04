# Deployment

> **Documentation status.** This page was carried over from the original
> embedding design and still reads in places as a PLAN ("changes required",
> "files to modify") rather than a description of what the code does today. The
> structure and diagrams have been corrected; the prose has not yet been
> re-verified against the code line by line. Treat a specific claim here as
> needing a check until this note is removed.

For production, we replace MongoDB with [FerretDB](https://www.ferretdb.com/) -
an open-source proxy that speaks the MongoDB wire protocol but stores data in
PostgreSQL via the
[DocumentDB extension](https://github.com/FerretDB/documentdb). HyperDX requires
**zero code changes**; the Mongoose ODM, `connect-mongo` session store, and all
MongoDB queries work transparently through FerretDB.

### Why FerretDB

- **Drop-in replacement**: FerretDB implements the MongoDB 5.0+ wire protocol.
  Existing drivers, tools (mongosh, Compass, mongodump), and ODMs (Mongoose)
  connect to it with a standard `mongodb://` connection string.
- **PostgreSQL backend**: All document data is stored in PostgreSQL as JSONB via
  the DocumentDB extension, giving you PostgreSQL's mature ecosystem for
  backups, replication, monitoring, and operational tooling.
- **No vendor lock-in**: Apache 2.0 licensed, avoids MongoDB's SSPL.
- **No application migration needed**: HyperDX talks to FerretDB exactly as it
  would to MongoDB. The `MONGO_URI` just points at FerretDB instead.

### Architecture with FerretDB

```mermaid
flowchart LR
    subgraph HyperDX_Application["HyperDX Application"]
        API["HyperDX API<br/>(Mongoose ODM)"]
        SESS["Session Store<br/>(connect-mongo)"]
    end

    subgraph FerretDB_Layer["FerretDB Layer"]
        FERRET["FerretDB Proxy<br/>:27017<br/>(MongoDB wire protocol)"]
    end

    subgraph PostgreSQL["PostgreSQL"]
        PG[(PostgreSQL 17<br/>+ DocumentDB Extension<br/>:5432)]
    end

    API -->|mongodb://ferretdb:27017/hyperdx| FERRET
    SESS -->|mongodb://ferretdb:27017/hyperdx| FERRET
    FERRET -->|SQL over<br/>PostgreSQL protocol| PG
```

HyperDX connects to FerretDB using a standard MongoDB connection string.
FerretDB translates MongoDB wire protocol operations into SQL and executes them
against PostgreSQL with the DocumentDB extension. The DocumentDB extension adds
native BSON support and document operations to PostgreSQL.

### Production Docker Compose

Replace the `db` service in `docker-compose.yml` with two services:

```yaml
services:
  postgres:
    image: ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0
    restart: on-failure
    environment:
      - POSTGRES_USER=hyperdx
      - POSTGRES_PASSWORD=hyperdx
      - POSTGRES_DB=postgres
    volumes:
      - .volumes/pg_data:/var/lib/postgresql/data
    networks:
      - internal

  ferretdb:
    image: ghcr.io/ferretdb/ferretdb:2.7.0
    restart: on-failure
    environment:
      - FERRETDB_POSTGRESQL_URL=postgres://hyperdx:hyperdx@postgres:5432/postgres
    depends_on:
      - postgres
    networks:
      - internal

  app:
    # ... existing app config, only change MONGO_URI:
    environment:
      MONGO_URI: 'mongodb://hyperdx:hyperdx@ferretdb:27017/hyperdx'
      # ... all other env vars unchanged
```

Key points:

- **`postgres`** runs PostgreSQL 17 with the DocumentDB extension pre-installed.
  `POSTGRES_DB` must be `postgres` (required by DocumentDB for `pg_cron`).
- **`ferretdb`** is a stateless proxy that translates MongoDB protocol to SQL.
  It connects to PostgreSQL via `FERRETDB_POSTGRESQL_URL`.
- **`app`** changes only `MONGO_URI` to point at FerretDB. All application code,
  Mongoose models, session storage, and alert checking work unchanged.
- Pin both image tags to matching versions (e.g. `17-0.107.0-ferretdb-2.7.0` and
  `ferretdb:2.7.0`) to avoid compatibility issues between DocumentDB and
  FerretDB releases.

### Full Production Service Topology

```mermaid
flowchart TB
    subgraph Docker_Compose_Network_hdx_oss["Docker Compose Network (hdx-oss)"]
        APP["app<br/>(HyperDX all-in-one)<br/>Ports: API + UI + OpAMP"]
        OTEL["otel-collector<br/>(OTel Contrib + OpAMP Supervisor)<br/>Ports: 4317, 4318, 24225"]
        CH["ch-server<br/>(ClickHouse 25.6)<br/>Ports: 8123, 9000"]
        FERRET["ferretdb<br/>(FerretDB 2.7)<br/>Port: 27017"]
        PG["postgres<br/>(PostgreSQL 17 + DocumentDB)<br/>Port: 5432"]
    end

    APP -->|Queries HTTP| CH
    APP -->|Metadata Mongoose| FERRET
    FERRET -->|SQL| PG
    APP <-->|OpAMP protobuf| OTEL
    OTEL -->|Writes TCP| CH
    OTEL -->|Scrapes metrics| CH

    EXT["External Traffic"] -->|:4317/:4318<br/>OTLP| OTEL
    EXT -->|:8080<br/>UI + API| APP
```

### What Stays the Same

Everything in HyperDX is unchanged:

- **Mongoose models** - User, Team, Dashboard, Alert, SavedSearch, Connection,
  Source, Webhook, etc. all work identically
- **Session store** - `connect-mongo` stores sessions via the same MongoDB
  protocol; FerretDB handles the translation
- **Passport.js auth** - `passport-local-mongoose` plugin works through Mongoose
- **Alert checker** - background task queries metadata through the same ODM
  layer
- **Migrations** - `migrate-mongo` runs against FerretDB the same way
- **All API routes and controllers** - no code changes required

### Service Topology

```mermaid
flowchart TB
    subgraph Docker_Compose_Network_hdx_oss["Docker Compose Network (hdx-oss)"]
        APP["app<br/>(hyperdx-all-in-one)<br/>Ports: API + UI + OpAMP"]
        OTEL["otel-collector<br/>(OTel Contrib + OpAMP Supervisor)<br/>Ports: 4317, 4318, 24225"]
        CH["ch-server<br/>(ClickHouse 25.6)<br/>Ports: 8123 (HTTP), 9000 (TCP)"]
        FERRET["ferretdb<br/>(FerretDB 2.7)<br/>Port: 27017"]
        PG["postgres<br/>(PostgreSQL 17 + DocumentDB)<br/>Port: 5432"]
    end

    APP -->|Queries HTTP| CH
    APP -->|Metadata Mongoose| FERRET
    FERRET -->|SQL| PG
    APP <-->|OpAMP protobuf| OTEL
    OTEL -->|Writes TCP| CH
    OTEL -->|Scrapes metrics| CH

    EXT["External Traffic"] -->|:4317/:4318<br/>OTLP| OTEL
    EXT -->|:8080<br/>UI + API| APP
```

In production, five services run in a single Docker Compose network. The `app`
container bundles both the Next.js frontend and the Express API. FerretDB sits
between the app and PostgreSQL, translating MongoDB wire protocol to SQL
transparently. The OTel collector runs in **OpAMP supervisor mode** - it
receives its pipeline configuration dynamically from the API server.
