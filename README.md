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

## Context

### What this is

A long-lived FORK of [hyperdxio/hyperdx](https://github.com/hyperdxio/hyperdx), embedded in the DFE platform as its search and visualisation layer. It is NOT a standalone HyperDX deployment, and NOT where detection happens -- alerting is disabled here because the DFE rules engine owns it. The boundary that catches people: this repo merges upstream forever, so every edit to a pristine upstream file is permanent merge-conflict surface and has to be catalogued in `.fork-surface` before it lands.

### Where things live

| Path | Holds |
| --- | --- |
| `packages/{api,app}/src/dfe/**`, `packages/app/src/theme/themes/dfe/**` | Our code. Zero conflict risk -- these paths do not exist upstream |
| everything else under `packages/` | Upstream's. Leave it alone unless the change cannot go under `dfe/` |
| `.fork-surface` | Every sanctioned in-place edit to an upstream file |
| `.upstream-version` | Which upstream release we are built on, verified against `git merge-base` |
| `docs/` | Ours: [fork](docs/fork/README.md), [architecture](docs/architecture/README.md), [decisions](docs/decisions/README.md) |
| `scripts/`, `security/`, `.githooks/` | The sync machinery, the guard, and the generated security layer |

### Commands that prove a change

```sh
./scripts/fork-setup.sh                              # once per clone: rerere, the hook, the merge driver
.githooks/fork-surface-check.py --base origin/main   # the guard, as CI runs it
.githooks/fork-surface-check.py --drift              # has upstream moved under one of our deltas?
yarn lint                                            # eslint, our files only
yarn typecheck
yarn test
```

`yarn lint` and `yarn format:check` compute their scope from the merge-base with upstream (`scripts/dfe-lint-ours.mjs`), so they need the `upstream` remote and they never report on an untouched upstream file. `yarn lint:all`, `yarn lint:fix` and `yarn format` do NOT respect that boundary: each rewrites upstream files, which breaks every recorded rerere resolution in them.

### What tends to bite

| Don't | Do | Why |
| --- | --- | --- |
| Rewrite an upstream function body | Put the logic under `dfe/`, keep upstream's signature, swap the identifier at the call site | A one-token call-site change leaves a one-line conflict; a rewritten body is a hand-resolve every sync, forever |
| Put our assertions in an upstream test file | Put them in a `dfe/__tests__/` directory | Upstream churns test files harder than almost anything, and has no stake in our tests |
| Commit a security fix in place | Declare it in `security/overrides.yaml` or `security/patches/` | Upstream ships their own within weeks, so a committed fix is permanent surface for something we expect to delete |
| Run a repo-wide formatter or `lint --fix` to clear a gate | Exclude the path from the tool (`.prettierignore`, eslint ignores) | It rewrites lines we do not own, so the conflict preimage stops matching and rerere replays nothing |
| Merge upstream onto `main` by hand | Review the PR `.github/workflows/upstream-sync.yml` opens | The workflow strips the security layer, lets rerere replay, then gates on build and test |

### Where this sits

| Repo | Direction and mechanism |
| --- | --- |
| `hyperdxio/hyperdx` | We merge it, forever. `.upstream-version` records which release, checked against `git merge-base` on every PR |
| `dfe-infra` | Pins the image this repo builds, by tag and digest (`versions.yaml`, `helm/charts/hyperdx/values.yaml`). A release here is a pin bump there |
| `dfe-engine` | Writes the dashboard content this repo's provisioner reads on a cron, serves each team's ClickHouse connection, and is the service principal the admin lockdown trusts |
| `dfe-ui` | Embeds this app chromeless (`embed=1`), drives its theme, and deep-links searches by source name |
