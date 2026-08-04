# dfe-hyperdx

This repository is the DFE fork of upstream
[HyperDX](https://github.com/hyperdxio/hyperdx), embedded in the DFE platform as
its visualisation and search layer. It is the ACTIVE fork - all DFE
customisation lives here, one clean hop off upstream.

Our documentation lives in [docs/](docs/README.md). Upstream's own docs
(`AGENTS.md`, `agent_docs/`, `MCP.md`, `LOCAL.md`, `DEPLOY.md`) are left exactly
as upstream ships them.

## Quick Links

- [docs/](docs/README.md) - our documentation
- [docs/fork/](docs/fork/README.md) - what we changed, and how we keep it in sync
- [docs/architecture/](docs/architecture/README.md) - how the embedded system fits together
- [HyperDX Official Documentation](https://www.hyperdx.io/docs)
- [Upstream HyperDX](https://github.com/hyperdxio/hyperdx)

## Maintenance Workflow (upstream sync)

This is the single active fork - there is no second repo to hop through.

```sh
./scripts/fork-setup.sh   # once per clone: rerere, the guard, the merge driver
```

`.github/workflows/upstream-sync.yml` runs the sync weekly and opens a PR, so
the usual answer is to review that PR rather than merge by hand. `main` is never
merged into directly.

The cycle in one line: strip our temporary security layer, merge upstream, put
the layer back on the NEW upstream, then gate on build and test. Our features
are carried as merged history and replayed by `git rerere`; our security fixes
are DECLARED and generated into the tree, so they never become merge-conflict
surface for something upstream will fix in a fortnight anyway.

Step by step, including how to add a security pin or patch:
[docs/fork/sync-cycle.md](docs/fork/sync-cycle.md).

### Running the app for development

```sh
# From root
yarn # only necessary the first time or if there have been an update to the dependencies
yarn dev:dfe
```

- Frontend will be available on http://localhost:8080/
- External API docs will be available on http://localhost:8000/api/v2/docs/ (if
  swagger is enabled in environment variables)
