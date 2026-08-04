# Development

Running the fork locally.

| Task | Doc |
| --- | --- |
| First run, DFE stack | [getting-started.md](getting-started.md) |
| Docker Compose details, FerretDB and PostgreSQL locally | [docker-local.md](docker-local.md) |

**Upstream's own developer documentation still applies and is left where
upstream put it** - [`AGENTS.md`](../../AGENTS.md) for the monorepo, package
commands and test targets, and [`agent_docs/`](../../agent_docs/) for
architecture patterns, code style and observability standards. Read those for
anything that is not DFE-specific.

## Before you change an upstream file

```bash
./scripts/fork-setup.sh                      # once per clone
.githooks/fork-surface-check.py --drift      # what has upstream moved?
```

Then work down the
[cheapest-edit ladder](../fork/design.md#the-cheapest-edit-ladder). The guard
blocks a commit that edits an uncatalogued upstream file, which is the point -
it is cheaper to be stopped now than to hand-resolve it on every sync forever.
