# 0004 - Casbin RBAC removed as redundant

**Status:** accepted

## Context

The original DFE embedding design added Casbin RBAC to HyperDX: a shared
`casbin_rule` table in PostgreSQL, enforced by middleware in the HyperDX API and
shared with the DFE Python UI so both spoke to one policy store.

The goal was tenant isolation - stopping a user on team A from reading team B's
data.

## Decision

**Remove it.** Casbin, its middleware, its model file and its dependencies are
gone from the fork.

Authorization is owned by the DFE engine as the policy decision point, and
enforced at the data layer by ClickHouse GRANTs. HyperDX trusts the identity
injected at the edge by Envoy.

## Why it was redundant

Every HyperDX route handler already self-scopes its queries by `team`. Tenant
isolation holds without Casbin, and cross-team access was never reachable
through the API in the first place. The middleware was re-checking a constraint
the query layer had already enforced.

That made it pure cost: a policy store to keep in sync, a second place for an
authorization bug to hide, and a dependency on a shared table across two
services in different languages.

## Consequences

- **Removed:** `dfe/middleware/casbin-authz.ts`, `dfe/bootstrap.ts`,
  `rbac_with_tenants_model.conf`, and the `casbin` and `casbin-pg-adapter`
  dependencies.
- PostgreSQL still backs FerretDB, but no longer holds policy.
- Authorization decisions and their audit trail move to the DFE engine, which is
  where the rest of DFE's policy already lives.
- Data-layer enforcement is now the backstop: a ClickHouse user per team, with
  GRANTs, configured on each Team's Connection.

## Alternatives considered

**Keep Casbin as defence in depth.** Rejected: it was not defending anything the
query scoping did not already cover, and a second authorization layer that is
never the one that fires is a liability rather than a safety net - it invites
the assumption that it is load-bearing.

**Move Casbin into the DFE engine only.** This is effectively what happened. The
engine owns policy; what was removed is the HyperDX-side enforcement copy.

## Notes

Design-era documentation describing the Casbin model in detail was carried in
the original architecture document. It has been removed rather than migrated -
describing a component that is not in the code is exactly the drift the
documentation rules exist to prevent. The reasoning is preserved here.
