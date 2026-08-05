# Decisions

One file per decision that carried real trade-offs, so nobody re-litigates it
from scratch in a year.

**A record is immutable once accepted.** If the decision changes, add a new
record and mark the old one superseded with a link. The audit trail is the
point - a rewritten ADR is worth nothing.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-ferretdb-over-direct-postgres.md) | FerretDB over a direct PostgreSQL migration | accepted |
| [0002](0002-alerting-disabled-for-dfe-rules.md) | HyperDX alerting disabled in favour of DFE rules and hunts | accepted |
| [0003](0003-additive-only-fork-strategy.md) | Additive-only fork strategy | accepted |
| [0004](0004-casbin-removed.md) | Casbin RBAC removed as redundant | accepted |

## Adding one

`NNNN-kebab-slug.md`, monotonic prefix, and these headings: Context, Decision,
Consequences, Alternatives considered. Status runs proposed -> accepted ->
superseded.

Write it when the reasoning is fresh. An ADR reconstructed six months later is a
guess wearing a filename.
