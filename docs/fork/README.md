# The fork

`dfe-hyperdx` is a long-lived fork of
[hyperdxio/hyperdx](https://github.com/hyperdxio/hyperdx). We merge upstream
repeatedly, forever, and everything in these docs exists to keep that cheap.

**The governing rule: minimise what we change in anything that comes from
upstream.** Every edit to a pristine upstream file becomes permanent
merge-conflict surface. Getting it wrong does not fail loudly. It
makes every future sync more expensive, and the bill arrives months later for
whoever runs one.

| You want to | Read |
| --- | --- |
| Know what we changed and why | [what-we-changed.md](what-we-changed.md) |
| Understand how the fork is held together | [design.md](design.md) |
| Run an upstream sync | [sync-cycle.md](sync-cycle.md) |
| See what each sync cost | [sync-track-record.md](sync-track-record.md) |
| Know how this ends | [leaving-upstream.md](leaving-upstream.md) |
| Make a change without adding conflict surface | [working-guide.md](working-guide.md) |

---

## What we own, in one diagram

Every upstream merge takes four kinds of content, and the catalogued in-place
edits are the only kind that can conflict.

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
  accTitle: L4 Detail -- What an upstream merge takes
  accDescr: Our dfe directories never conflict, catalogued in-place edits conflict and rerere replays them, the security layer is stripped before the merge and rebuilt after, and the rest of the tree is taken whole from upstream. The build and tests after the merge are the proof.
  subgraph ours["What we own"]
    direction LR
    dfedir("<b>packages/**/dfe/**</b>")
    inplace("<b>In-place edits</b><br/><span>.fork-surface</span>")
    temp("<b>Security layer</b><br/><span>overrides, patches</span>")
  end
  rest("<b>Upstream's tree</b>")
  merge("<b>Upstream merge</b>")
  gate(["<b>Build and test</b>"])
  dfedir -->|never conflicts| merge
  inplace -->|rerere replays| merge
  temp -->|stripped first| merge
  rest -->|taken whole| merge
  merge --> gate
  ours ~~~ rest
  class dfedir,temp,merge,gate part
  class inplace error
  class rest ext
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
```

*Figure 1. L4 Detail -- What an upstream merge takes. The orange box is the one that costs us on a sync.* Up: [dfe-hyperdx documentation](../README.md).

Keeping that box small is the whole game, and [design.md](design.md) is how.

The five rules that follow from it:

1. New code goes under a `dfe/` directory. Those paths do not exist upstream,
   so they have zero conflict risk. This is the default.
2. Editing an upstream file in place is an EXCEPTION. It must be identified,
   documented in [what-we-changed.md](what-we-changed.md), and listed in
   `.fork-surface` so the guard passes.
3. Never bulk-reformat an upstream file. A repo-wide formatter rewrites lines
   we do not own, which destroys rerere's ability to replay and makes every
   later sync a fresh hand-resolve.
4. Never merge upstream onto `main` by hand. The sync workflow does it on a bot
   branch and opens a PR.
5. All our work happens in the fork. Features, fixes and security fixes land
   here, and raising them upstream is not part of the process. When
   upstream fixes something we hold, `--check`, `--apply` and `--drift` say so
   and we delete our copy. The long-term plan is in
   [leaving-upstream.md](leaving-upstream.md).

Our files follow HyperI documentation standards. Upstream's files, docs
included, are left as upstream ships them unless `.fork-surface` lists a delta:
`agent_docs/`, `AGENTS.md` and the rest are theirs, and adding our conventions
to them would be conflict surface bought for nothing.

---

## The tooling

Run `fork-setup.sh` once per clone. Rerere, the conflict-surface hook and the
lockfile merge driver are all per-clone git config, and a fresh clone starts unprotected:

```bash
./scripts/fork-setup.sh
```

| Command | Answers |
| --- | --- |
| `.githooks/fork-surface-check.py --drift` | Has upstream touched anything we hold a delta in? |
| `.githooks/fork-surface-check.py --audit` | What is catalogued that should not be? |
| `scripts/security-override.py --verify` | Does the tree match the security register? |
| `scripts/upstream-pin.py --show` | Which upstream are we built on? |
| `scripts/lockfile-floor.py` | Does the lockfile resolve any package below main's version? |
| `scripts/security-triage.py --audit` | What is newly vulnerable, and is it reachable? |

`--drift` is the one to run before starting work. It is the cheap moment to
shrink a delta, long before a merge turns it into a conflict.
