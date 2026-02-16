# Integrate HyperDX into dfe-ui

## Project Setup

- Fork of [HyperDX](https://github.com/hyperdxio/hyperdx) observability platform
  as backend
  - Remove build step for the frontend
- Base: [DFE-UI](https://github.com/hyperi-io/dfe-ui-monorepo) with HyperDX
  components wrapper
- Data stack: ClickHouse (telemetry), MongoDB (metadata), OpenTelemetry
  Collector

## Required changes

### Component library

HyperDX uses the mantine ui library and uses scss for styling.

Determine if there is enough component overlap between mantine and antd

- Migration to mantine on dfe-ui does not seem feasible at this time, same is
  true for the reverse (hyperdx to antd)
- Likely not worth it building everything from scratch either

#### Trade-offs:

- Have 2 component libraries in dfe-ui will increase overall runtime and bundle
  size for pages that embed HyperDX views.
  - Implement lazy loading and chunking so that these are only loaded when
    needed.
- Dev experience: Onboarding is harder: new contributors need to learn both
  Mantine and Ant Design.
  - Add eslint rules to reduce decision fatigue - only allow usage of antd in
    dfe-ui, mantine only used in hyperdx component library

### Standalone app

We will still be able to build a standalone app with this model - login flow
still handled by OAuth2

### Next App vs SPA

No changes required - HyperDX Next API paths are just proxying the HyperDX API.
We may want to create a wrapper around the HyperDX API to add RBAC functionality
or remove access to specific endpoints.

### React versions

HyperDX is running on the latest version of React - 19.2.7 DFE-UI is running on
an older version of React - 18.3.1

There may be some conflicts between components - there are some complexities
with upgrading DFE-UI to 19.2.7 as our version of antd is not entirely
compatible with latest React https://5x.ant.design/docs/react/v5-for-19
