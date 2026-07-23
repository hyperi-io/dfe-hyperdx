# FORK.md -- HyperI fork of HyperDX

This repository (`dfe-hyperdx`) is a fork of upstream
[HyperDX](https://github.com/hyperdxio/hyperdx) v2, embedded in the DFE platform
as its visualisation and search layer.

This file is the **single source of truth for what we changed and why**. It is
the catalogue of our divergence from upstream AND the recovery plan for
re-applying that divergence onto a newer upstream. Keep it accurate: when you
add, remove, or move a fork change, update this file in the same commit.

Design rationale for each extension lives in
[DFE-ARCHITECTURE.md](DFE-ARCHITECTURE.md). This file is the _index_; that file
is the _design_. Downstream repos (dfe-engine, dfe-infra, dfe-docs) should
**link to this file**, never duplicate it (capabilities, not API surface).

---

## Upstream base

- **Upstream:** <https://github.com/hyperdxio/hyperdx> (HyperDX v2)
- **Synced to:** `@hyperdx/app@2.29.0` (merge `f95c8773`, 2026-07-07). Recorded
  as a real 2-parent merge (base `e58f01d`), so future syncs are clean 3-way
  merges off 2.29. `git rerere` is enabled for the fork (future conflict
  resolutions auto-replay). Sync process: `git merge <new-upstream-tag>` on a
  `sync/<tag>` branch, then build + test (see DFE-DOCKER-LOCAL.md).
- **RETIRED - the `.dfe[CHG]` shadow-copy convention.** It was never wired (no
  swap alias/script/config; pages import the pristine originals; docker build
  ignores the `package.dfe[CHG].json`/`nx.dfe[CHG].json` variants), had drifted
  hard against 2.29, and blocked the build. All 32 shadow files were removed in
  `bfb9899a`. The fork's real customisations live entirely in the imported
  `dfe/` dirs. When customising an upstream file now, prefer an upstream config
  seam (e.g. the `brandName`/theme hooks) over shadowing.
- **Imported at:** commit `e58f01d` "Initial HyperDX commit" (2026-02-16)
- **No `upstream` remote is configured** as of this writing -- only `origin`
  points at `github.com/hyperi-io/dfe-hyperdx`. To assess or pull upstream you
  must add it (see [Syncing with upstream](#syncing-with-upstream)).
- **Our changes live on `main`**, merged in as feature PRs (#2 config, #3 title
  tweaks, #4 dfe pg rbac OIDC, #10 generate-hunt-from-saved-search, #11
  source-create + json-parse, #13 hyperi rebrand). They are NOT a curated patch
  series rebased on a tracked upstream -- which is why a future upstream bump is
  a merge with real conflict surface, not a clean rebase. The
  [recovery plan](#syncing-with-upstream) exists for when that debt gets too
  high.

---

## Fork strategy: additive-first, minimise upstream churn

**MINIMISE what we change in ANYTHING from upstream.** HyperDX moves fast enough
on its own - we do not want to manage small fry on top of it. Fewer touched
upstream files means cheaper syncs, full stop.

### The cheapest-edit ladder

Before changing an upstream file, work down this list and stop at the first that
fits. This is the single highest-leverage habit in the repo, and it is the one
every LLM gets wrong by default - the instinct is to open the upstream file and
rewrite the function body, which works, passes tests, and costs a hand-resolve
on every sync forever.

1. **Can it live under `dfe/` entirely?** Costs nothing. Do that.
2. **Can the upstream file change by ONE TOKEN?** Put the logic in `dfe/`, give
   your function the SAME SIGNATURE as upstream's, and swap the identifier at
   the call site. The argument list stays byte-identical, so an upstream change
   to those arguments is a trivial conflict rather than a structural one.
3. **Can it be an ADDITION next to a brace?** An `else if` appended to an
   existing block merges cleanly far more often than a modified line.
4. **Only then** edit in place, and catalogue it in `.fork-surface` + here.

WORKED EXAMPLE (2026-07-23, native ClickHouse JSON columns). First attempt
rewrote `buildJSONExtractQuery`'s body in `DBRowJsonViewer.tsx` and edited
upstream's test expectations: 53 insertions across the two files upstream churns
hardest in that area. I had to redo this post LLM as rule 2 (four call sites
differing by one identifier) plus rule 3 (three `else if (isJsonColumn)`
additions reusing upstream's own predicate): **15 insertions**,
`buildJSONExtractQuery` byte pristine, and `DBRowJsonViewer.test.tsx` back to
pristine and off the catalogue. Same feature, a quarter of the standing cost.

### Security + dependency posture is INVERTED here

The house standard is scanners-on, dependencies-current. In this repo that is
backwards, and deliberately so: **off by default, on only for what WE added.**

- `renovate.json` disables every manager and re-enables exactly one thing - the
  SHA-pinned actions in the four workflows we own. Upstream's workflows are
  excluded BY NAME so a sync that adds one does not silently opt it in.
- CodeQL / GitHub code security are OFF (`code_security: disabled`), as is
  `dependabot_security_updates` (the automatic fix PRs).
- Dependabot vulnerability ALERTS are a separate switch and are still **ON** as
  of 2026-07-23 - they are what produces the "GitHub found 118 vulnerabilities"
  banner on every push. Turning them off is a repo-admin action, deliberately
  human-only:

  ```
  gh api -X DELETE repos/hyperi-io/dfe-hyperdx/vulnerability-alerts
  ```

  (`-X PUT` re-enables. Verify with `gh api .../vulnerability-alerts -i` - 204
  means on, 404 means off.)

- semgrep stays non-blocking in `.hyperi-ci.yaml` (`quality.semgrep` defaults to
  `warn`); its findings are inherited upstream code.
- gitleaks stays ON and blocking. That one scans OUR commits for OUR secrets and
  has nothing to do with upstream's dependency tree.

WHY. We do not own upstream's dependency tree. Patching a vendored dep diverges
us from hyperdxio/hyperdx for a fix we did not write, converts a pristine file
into permanent rerere conflict surface, and gets re-conflicted on the next sync
regardless. Upstream patches upstream; we get it when we sync. And an alert
queue full of items we must close unmerged trains everyone to ignore the queue -
including the one that matters.

WHAT THIS DOES NOT MEAN. Muting the per-PR noise does not make an inherited CVE
unreal: the fork ships as a container image and those CVEs ship with it. The
image scan at publish is the control that still applies, and a critical finding
there is an argument for **syncing upstream now** - not for hand-patching a
dependency we do not own.

#### The exception: a reachable HIGH/CRITICAL

We DO patch, but only when BOTH hold:

1. severity is **high or critical**, AND
2. there is a **real vector** - the vulnerable path is actually reachable in how
   DFE runs this fork.

Point 2 is the one that gets skipped, and it is the one that matters. Most
advisories against a transitive dep are unreachable here: the package is present
but the vulnerable function is never imported, or it is only reachable from a
path we do not ship. **"npm audit says high" is not a vector.** If you cannot
write down how an attacker gets there, there is nothing to patch.

The register is `security/overrides.yaml`. Every entry needs the advisory, the
severity, the prose vector, and an upstream link - ours is always a stopgap,
theirs is the fix. The matching pin goes in the root `package.json`
`resolutions` block (catalogued surface, so document it here too).

#### Code scanning: keep it all, sort it by who wrote the line

The muting above is the DEPENDENCY axis, where authorship is not a useful
question - the whole tree is upstream's regardless of who pulled a package in.
Code findings are different: they carry a file and a line, so they can be
attributed, and `fork-security.yml` scans the whole tree and sorts the results:

- **OURS** - a line we added or changed vs the merge base. **Gates the build.**
- **ACCEPTED** - ours, reviewed, listed in `security/accepted.yaml` with a
  reason. Suppressed from the gate but PRINTED every run, because a suppression
  that has become wrong should be visible.
- **INHERITED** - upstream's lines. Reported to the job summary, never gates.

Measured on the first real run: 114 findings, 11 ours. Gating on 114 is
unworkable; muting 114 loses the 11. Sorting is the only answer that keeps both.

ATTRIBUTION - `scripts/attribute-findings.py`, SARIF in, so it serves semgrep
and CodeQL alike. It uses **line content vs the merge base**: a line we added or
changed is ours. That needs no catalogue and works even on an upstream file
nobody remembered to list.

The two other obvious methods were broken by the squashed import, and are now
FIXED by the graft below rather than merely avoided:

- **author/blame** used to attribute every upstream line to whoever ran the
  import. It now resolves to the real upstream author.
- **commit ancestry** used to misfile any line untouched since the import,
  because the commit it blamed to was not in upstream's history. Observed on
  `theme/ThemeProvider.tsx:163`, which read as ours and is Elizabet Oliveira's.

### The squashed import, and the graft that repairs it

`e58f01d3 "Initial HyperDX commit"` is a FLATTENED copy of upstream, not a
continuation of their history, so git had no path from our tree back to theirs.
That is what broke blame and ancestry, and it also means `git log` on any
upstream file showed our import rather than the change that actually caused a
behaviour.

The import was taken from upstream `fbeaf152` - their HEAD at the import
timestamp, and only NINE files differ from our import commit (the `.env`
removals and the HyperI additions made at the time). `scripts/fork-setup.sh`
reconnects them:

```
git replace --graft e58f01d3f4ede7b691ee4cf2873ad8548d93f210 fbeaf152...
```

NON-DESTRUCTIVE. No object is rewritten and no SHA changes; `git replace -d`
undoes it. Verified after grafting: the merge base is unchanged (`e2103f78`), so
the sync workflow, the drift report and the attribution script all behave
identically - blame and `git log` simply stop lying.

It is per-clone config like rerere, applied by `fork-setup.sh` from the two SHAs
recorded there, rather than pushed as a `refs/replace/*` ref that no clone
fetches by default.

THE THING THAT BREAKS IT: reformatting an upstream file rewrites every line into
the diff, so the whole file reads as ours and the signal is gone. That is a
SECOND, independent reason for the no-bulk-reformat rule above - the cost is no
longer just merge pain.

It earned its keep immediately: the first run flagged two shell-injection sites
and three mutable action pins in the workflows sitting beside it, plus a
`message` listener with no origin check in `EmbedThemeSync`. All fixed rather
than accepted.

#### Unwinding is the hard part, so it is automated

A pin is easy to add and easy to forget. Upstream ships the fix a few weeks
later, our override quietly becomes a no-op, and the fork carries a divergence
in the file upstream churns most that nobody remembers deciding on.

So the nag is inverted. `scripts/security-override.py --check` compares every
entry against what `yarn.lock` ACTUALLY resolves to and FAILS when a pin has
become redundant - reporting `holding`, `REDUNDANT`, or `gone` per entry, with
the unwind steps. It also refuses an entry below the severity bar or missing its
vector, so the bar is enforced mechanically rather than by good intentions.

`upstream-drift.yml` runs it daily. That is the only dependency nag this repo
keeps, and it is about OUR pins, not upstream's tree.

### Never put our assertions in an upstream test file

Upstream test files gain cases constantly and upstream has no stake in ours, so
a delta there is the most expensive kind for the least return. Ours go in a
`dfe/__tests__/` directory. `.githooks/fork-surface-check.py --audit` lists the
catalogued test files still to migrate (6 inherited, as of 2026-07-23).

> NOTE: convention 2 below (`.dfe[CHG]` shadow copies) is **RETIRED** - see
> "Upstream base". We modify upstream files IN PLACE now, so each one is
> permanent conflict surface and must be a documented exception: listed in
> `.fork-surface`, described here, and enforced by
> `.githooks/fork-surface-check.py`. Convention 1 remains the default. The text
> is kept for historical context on the 32 removed shadow files.

Every DFE change follows one of two conventions:

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

### Authorization

Casbin RBAC (a shared `casbin_rule` PostgreSQL enforcer) was REMOVED in the
dfe-hyperdx v1 line. It was redundant: every HyperDX route handler already
self-scopes its Mongo queries by `team`, so tenant isolation holds without it
and cross-team access was never possible. Authorization is owned by the DFE
engine (the policy decision point) and enforced at the data layer by ClickHouse
GRANTs; HyperDX trusts the identity injected at the edge. Removed:
`dfe/middleware/casbin-authz.ts`, `dfe/bootstrap.ts`,
`rbac_with_tenants_model.conf`, and the `casbin` / `casbin-pg-adapter` deps.

### DFE integration features

- `packages/api/src/dfe/routers/query-export.ts` -- export a HyperDX saved
  search / SQL to a DFE rule (the "generate hunt from saved search" path, PR
  #10)
- `packages/app/src/dfe/components/CreateRuleFromSearch/` -- the button that
  posts to the above and hands the result to the DFE UI's rule builder.
  Deliberately uses plain `useState`, NOT react-query's `useMutation`: this
  component is injected into upstream's `DBSearchPage`, and upstream tests
  render that page behind a PARTIAL `@tanstack/react-query` mock, so pulling a
  second hook out of that module makes their pristine tests explode. Keep our
  delta invisible to them.
- Source-create + JSON-parse improvements (PR #11) -- see
  `packages/common-utils/**` delta
- `packages/app/src/components/DBRowJsonViewer.tsx` -- native ClickHouse JSON
  columns. `col['k']` on a JSON column is `arrayElement` and ClickHouse rejects
  it, so we emit `JSONExtractString` instead, and a JSON sub-path yields
  `Dynamic` which `JSONExtract*` also rejects, so that ONE case is wrapped in
  `toString()`. Narrow by design: wrapping unconditionally changed the emitted
  SQL for String and Map columns too and broke eight pristine upstream test
  expectations for no functional gain. Exactly one upstream expectation now
  carries our delta.
- Alerting: HyperDX's built-in alert checker is **not started**; alert routes
  are hidden by the DFE embed nav gating. Detection/alerting is owned by the DFE
  rules engine. (Disabled, not removed -- additive.)

### Config + bootstrap

- `packages/api/src/dfe/config.ts` -- DFE config surface (auth mode, header
  names, default team)
- `.env.dfe-example` -- DFE env template

### Branding / frontend

- `packages/app/src/theme/themes/dfe/**` -- DFE theme (tokens, Mantine theme,
  logomark/wordmark/SVG assets)
- `packages/app/src/dfe/components/**` -- SidebarMenu, ThemeToggle,
  UserActionsButton (+ `useLogout`)
- `.dfe[CHG]` copies: `layout`, `theme/index`, `theme/types`,
  `theme/themes/_base-tokens`, `utils`, `hooks/useRowWhere`, `globals.css`, and
  their tests

### Build / CI / tooling

- `.hyperi-ci.yaml`, `.github/workflows/ci.yml` -- migrated to hyperi-ci
- `.releaserc.json` -- semantic-release
- `.gitleaks.toml` -- secret-scan false-positive rules
- `scripts/audit.sh` -- `yarn npm audit` wrapper (Yarn 4 removed built-in audit)
- `packages/api/jest.dfe.config.js` -- fork-local UNIT config for the api
  package (upstream has no `ci:unit` there; every api test is `ci:int` and wants
  Mongo + ClickHouse). Scoped to `src/dfe/**` and transforms `jose`, which is
  ESM-only. A separate file rather than an edit to upstream's `jest.config.js`.
  The matching `"ci:unit"` script IS an in-place edit to
  `packages/api/package.json`, which is already catalogued surface.
- `.dfe[CHG]` copies: `nx`, root + per-package `package.json`, `.prettierrc`,
  `.prettierignore`, `.gitignore`, `tsconfig.build.json`

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

Because our changes are merged into `main` (not a curated overlay), there are
two viable paths. Prefer (A) while merge debt is low; switch to (B) when
`.dfe[CHG]` copies have drifted too far from their upstream originals to merge
cleanly.

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
3. Re-derive each `.dfe[CHG]` copy from the _new_ upstream original (do not
   blindly copy the old `.dfe[CHG]` -- diff it against its old original first to
   extract just the DFE delta).
4. Update this file's upstream-base commit + counts.

This catalogue is what makes (B) tractable. Keep it current.

### C. Automated drift sync: rerere + the test gate

The point of keeping our changes greppable and catalogued is to make the
recurring upstream merge cheap and reliable. Two mechanisms do that, and the
second is the load-bearing one.

1. **`git rerere` (reuse recorded resolution).** Enabled in this repo
   (`rerere.enabled` + `rerere.autoupdate`). Resolve a merge conflict on an
   upstream file ONCE and git records the preimage -> postimage. When the SAME
   conflict recurs on a later upstream bump, git replays our resolution
   automatically. Our conflict surface is exactly the pristine upstream files we
   now modify **in place** (the `.dfe[CHG]` shadow convention was retired) --
   the recent embed work touched: `packages/app/next.config.mjs` (CSP
   frame-ancestors), `packages/app/pages/_app.tsx` (route-guard + colour-scheme
   feed), `packages/app/src/layout.tsx` (hide AppNav in embed),
   `packages/app/src/components/AppNav/AppNav.tsx`,
   `packages/app/src/components/DBRowTable.tsx`,
   `packages/app/src/DBChartPage.tsx` (gate the chart AI assistant),
   `packages/app/styles/globals.css` + `styles/LogTable.module.scss` (Inter /
   IBM Plex Mono + slashed-zero), `packages/app/.env.development`. The additive
   `packages/app/src/dfe/**` files (embedFeatures, EmbedThemeSync) never
   conflict.

   LIMIT (state it plainly): rerere replays a resolution only when the conflict
   preimage matches. If upstream refactors the surrounding code the hunk
   changes, the preimage no longer matches, and you get a FRESH conflict to
   resolve by hand (which rerere then records for next time). rerere removes the
   toil of identical recurring conflicts; it does NOT understand our intent and
   does NOT prove the replayed result still behaves correctly.

   AGENT ENTRYPOINT DELTA: `CLAUDE.md` is an upstream file (theirs is the single
   line `@AGENTS.md`). We prepend the governing rerere rule above it and keep
   their line at the bottom, so the rule is unmissable at the top of every agent
   session. Upstream rarely touches that one line, so the conflict is small and
   rerere-replayable. AGENTS.md itself is left pristine.

   MACHINE CATALOGUE + GUARD: the surface is no longer prose-only.
   `.fork-surface` lists every sanctioned in-place upstream edit, and
   `.githooks/fork-surface-check.py` fails a commit that touches an upstream
   file absent from it (`git config core.hooksPath .githooks` to enable; it also
   takes `--base <ref>` for CI). Landing a new exception means adding the path
   there AND describing the delta here, in the same commit.
   `FORK_SURFACE_WARN=1` downgrades the block to a warning for that one commit.

   FORMATTING IS NEVER A REASON TO TOUCH UPSTREAM. Greening a gate by running a
   formatter over upstream files is pure added conflict surface and the worst
   shape for rerere. Exclude the paths from the tool instead. Learned the hard
   way: the 2026-07-22 gate work ran a repo-wide `yarn format` over ~45 upstream
   files we hold no functional delta in, then reverted 35 of them to pristine
   and listed those paths in `.prettierignore` - which greens the gate without
   us owning their formatting.

   The one unavoidable exception: `packages/{api,app}` run prettier THROUGH
   eslint (`eslint-plugin-prettier`), and nx runs eslint per package, so the
   repo-root `.prettierignore` is not consulted there. Files in those packages
   that we ALREADY modify stay formatted, which costs no new surface. That is
   not licence to format upstream files we do not otherwise touch.

2. **The test gate (the real guarantee).** Because rerere is textual, a merge
   can apply cleanly yet silently break a DFE delta (e.g. upstream renames a
   prop our sidebar-hide relied on). The merge result is trusted only once our
   tests pass. `.github/workflows/upstream-sync.yml` runs the merge on a bot
   branch weekly (and on demand), lets rerere replay, then runs build + test and
   opens a PR -- as a **draft flagged "upstream broke our deltas"** when tests
   fail. Remaining unresolved conflicts file a drift issue instead. `main` is
   never touched directly.

   Coverage today. The fork-local suites are the executable form of "what must
   keep working", and they run in this repo's own CI on every PR:

   - `packages/app/src/dfe/__tests__/embedFeatures.test.ts` -- the feature
     allowlist and, more importantly, that a disabled feature is route-BLOCKED
     rather than merely hidden, matching on a path segment so `/teams` is not
     collateral damage. Plus embed-chrome detection and its sessionStorage
     persistence.
   - `packages/app/src/dfe/__tests__/EmbedThemeSync.test.tsx` -- the colour
     scheme arrives from `?theme` then live `DFE_SET_THEME` messages, malformed
     values are ignored, and the listener detaches.
   - `packages/app/src/dfe/__tests__/dfeTheme.test.ts` -- brand identity: the
     primary is the brand blue (not the inherited olive), the scale is anchored
     on `_tokens.scss`, the token blocks are scoped to `.theme-dfe`, and Inter /
     IBM Plex Mono stay resolvable.
   - `packages/app/src/dfe/__tests__/forkDeltas.test.ts` -- source-text guards
     for the deltas that live INSIDE upstream files and are too heavy to import
     (`next.config.mjs` CSP, `_app.tsx` route guard + font pin, `layout.tsx`,
     `AppNav.tsx`). Blunt, but it fails the moment the wiring disappears.
   - `packages/api/src/dfe/__tests__/jwt-verify.test.ts` -- REAL ES384 signing
     and verification (only the JWKS fetch is stubbed): accepted tokens, the
     cookie fallback, group->team resolution, the ES384 + issuer pin, and that
     every rejection path falls THROUGH rather than 401ing.

   Upstream's api package has no unit target at all (every api test is `ci:int`
   and wants Mongo + ClickHouse), so ours runs under `packages/api/ci:unit` via
   a separate `jest.dfe.config.js` scoped to `src/dfe/**`. That config also
   transforms `jose`, which ships ESM-only.

   Still downstream-only: the browser-level embed proof (chromeless iframe,
   dfe-ui owning the nav, live theme sync) in
   `dfe-infra/scripts/verify_embed.py`, now invoked by
   `dfe-infra/bootstrap/smoke-test-hyperdx.sh` alongside the
   auth/data/embed-header seam checks.

3. **Early warning, between syncs.** `upstream-sync.yml` answers "does the merge
   still apply?", which is late - by then someone is resolving conflicts under
   pressure against 30+ commits of unfamiliar change. `upstream-drift.yml` runs
   daily and answers the cheaper question: has upstream touched anything we hold
   a delta in? Run it yourself any time with

   ```
   git fetch upstream && .githooks/fork-surface-check.py --drift
   ```

   It names the at-risk files AND the upstream commits that touched them. The
   right response is nearly always to shrink that delta down the ladder above,
   BEFORE the merge turns it into a conflict.

4. **Per-clone setup is not inherited.** `rerere.enabled` and `core.hooksPath`
   are local git config, so a fresh clone, a CI container and an agent sandbox
   all start with rerere off and the guard disconnected - and rerere being off
   is SILENT, it just records nothing. `./scripts/fork-setup.sh` sets both plus
   the upstream remote, and the guard self-heals rerere whenever it finds it
   off. `fork-surface.yml` enforces the guard in CI so the local hook is a
   convenience rather than the control.

### Measured, 2026-07-23

FIRST, A TRAP WORTH KNOWING. The first pass at this measurement used a local
`upstream/main` that had not been fetched in weeks, and reported 34 commits of
drift and 2 conflicts. A fresh `git fetch upstream` showed the truth: **122
commits and 11 conflicts**. A stale ref does not announce itself - it just
quietly tells you the sync is smaller than it is. `upstream-drift.yml` fetches
every run, which is precisely why the daily CI number is the one to trust over
whatever your laptop says.

Real state at 2026-07-23: upstream is **122 commits** ahead of merge base
`e2103f78`, touching **24** of our 64 catalogued files.

A dry-run merge of the real `upstream/main` conflicts on 11 files:

```
.github/workflows/{deep-review,e2e-tests,knip,main,release}.yml
README.md  nx.json  package.json
packages/api/package.json  packages/api/tsconfig.build.json
packages/app/src/components/OnboardingModal.tsx
```

Five of those are workflows we replaced wholesale when migrating to hyperi-ci,
so they are cheap. The rest are config.

What the restructure bought, stated honestly:

- `DBRowJsonViewer.tsx` and `.test.tsx` are **not in that conflict set**, across
  122 commits of upstream change.
- On the narrower stale-ref merge, `DBRowJsonViewer.test.tsx` auto-merged even
  BEFORE the restructure - git resolved it without a human. So the restructure
  removed the RISK; it did not avoid a conflict that was otherwise certain. The
  value is that a file identical to the merge base can never conflict, however
  upstream rewrites it later.
- The delta gate is the real result: **all 81 `src/dfe` tests pass against the
  fully merged 122-commit tree**. That is the thing rerere cannot tell you, and
  the reason the tests exist.

**Priming rerere:** rerere has nothing to replay until a resolution is recorded.
Prime it by doing the first post-2.29 upstream merge by hand on a `sync/<tag>`
branch, resolving each conflict on the modified upstream files above, and
committing -- that writes the resolutions into `.git/rr-cache`. CI persists
`rr-cache` (actions/cache) so later scheduled runs replay them. Use MERGE, not
rebase-onto-upstream (shared team repo; rerere replays either way).

---

## Cross-references

- DFE platform: dfe-engine (control plane), dfe-infra (deploy), dfe-docs
- The OIDC trusted-header contract (`x-oidc-*`) is the universal seam shared
  with the rest of DFE -- see dfe-engine OIDC dual-mode design.
- FerretDB 2.x requires the Microsoft DocumentDB PG extension and **cannot be
  upgraded in place from 1.x** (clean install + dump/restore).
