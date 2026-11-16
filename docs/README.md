# dfe-hyperdx documentation

DFE's fork of [HyperDX](https://github.com/hyperdxio/hyperdx), embedded in the
DFE platform as its visualisation and search layer.

Four questions bring people here, and they are answered in different places:

| Question | Start at |
| --- | --- |
| **What does our fork do differently?** | [architecture/](architecture/README.md) |
| **How do we maintain the fork?** | [fork/](fork/README.md) |
| How do I run it locally? | [development/](development/README.md) |
| Why was it built this way? | [decisions/](decisions/README.md) |

Which files are ours and which are upstream's matters more here than in a normal repo, because the answer decides whether
a change is free or expensive. Our files sit beside upstream's, and HyperI
standards apply to ours alone.

```mermaid
flowchart LR
    accTitle: L4 Detail -- Ours and upstream's files
    accDescr: Ours are our pages under docs, every dfe directory under packages, the security and githooks directories, our scripts and the workflows we added. Upstream's are agent_docs, the root agent and contributor docs, and everything under packages outside a dfe directory. Ownership is per file, and .fork-surface lists the upstream files we edit.

    subgraph ours["Ours, HyperI standards apply"]
        direction TB
        d["Our pages<br/>under docs/"]
        dfe["packages/**/dfe/**"]
        tools["security/, .githooks/,<br/>our scripts/"]
        wf["Our workflows"]
    end

    subgraph theirs["Upstream's"]
        direction TB
        ad["agent_docs/"]
        rootmd["AGENTS.md, MCP.md, LOCAL.md,<br/>DEPLOY.md, CONTRIBUTING.md"]
        code["packages/ outside dfe/"]
    end

    ours ~~~ theirs

    classDef default fill:#F8FAFC,stroke:#64748B,stroke-width:1px,color:#0F172A
    classDef ext fill:#EEF0F2,stroke:#6B7280,stroke-width:1px,stroke-dasharray:4 3,color:#1F2937
    classDef group fill:none,stroke:#64748B,stroke-width:1px,stroke-dasharray:2 4
    class ad,rootmd,code ext
    class ours,theirs group
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
