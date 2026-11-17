# Authorization

**The DFE engine decides, ClickHouse enforces, HyperDX scopes by team.**

HyperDX holds no policy store of its own in this fork. Casbin RBAC was removed
as redundant, see [ADR 0004](../decisions/0004-casbin-removed.md) for why.

---

## Who decides what

The engine names the session's team, the API scopes every document by that team,
and ClickHouse holds the team's user to its GRANTs.

```mermaid
---
config:
  theme: base
  look: neo
  fontFamily: Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif
  flowchart:
    curve: linear
    nodeSpacing: 40
    rankSpacing: 64
    padding: 18
    wrappingWidth: 280
    htmlLabels: true
  elk:
    preset: modelOrder
  themeVariables:
    fontSize: 15px
    lineColor: "#64748B"
    primaryTextColor: "#0F172A"
    clusterBorder: "#0072B2"
    edgeLabelBackground: "#FFFFFF"
  themeCSS: >-
    p{margin:0}
    .node[data-look] rect,.node[data-look] path,.node[data-look] polygon,.node[data-look] .outer-path{filter:drop-shadow(0 1px 2px rgba(15,23,42,.10)) drop-shadow(0 6px 14px rgba(15,23,42,.10))}
    .node rect{rx:10px;ry:10px}
    .cluster rect{rx:16px;ry:16px}
    .node .label div{min-width:150px}
    .node.decision .label div{min-width:0}
    .cluster[data-look] rect{filter:none}
    .nodeLabel{line-height:1.35}
    .nodeLabel b{font-weight:600;font-size:15px;letter-spacing:-0.01em}
    .nodeLabel span{font-size:12.5px;font-weight:400;color:#334155}
    .cluster-label span.nodeLabel{display:inline-block;background:#FFFFFF;color:#0B2A3F;border:1.5px solid #0072B2;border-radius:999px;padding:2px 12px;font-size:11.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
    .flowchart-link{stroke-width:1.75px}
    .labelBkg{background:transparent!important}
    span.edgeLabel{display:inline-block;background:#FFFFFF!important;color:#1E293B;border:1px solid #94A3B8;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:500}
    span.edgeLabel p{background:transparent!important}
    .label-icon{width:20px;height:20px;vertical-align:-4px;margin-right:6px}
    .ingest .label-icon{color:#0E8A7D}
    .xform .label-icon{color:#7B4FB0}
    .load .label-icon{color:#0072B2}
    .bus .label-icon{color:#A8517F}
    .store .label-icon{color:#00785A}
    .ui .label-icon{color:#D9480F}
    .ext .label-icon{color:#64748B}
---
flowchart TB
  accTitle: L4 Detail -- Authorization layers
  accDescr: A signed-in request reaches the HyperDX API. The API asks the DFE engine which team the session is on, scopes every DocumentDB query by that team, and queries ClickHouse as the team's own ClickHouse user, whose GRANTs decide what it reads.
  user("<b>Signed-in user</b>")
  api("<b>HyperDX API</b>")
  subgraph back["Behind the API"]
    direction LR
    engine("<b>DFE engine</b><br/><span>session and identity</span>")
    docdb[("<b>DocumentDB</b>")]
    ch[("<b>ClickHouse</b><br/><span>GRANTs</span>")]
  end
  user -->|engine token| api
  api -->|which team| engine
  api -->|team scoped| docdb
  api -->|team's user| ch
  class user ext
  class api ui
  class engine control
  class docdb,ch store
  classDef ext fill:#F4F6F8,stroke:#94A3B8,stroke-width:1.5px,stroke-dasharray:5 4,color:#0F172A
  classDef ingest fill:#FFFFFF,stroke:#0E8A7D,stroke-width:3px,color:#0F172A
  classDef xform fill:#FFFFFF,stroke:#7B4FB0,stroke-width:3px,color:#0F172A
  classDef load fill:#FFFFFF,stroke:#0072B2,stroke-width:3px,color:#0F172A
  classDef bus fill:#FFFFFF,stroke:#A8517F,stroke-width:3px,color:#0F172A
  classDef store fill:#FFFFFF,stroke:#00785A,stroke-width:3px,color:#0F172A
  classDef ui fill:#FFFFFF,stroke:#D9480F,stroke-width:3px,color:#0F172A
  classDef decision fill:#FFFFFF,stroke:#9A6700,stroke-width:3px,color:#0F172A
  classDef error fill:#FFFFFF,stroke:#C2410C,stroke-width:3px,color:#0F172A
  classDef control fill:#FFFFFF,stroke:#334155,stroke-width:3px,color:#0F172A
  classDef part fill:#FFFFFF,stroke:#94A3B8,stroke-width:1.5px,color:#0F172A
  style back fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
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
