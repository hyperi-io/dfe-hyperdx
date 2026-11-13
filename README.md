# dfe-hyperdx

The DFE fork of HyperDX, the search and visualisation layer dfe-ui embeds.

## What it does

- One clean hop off upstream [HyperDX](https://github.com/hyperdxio/hyperdx): every DFE customisation lives here, carried as merged history and replayed by `git rerere` on each upstream sync.
- The DFE 2.1 Discovery UI ported and merged, the ClickHouse JSON type supported, and the console integration: dfe-ui embeds this app chromeless, drives its theme and deep-links searches by source name.
- Alerting is off here, because the DFE rules engine owns detection. dfe-engine writes the dashboard content the provisioner reads and serves each team's ClickHouse connection.
- Security pins and patches are declared in `security/` and generated into the tree. The sync workflow strips them before merging upstream and puts them back after, so they never become merge-conflict surface.

Upstream's own docs (`AGENTS.md`, `agent_docs/`, `MCP.md`, `LOCAL.md`, `DEPLOY.md`) are left as upstream ships them. Ours are under [docs/](docs/README.md).

## Quick start

```sh
./scripts/fork-setup.sh   # once per clone: rerere, the guard, the merge driver
yarn                      # the first time, or after a dependency change
yarn dev:dfe
```

The frontend answers on <http://localhost:8080/>, and the external API docs on <http://localhost:8000/api/v2/docs/> when swagger is enabled in the environment.

## Keeping up with upstream

`.github/workflows/upstream-sync.yml` runs the sync weekly and opens a PR, so the usual answer is to review that PR rather than merge by hand. `main` is never merged into directly. The cycle in one line: strip our temporary security layer, merge upstream, put the layer back on the new upstream, then gate on build and test. Step by step, including how to add a security pin or patch: [docs/fork/sync-cycle.md](docs/fork/sync-cycle.md).

Every in-place edit to an upstream file is catalogued in `.fork-surface` before it lands, and `.githooks/fork-surface-check.py` enforces it. New code goes under `packages/{api,app}/src/dfe/`, which does not exist upstream.

## Documentation

- [docs/fork/](docs/fork/README.md): what we changed, how we keep it in sync, and [the working guide](docs/fork/working-guide.md).
- [docs/architecture/](docs/architecture/README.md): how the embedded system fits together.
- [docs/decisions/](docs/decisions/README.md): the decisions behind the shape.
- [HyperDX official documentation](https://www.hyperdx.io/docs) and [upstream HyperDX](https://github.com/hyperdxio/hyperdx).

The suite's published docs are at <https://dfe.docs.hyperi.io>.

## Help and contributing

How to work in the fork, the commands that prove a change and what tends to bite are in [docs/fork/working-guide.md](docs/fork/working-guide.md). Upstream's [CONTRIBUTING.md](CONTRIBUTING.md) is theirs. A question that is not a bug goes in a new issue.

Open bugs: [this repo](https://github.com/hyperi-io/dfe-hyperdx/issues?q=is%3Aopen+is%3Aissue+type%3ABug+-label%3Abacklog+-label%3Anext-minor) | [whole DFE suite](https://github.com/search?type=issues&q=is%3Aopen+is%3Aissue+type%3ABug+-label%3Abacklog+-label%3Anext-minor+repo%3Ahyperi-io%2Fdfe-infra+repo%3Ahyperi-io%2Fdfe-docker+repo%3Ahyperi-io%2Fdfe-deploy+repo%3Ahyperi-io%2Fdfe-engine+repo%3Ahyperi-io%2Fdfe-loader+repo%3Ahyperi-io%2Fdfe-receiver+repo%3Ahyperi-io%2Fdfe-fetcher+repo%3Ahyperi-io%2Fdfe-archiver+repo%3Ahyperi-io%2Fdfe-transform-vrl+repo%3Ahyperi-io%2Fdfe-transform-vector+repo%3Ahyperi-io%2Fdfe-transform-elastic+repo%3Ahyperi-io%2Fdfe-ui+repo%3Ahyperi-io%2Fdfe-hyperdx+repo%3Ahyperi-io%2Fscalo-rs+repo%3Ahyperi-io%2Fscalo-py+repo%3Ahyperi-io%2Flogreducer+repo%3Ahyperi-io%2Fdfe-schemas+repo%3Ahyperi-io%2Fvector-vrl+repo%3Ahyperi-io%2Fculvert+repo%3Ahyperi-io%2Fdfe-clickhouse-rs+repo%3Ahyperi-io%2Ffactbook-rs)

## License

MIT, upstream HyperDX's licence, see [LICENSE](LICENSE).
