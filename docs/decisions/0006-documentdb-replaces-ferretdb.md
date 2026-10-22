# 0006 - DocumentDB replaces FerretDB

**Status:** accepted, 2026-10-22. Supersedes
[0001](0001-ferretdb-over-direct-postgres.md).

## Context

HyperDX keeps users, teams, dashboards and saved searches in a document store it
reaches through Mongoose. [0001](0001-ferretdb-over-direct-postgres.md) put
FerretDB in front of PostgreSQL for that. FerretDB is not a long-term option for
us, and MongoDB is licensed under the SSPL, which does not suit a product other
organisations deploy.

DocumentDB 1.0 shipped on 2026-10-19 under MIT: PostgreSQL extensions plus a
Mongo wire-protocol gateway, in one container. Upstream is moving its own dev,
CI and e2e runs to it in hyperdxio/hyperdx#3375.

## Decision

DFE runs HyperDX on DocumentDB 1.0 on PostgreSQL 18. HyperDX connects over TLS
with a SCRAM-SHA-256 login. Application code is unchanged, as it was under
FerretDB.

## Consequences

- One container replaces FerretDB and its PostgreSQL.
- `.github/workflows/dfe-documentdb.yml` runs the api integration suite, our
  `dfe/` tests included, on DocumentDB for every PR.
- DocumentDB fails the loser of two upserts racing to insert one unique key with
  11000 or 112, where MongoDB retries it. Our upserts go through
  `retryUpsertRace` in `packages/api/src/dfe/models/duplicate-key.ts`.
- FerretDB data is not migrated, so a deployment moving over starts fresh.

## Alternatives considered

- Staying on FerretDB, which is not a long-term option.
- MongoDB, whose SSPL does not suit.
- A direct PostgreSQL rewrite, rejected in 0001 for its cost on every upstream
  sync. That still holds.
