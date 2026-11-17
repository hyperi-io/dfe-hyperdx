# Leaving the upstream dependency

**Forking is a position, not a destination.** The intent is to stop tracking
hyperdxio/hyperdx once HyperDX's rate of change slows and stabilises, most
likely by merging the code into DFE and keeping a copy there (C below). Until
then all our work stays in the fork. This doc exists so that decision gets made
deliberately rather than drifted into.

---

## Three ways out

From where we stand there are three ways out, and only a de-fork ends with less
to carry.

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
  accTitle: L4 Detail -- Three ways out of the fork
  accDescr: From forked and syncing, A stays forked and keeps syncing, B lets upstream absorb our delta and ends as a plain dependency, and C stops merging and copies the code into DFE, ending with us owning an observability platform.
  now(["<b>Forked,</b><br/><span>syncing</span>"])
  subgraph ways["Three ways out"]
    direction LR
    a("<b>A. Stay forked,</b><br/><span>keep syncing</span>")
    b("<b>B. De-fork,</b><br/><span>upstream absorbs our delta</span>")
    c("<b>C. Hard fork,</b><br/><span>stop merging</span>")
  end
  done(["<b>Plain dependency</b>"])
  own(["<b>We own an observability platform</b>"])
  now --> a
  now --> b
  now --> c
  b -->|best outcome| done
  c -->|expected exit| own
  class now,a,b,done part
  class c,own error
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
  style ways fill:none,stroke:#0072B2,stroke-width:1.5px,stroke-dasharray:6 4
```

_Figure 1. L4 Detail -- Three ways out of the fork. Orange is the expensive way
out._ Up: [The fork](README.md).

**A. Stay forked (today's position).** Cheapest while upstream moves fast and
our delta is small. The cost is a recurring sync, and the whole apparatus in
[design.md](design.md) exists to keep that cost roughly flat as upstream
accelerates.

**B. Upstream absorbs our delta, and we de-fork to a plain dependency.** The
best outcome, and not hypothetical. In 2.33.0 upstream added a "kiosk mode" that
hides the nav on dashboards - our embed feature arriving under a different name.
`packages/app/src/layout.tsx` has both conditions. Every time upstream lands
something we hold, our delta shrinks and the case for B strengthens. We do not
push our delta upstream to get there, so B only happens when upstream lands what
we hold on its own.

**C. Hard fork - stop merging, copy the code into DFE.** The expected way out,
and the expensive one. Right once upstream's rate of change has slowed enough
that its releases stop being worth the merge, and we have the people to maintain
a full observability platform. Taken as a decision, never slid into by neglect.

---

## Decide on evidence, not on fatigue after a bad sync

| Signal                            | Where to get it                                                                     | Argues for                                             |
| --------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Delta size and files touched      | `.githooks/fork-surface-check.py --audit`, [what-we-changed.md](what-we-changed.md) | shrinking -> B, growing into upstream's hot files -> C |
| Sync cost over time               | the table in [sync-track-record.md](sync-track-record.md)                           | rising despite the ladder -> C                         |
| Upstream velocity                 | `--drift` and the release cadence                                                   | slowing -> C cheaper, B less urgent                    |
| What we would lose                | the package table in [../architecture/README.md](../architecture/README.md)         | more we do not maintain -> A or B                      |
| Whether the delta is ours to keep | the catalogue                                                                       | branding and config evaporate under B                  |

---

## What a hard fork would actually cost

Not a rename. It means:

- Taking ownership of the dependency tree. Upstream patches it for us, through
  the pins in its `resolutions` block that we inherit for free.
- Maintaining what we do not touch today: the OTel collector build, the MCP
  server, the CLI, the eval harness.
- Losing the delta gate's meaning. Its whole job is proving an upstream change
  did not break us. With no upstream, it is a test suite.

The security layer is the honest measure of that first cost. Every pin and patch
it holds is work upstream does that we would inherit for good. An empty
`security/overrides.yaml` is the goal state precisely because it means upstream
is still carrying that load.

> **This is a human decision, taken once, with the numbers in front of us.** It
> is not an agent's call, and not something to conclude in the middle of a sync.
