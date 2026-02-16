# hyperi-hyperdx

This repository is a clone of our HyperDX fork at
[https://github.com/hyperi-io/hyperdx](https://github.com/hyperi-io/hyperdx).
The purpose of this repository is to pin to the version in our HyperDX fork.
When performing maintenance, you should:

1. First upgrade the fork at
   [hyperi-io/hyperdx](https://github.com/hyperi-io/hyperdx)
2. Then merge all changes with this private repository

## Original HyperDX Documentation

For comprehensive documentation about HyperDX, including installation,
configuration, features, and more, please refer to:

- **[Original HyperDX README](README_hyperdx.md)** - Complete HyperDX
  documentation and getting started guide

## Quick Links

- [HyperDX Official Documentation](https://www.hyperdx.io/docs)
- [HyperDX GitHub Repository](https://github.com/hyperi-io/hyperdx)
- [Our HyperDX Fork](https://github.com/hyperi-io/hyperdx)

## Maintenance Workflow

When updating this repository:

1. **Upgrade the fork**: Update
   [hyperi-io/hyperdx](https://github.com/hyperi-io/hyperdx) first
2. **Merge changes**: Pull and merge changes from the fork into this repository
3. **Test dashboards**: Verify that pinned dashboards work correctly with the
   updated version

### Running the app for development

```sh
# From root
yarn # only necessary the first time or if there have been an update to the dependencies
yarn dev
```

Frontend will be available on http://localhost:8080/
