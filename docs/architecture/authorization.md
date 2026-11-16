# Authorization

**The DFE engine decides, ClickHouse enforces, HyperDX scopes by team.**

HyperDX holds no policy store of its own in this fork. Casbin RBAC was removed
as redundant, see [ADR 0004](../decisions/0004-casbin-removed.md) for why.

---

## Who decides what

The engine names the session's team, the API scopes every document by that team,
and ClickHouse holds the team's user to its GRANTs.

```mermaid
flowchart LR
    accTitle: L4 Detail -- Authorization layers
    accDescr: A signed-in request reaches the HyperDX API. The API asks the DFE engine which team the session is on, scopes every DocumentDB query by that team, and queries ClickHouse as the team's own ClickHouse user, whose GRANTs decide what it reads.

    user["Signed-in user"]
    api["HyperDX API"]
    engine["DFE engine"]
    docdb[("DocumentDB")]
    ch[("ClickHouse<br/>GRANTs")]

    user -->|engine token| api
    api -->|which team| engine
    api -->|team scoped| docdb
    api -->|team's user| ch

    classDef default fill:#F8FAFC,stroke:#64748B,stroke-width:1px,color:#0F172A
    classDef store fill:#DDF3EC,stroke:#00785A,stroke-width:1px,color:#0B3327
    classDef ext fill:#EEF0F2,stroke:#6B7280,stroke-width:1px,stroke-dasharray:4 3,color:#1F2937
    class user ext
    class docdb,ch store
```

_Figure 1. L4 Detail -- Authorization layers. The dashed box is outside
dfe-hyperdx._ Up: [L3 Components -- HyperDX API](backend.md#structure).

Three layers, each doing one thing:

1. The engine says who the user is and which ClickHouse user the session reads
   as. dfe-hyperdx verifies the engine's token and asks the engine about every
   session. See [oidc-authentication.md](oidc-authentication.md).
2. HyperDX maps that identity to a User and a Team, then scopes every query by
   `team`. Every route handler does this, which is why Casbin was redundant, and
   the fork corrects `getTeam(id)` to filter by that id. Our admin lockdown on
   top refuses human writes to teams, sources and connections, and every human
   request to alerts and webhooks.
3. ClickHouse enforces data access with GRANTs. Each Team's `Connection` record
   holds that team's ClickHouse username and password, so a query that escaped
   the application-level scoping still cannot read another team's data.

The engine is the policy decision point for the wider platform. HyperDX consults
it per session, cached for 30 seconds, and the decision is expressed as which
ClickHouse user a Team's connection holds
([team-identity.md](team-identity.md)).

Application-level scoping is a correctness property of upstream's code, and
upstream can change it. Data-layer GRANTs are ours, and they hold regardless.

That is the useful division. We do not re-implement upstream's tenancy inside
their code, which would be conflict surface to defend on every sync. We put our
enforcement where upstream cannot reach.

A route under `packages/api/src/dfe/` inherits nothing automatically. Scope your
query by `req.user.team` the way upstream's handlers do, and assume the
ClickHouse credentials in play are the right ones for that team.
