# 0006 - DocumentDB as the document store

**Status:** accepted.

## Context

HyperDX keeps users, teams, dashboards and saved searches in a document store it
reaches through Mongoose. MongoDB is licensed under the SSPL, which does not suit
a product other organisations deploy, and a direct PostgreSQL rewrite would cost
effort on every upstream sync.

DocumentDB 1.0 shipped on 2026-10-19 under MIT: PostgreSQL extensions plus a
Mongo wire-protocol gateway, in one container. Upstream is moving its own dev,
CI and e2e runs to it in hyperdxio/hyperdx#3375.

## Decision

DFE runs HyperDX on DocumentDB 1.0 on PostgreSQL 18. HyperDX connects over TLS
with a SCRAM-SHA-256 login. Application code is unchanged.

## Consequences

- One container holds the extensions and the gateway.
- `.github/workflows/dfe-documentdb.yml` runs the api integration suite, our
  `dfe/` tests included, on DocumentDB for every PR.
- DocumentDB fails the loser of two upserts racing to insert one unique key with
  11000 or 112, where MongoDB retries it. Our upserts go through
  `retryUpsertRace` in `packages/api/src/dfe/models/duplicate-key.ts`.

## Alternatives considered

- MongoDB, whose SSPL does not suit.
- A direct PostgreSQL rewrite, rejected for its cost on every upstream sync.
