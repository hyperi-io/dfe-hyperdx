# dfe-hyperdx documentation

DFE's fork of [HyperDX](https://github.com/hyperdxio/hyperdx), embedded in the
DFE platform as its visualisation and search layer.

Four questions bring people here, and they are answered in different places:

| Question | Start at |
| --- | --- |
| **What does our fork do differently?** | [architecture.md](architecture.md) |
| **How do we maintain the fork?** | [fork/](fork/README.md) |
| How do I run it locally? | [development/](development/README.md) |
| Why was it built this way? | [decisions/](decisions/README.md) |

Which files are ours and which are upstream's matters more here than in a normal repo, because the answer decides whether
a change is free or expensive. Our files sit beside upstream's, and HyperI
standards apply to ours alone.

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
flowchart LR
  accTitle: L4 Detail -- Ours and upstream's files
  accDescr: Ours are our pages under docs, every dfe directory under packages, the security and githooks directories, our scripts and the workflows we added. Upstream's are agent_docs, the root agent and contributor docs, and everything under packages outside a dfe directory. Ownership is per file, and .fork-surface lists the upstream files we edit.
  subgraph ours["Ours, HyperI standards apply"]
    direction TB
    d("<b>Our pages</b><br/><span>under docs/</span>")
    dfe("<b>packages/**/dfe/**</b>")
    tools("<b>security/, .githooks/,</b><br/><span>our scripts/</span>")
    wf("<b>Our workflows</b>")
    d ~~~ dfe ~~~ tools ~~~ wf
  end
  subgraph theirs["Upstream's"]
    direction TB
    ad("<b>agent_docs/</b>")
    rootmd("<b>AGENTS.md, MCP.md, LOCAL.md,</b><br/><span>DEPLOY.md, CONTRIBUTING.md</span>")
    code("<b>packages/ outside dfe/</b>")
    ad ~~~ rootmd ~~~ code
  end
  ours ~~~ theirs
  class d,dfe,tools,wf part
  class ad,rootmd,code ext
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
  style ours fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
  style theirs fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
```

*Figure 1. L4 Detail -- Ours and upstream's files. Dashed boxes are upstream's.* Up: [dfe-hyperdx](../README.md).

Applying our conventions to `agent_docs/` or `AGENTS.md` would buy nothing and
create conflict surface on every sync. Where an upstream file does have a delta
of ours, `.fork-surface` lists it and [fork/what-we-changed.md](fork/what-we-changed.md)
says why. `README.md`, `CLAUDE.md` and `docs/alert-webhook-template-variables.md`
are the shared docs: upstream ships each, and each has a small delta of ours.

The documentation set:

```text
docs/
  architecture/    what the system is, and what DFE changes about it
  fork/            how the fork is held together and kept in sync
  development/     running it locally
  decisions/       ADRs - why we chose what we chose
```

Everything here is plain CommonMark plus fenced mermaid, so it renders on GitHub
without a build step.
