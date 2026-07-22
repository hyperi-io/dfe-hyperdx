# dfe-hyperdx

This repository is the DFE fork of upstream
[HyperDX](https://github.com/hyperdxio/hyperdx), embedded in the DFE platform as
its visualisation and search layer. It is the ACTIVE fork - all DFE
customisation lives here, one clean hop off upstream.

See [FORK.md](FORK.md) for the catalogue of what we changed and why, plus the
upstream-sync recovery plan. Upstream syncs merge `hyperdxio/hyperdx` into this
repo (`git rerere` replays our resolved conflicts).

## Original HyperDX Documentation

For comprehensive documentation about HyperDX, including installation,
configuration, features, and more, please refer to:

- **[Original HyperDX README](README_hyperdx.md)** - Complete HyperDX
  documentation and getting started guide

## Quick Links

- [HyperDX Official Documentation](https://www.hyperdx.io/docs)
- [Upstream HyperDX](https://github.com/hyperdxio/hyperdx)
- [FORK.md](FORK.md) - our divergence catalogue + upstream-sync recovery plan

## Maintenance Workflow (upstream sync)

This is the single active fork - there is no second repo to hop through. To pull
a newer upstream:

1. **Add the upstream remote** (one-time):
   `git remote add upstream https://github.com/hyperdxio/hyperdx.git`
2. **Merge the target upstream tag** on a `sync/<tag>` branch. `git rerere`
   replays our previously-resolved conflicts; conflicts should land only on
   pristine upstream files.
3. **Build + test** (see [DFE-DOCKER-LOCAL.md](DFE-DOCKER-LOCAL.md)), then open
   a PR and verify pinned dashboards still work.

Full recovery plan + change catalogue: [FORK.md](FORK.md).

### Running the app for development

```sh
# From root
yarn # only necessary the first time or if there have been an update to the dependencies
yarn dev:dfe
```

- Frontend will be available on http://localhost:8080/
- External API docs will be available on http://localhost:8000/api/v2/docs/ (if
  swagger is enabled in environment variables)
