# HyperDX UI

The HyperDX UI is the search, charts and dashboards the DFE console frames, and
is one part of [dfe-hyperdx](../architecture.md).

| Fact      | Value                                                                                |
| --------- | ------------------------------------------------------------------------------------ |
| Repo      | `hyperi-io/dfe-hyperdx`, `packages/app`, our additions under `packages/app/src/dfe/` |
| Image     | `ghcr.io/hyperi-io/dfe-hyperdx`, deployed by dfe-infra's chart                       |
| Config    | `HYPERDX_APP_PORT`, 8080 by default                                                  |
| Endpoints | the Next.js pages on port 8080, framed by the console with `?embed=1`                |
| Metrics   | none of its own                                                                      |

Charts build their SQL in the browser and send it through the API's ClickHouse
proxy, and everything else goes through the API's REST routes.

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
  accTitle: L3 Components -- HyperDX UI
  accDescr: The DFE console frames the UI pages. Pages render charts through the browser ClickHouse client, which builds SQL with renderChartConfig, and load everything else through the API hooks. Both reach the HyperDX API.
  console("<b>DFE console</b><br/><span>dfe-ui</span>")
  subgraph app["HyperDX UI"]
    direction LR
    pages("<b>Pages</b><br/><span>search, dashboards</span>")
    chc("<b>ClickHouse client</b><br/><span>renderChartConfig</span>")
    hooks("<b>API hooks</b><br/><span>ky, TanStack Query</span>")
    pages --> chc
    pages --> hooks
  end
  api[["<b>HyperDX API</b><br/><span>Express</span>"]]
  console -->|frames| pages
  chc --> api
  hooks --> api
  class console,api ui
  class pages,chc,hooks part
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
  style app fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
```

_Figure 1. L3 Components -- HyperDX UI._ Up:
[L2 Services -- dfe-hyperdx](../architecture.md).

> **Scope.** This describes UPSTREAM HyperDX's frontend, which we do not modify,
> as the DFE console frames it. It is here so the fork's own docs are readable
> on their own. Upstream's [`agent_docs/`](../../agent_docs/) is the authority,
> and anything specific to DFE is called out as such.

## Structure

The DFE embed turns on four features, search, saved searches, the chart explorer
and dashboards (`packages/app/src/dfe/embedFeatures.ts`). A direct visit to
`/alerts`, `/sessions`, `/service-map` or `/team` is sent back to `/search`.

Key patterns:

- URL-driven state. Search filters, time ranges and dashboard contexts are
  encoded in URL parameters (`nuqs`), so every view is deep-linkable.
- Server state. TanStack Query manages API data, with hooks in `api.ts`,
  `dashboard.ts`, `savedSearch.ts`, `source.ts` and `sessions.ts`.
- Query engine in the browser. `renderChartConfig()` from `common-utils` runs
  client-side and generates parameterised SQL, sent through
  `/api/clickhouse-proxy`.
- UI library. Mantine components throughout, with Recharts and uPlot for charts,
  CodeMirror for SQL editing, and rrweb for session replay.
