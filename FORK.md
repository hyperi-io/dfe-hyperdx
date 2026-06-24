# FORK.md -- HyperI fork of HyperDX

This repository (`hyperi-hyperdx`) is a fork of upstream
[HyperDX](https://github.com/hyperdxio/hyperdx) v2, embedded in the DFE platform
as its visualisation and search layer.

This file is the **single source of truth for what we changed and why**. It is
the catalogue of our divergence from upstream AND the recovery plan for
re-applying that divergence onto a newer upstream. Keep it accurate: when you
add, remove, or move a fork change, update this file in the same commit.

Design rationale for each extension lives in
[DFE-ARCHITECTURE.md](DFE-ARCHITECTURE.md). This file is the *index*; that file
is the *design*. Downstream repos (dfe-engine, dfe-infra, dfe-docs) should
**link to this file**, never duplicate it (capabilities, not API surface).

---

## Upstream base

- **Upstream:** <https://github.com/hyperdxio/hyperdx> (HyperDX v2)
- **Imported at:** commit `e58f01d` "Initial HyperDX commit" (2026-02-16)
- **No `upstream` remote is configured** as of this writing -- only `origin`
  points at `github.com/hyperi-io/hyperi-hyperdx`. To assess or pull upstream
  you must add it (see [Syncing with upstream](#syncing-with-upstream)).
- **Our changes live on `main`**, merged in as feature PRs (#2 config, #3 title
  tweaks, #4 dfe pg rbac OIDC, #10 generate-hunt-from-saved-search, #11
  source-create + json-parse, #13 hyperi rebrand). They are NOT a curated patch
  series rebased on a tracked upstream -- which is why a future upstream bump is
  a merge with real conflict surface, not a clean rebase. The
  [recovery plan](#syncing-with-upstream) exists for when that debt gets too
  high.

---

## Fork strategy: additive-only, two conventions

We keep upstream files pristine so upstream merges stay clean. Every DFE change
follows one of two conventions:

1. **New code lives under a `dfe/` directory.** Zero conflict risk -- these
   paths do not exist upstream.
   - `packages/api/src/dfe/**` -- backend extensions (auth, authz, provisioning,
     config, bootstrap, query-export)
   - `packages/app/src/dfe/**` -- frontend DFE components
   - `packages/app/src/theme/themes/dfe/**` -- DFE branding theme

2. **A modified copy of an upstream file is suffixed `.dfe[CHG]`**, kept
   **beside** the pristine original. The original is never edited; the build is
   pointed at the `.dfe[CHG]` variant. This makes our edits greppable
   (`rg -l 'dfe\[CHG\]'`) and lets `git merge` touch the originals without
   touching our copies.
   - Wiring is through the DFE build configs:
     `packages/{api,app}/tsconfig.build.json`, `nx.dfe[CHG].json`,
     `package.dfe[CHG].json`, and the `docker-compose.dfe*.yml` overrides.

> Trade-off: convention 2 is a deliberate two-file pattern. It costs a parallel
> copy per modified upstream file, but it buys conflict-free upstream merges.
> When a `.dfe[CHG]` copy drifts far from its upstream original, that is the
> signal to re-evaluate (re-fork and replay, below).

---

## Change catalogue

Counts as of upstream-base `e58f01d` -> `main`: **39** new files under `dfe/`
dirs, **32** `.dfe[CHG]` modified-copy files.

### Data layer: MongoDB -> FerretDB + PostgreSQL/DocumentDB

Replaces MongoDB with FerretDB (MongoDB wire protocol) backed by PostgreSQL +
the DocumentDB extension. HyperDX application code is **unchanged** -- Mongoose,
`connect-mongo`, and `passport-local-mongoose` all speak to FerretDB unmodified.
The same PostgreSQL also backs Casbin RBAC policies (shared with the DFE Python
UI).

- `docker-compose.dfe.yml` -- production override (replaces `db` with
  `postgres` + `ferretdb`, repoints `app` `MONGO_URI`)
- `docker-compose.dfe.dev.yml` -- dev override
- `docker-compose.dev.dfe[CHG].yml` -- modified dev compose
- Images (pin together): `ghcr.io/ferretdb/ferretdb:2.7.0` and
  `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`

### External OIDC authentication (trusted-header)

The auth boundary moves out of HyperDX. Envoy (in k8s) or oauth2-proxy (SME/
docker) handles the OIDC flow and forwards identity headers. HyperDX trusts
`x-oidc-*` / `X-Forwarded-*` headers, find-or-creates the user, and maps groups
to teams. Falls back to upstream session auth when headers are absent.

- `packages/api/src/dfe/middleware/oidc-identity.ts` -- trusted-header identity
  middleware
- `packages/api/src/dfe/controllers/user-provisioning.ts` -- JIT user creation
  from OIDC claims
- `packages/api/src/dfe/controllers/team-provisioning.ts` -- find-or-create team
  from group claims, team defaults
- `packages/api/src/api-app.dfe[CHG].ts` -- wires the middleware behind
  `AUTH_MODE`
- `packages/api/src/routers/api/root.dfe[CHG].ts` -- gates legacy
  login/register/invite routes in OIDC mode
- Spikes: `.hyperi/spikes/oauth2-derek/**` (Envoy/oauth2-proxy/nginx reference
  configs -- not shipped, kept for reference)

### Authorization: Casbin RBAC (shared enforcer)

Adds multi-tenant RBAC HyperDX never had. The DFE Python UI is the policy
authority (pycasbin); HyperDX is a policy consumer (node-casbin). Both read the
same `casbin_rule` table in the shared PostgreSQL.

- `packages/api/src/dfe/middleware/casbin-authz.ts` -- per-route enforcement
  middleware
- Model: RBAC-with-tenants (`sub, dom, obj, act`); roles viewer/editor/admin

### DFE integration features

- `packages/api/src/dfe/routers/query-export.ts` -- export a HyperDX saved
  search / SQL to a DFE rule (the "generate hunt from saved search" path, PR #10)
- Source-create + JSON-parse improvements (PR #11) -- see
  `packages/common-utils/**` delta
- Alerting: HyperDX's built-in alert checker is **not started**; alert routes
  are gated via Casbin. Detection/alerting is owned by the DFE rules engine.
  (Disabled, not removed -- additive.)

### Config + bootstrap

- `packages/api/src/dfe/config.ts` -- DFE config surface (auth mode, header
  names, Casbin PG URL, default team)
- `packages/api/src/dfe/bootstrap.ts` -- DFE startup wiring
- `.env.dfe-example` -- DFE env template

### Branding / frontend

- `packages/app/src/theme/themes/dfe/**` -- DFE theme (tokens, Mantine theme,
  logomark/wordmark/SVG assets)
- `packages/app/src/dfe/components/**` -- SidebarMenu, ThemeToggle,
  UserActionsButton (+ `useLogout`)
- `.dfe[CHG]` copies: `layout`, `theme/index`, `theme/types`,
  `theme/themes/_base-tokens`, `utils`, `hooks/useRowWhere`, `globals.css`,
  and their tests

### Build / CI / tooling

- `.hyperi-ci.yaml`, `.github/workflows/ci.yml` -- migrated to hyperi-ci
- `.releaserc.json` -- semantic-release
- `.gitleaks.toml` -- secret-scan false-positive rules
- `scripts/audit.sh` -- `yarn npm audit` wrapper (Yarn 4 removed built-in audit)
- `.dfe[CHG]` copies: `nx`, root + per-package `package.json`,
  `.prettierrc`, `.prettierignore`, `.gitignore`, `tsconfig.build.json`

### Docs

- [DFE-ARCHITECTURE.md](DFE-ARCHITECTURE.md) -- full embedded-HyperDX design
- [DFE-DEV.md](DFE-DEV.md) -- dev quickstart for the fork
- `STATE.md`, `TODO.md`, `CHANGELOG.md`, `VERSION`

---

## Version + image

- Fork version: `1.0.0` (`package.json` + tag `v1.0.0`). This is the **HyperI**
  version, independent of the upstream HyperDX app version we forked from.
- When pinning the fork in dfe-infra `versions.yaml`, use the image tag this
  repo's CI publishes -- NOT the upstream HyperDX app version. (The
  `hyperdx: 2.16.0` pin in dfe-infra likely refers to the upstream app version
  and should be reconciled to our published tag.)

---

## Syncing with upstream (the recovery plan)

Because our changes are merged into `main` (not a curated overlay), there are two
viable paths. Prefer (A) while merge debt is low; switch to (B) when `.dfe[CHG]`
copies have drifted too far from their upstream originals to merge cleanly.

### A. Merge upstream into the fork

```bash
git remote add upstream https://github.com/hyperdxio/hyperdx.git   # one-time
git fetch upstream
git checkout -b chore/upstream-sync main
git merge upstream/main      # or a specific upstream tag
# Conflicts should land ONLY on pristine upstream files, never on dfe/ or
# .dfe[CHG] files. If a .dfe[CHG] copy needs updating, re-derive it from its
# now-updated pristine original by hand.
```

### B. Re-fork and replay (clean reset)

When (A) gets ugly:

1. Fork the target upstream tag fresh.
2. Re-apply each extension in this catalogue, in order: data layer -> OIDC ->
   Casbin -> provisioning -> integration features -> config/bootstrap ->
   branding -> CI -> docs.
3. Re-derive each `.dfe[CHG]` copy from the *new* upstream original (do not
   blindly copy the old `.dfe[CHG]` -- diff it against its old original first to
   extract just the DFE delta).
4. Update this file's upstream-base commit + counts.

This catalogue is what makes (B) tractable. Keep it current.

---

## Cross-references

- DFE platform: dfe-engine (control plane), dfe-infra (deploy), dfe-docs
- The OIDC trusted-header contract (`x-oidc-*`) is the universal seam shared with
  the rest of DFE -- see dfe-engine OIDC dual-mode design.
- FerretDB 2.x requires the Microsoft DocumentDB PG extension and **cannot be
  upgraded in place from 1.x** (clean install + dump/restore).
