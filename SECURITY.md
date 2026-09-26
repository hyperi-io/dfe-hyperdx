# Security

## Before you report a dependency alert

This is a long-lived fork of
[hyperdxio/hyperdx](https://github.com/hyperdxio/hyperdx). We inherit upstream's
whole dependency tree, so a scanner pointed at this repo returns a large number
of findings. Most of them are not real here, and we have already been through
them one at a time.

**Read [docs/fork/security-sync.md](docs/fork/security-sync.md) first.** It
records every advisory we have triaged, the version we actually resolve, and why
the vulnerable code is or is not reachable in what we ship. It is dated and
appended to on every upstream sync.

At the last pass: 99 open alerts, **1** of them real.

If the doc already covers the advisory you found, there is nothing to file.

## Why a scanner over-reports here

The shipped image is not the repo. The root `Dockerfile` builds the runtime
with:

```
yarn workspaces focus @hyperdx/api --production
```

so it carries the api's production closure - 331 packages of the 2691 that
install - and nothing else. Every devDependency, the cli and hdx-eval
workspaces, and the app's server-side dependencies are deleted before the final
stage. A finding against `yarn.lock` says nothing about what runs.

The same applies to GitHub's `scope` field on a Dependabot alert: it is derived
from the lockfile, not from the image, and it will report install-time build
tooling as `runtime`.

## What we do fix

An advisory gets a pin when it is HIGH or CRITICAL **and** we can write down how
an attacker reaches it in how this fork actually runs. The bar and the register
are in [security/overrides.yaml](security/overrides.yaml).

Upstream-tree fixes are pooled as a declaration there rather than committed into
upstream's files, so they are stripped before a merge and rebuilt after and
never reach rerere. Anything in our own `packages/*/dfe/**` is fixed directly
and permanently.

## Reporting something we have missed

Open a private security advisory on this repository, or contact the maintainers.
Include the advisory id, the resolved version you observed, and the call path
you believe is reachable - that last part is what we will check first.

Findings against upstream's own code are best reported to
[hyperdxio/hyperdx](https://github.com/hyperdxio/hyperdx) directly. We pick them
up on the next sync.
