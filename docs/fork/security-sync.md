# Security sync log

Reference log. Append-only, one dated section per sync, and the sections are
meant to be long - the detail IS the artefact. Do not compress old entries to
meet a length ceiling.

What we learn about the inherited dependency tree, each time we look at it.

Upstream's tree is not ours. We get a pile of alerts against it every sync, and
almost none of them are real here. This file is where the reasoning lives so we
do not redo it from scratch every time. Add a dated section each sync. Do not
delete old ones - a finding that stopped being true is worth knowing about.

Read `security/overrides.yaml` first for the bar an entry has to clear.

## How to tell if an alert is real

Three questions, in order. Most alerts die on the first one.

### 1. Is the package even in the image?

`docker/hyperdx/Dockerfile:101`:

```
RUN rm -rf node_modules && yarn workspaces focus @hyperdx/api --production
```

The image carries the api's PRODUCTION tree and nothing else. Every
devDependency, the cli and hdx-eval workspaces, and the app's server-side
dependencies get deleted before the final stage. The frontend goes in as a built
Next bundle.

So `yarn.lock` proves nothing. Neither does GitHub's `scope` field - it reads
the lockfile, not the image, and it will happily tell you a build tool is
runtime.

To check it properly:

```
yarn workspaces focus @hyperdx/api --production
fd --max-depth 1 -t d . node_modules --format '{/}'
yarn install          # put the dev tree back when you are done
```

### 2. If it IS in the image, does our code reach the vulnerable function?

Not "do we depend on it". Does the advisory's actual sink get called. Read the
advisory, find the function, then find the call.

`yarn why <pkg>` gives you the parents. If every parent is build tooling, stop.

### 3. If the sink is live, can an attacker get to it?

Write down the path. If you cannot write it down, it is not a vector. "npm audit
says high" is not a vector.

---

## 2026-08-26 - first full pass

99 open alerts. 2 critical, 58 high, 35 moderate, 4 low. Nobody had been through
them, and the audit gate in `.hyperi-ci.yaml` was set to `warn`, so none of them
had ever failed a build.

### The one number that mattered

Full install is 2691 packages. The api production closure is **331**.

Of the 38 packages carrying alerts, **21** are in the image:

ajv, bn.js, cross-spawn, fast-uri, fast-xml-parser, hono, ip-address, lodash,
path-to-regexp, picomatch, protobufjs, qs, semver, systeminformation, uuid,
`@hono/node-server`, and five `@opentelemetry/*`.

The other 17 are not. That kills most of the backlog in one go, including the
biggest clusters - tar (12 alerts), minimatch (9), js-yaml (4), postcss (4),
nanoid (3).

**Final tally: 1 real out of 99** - systeminformation, pinned. Everything else
is absent from the image, outside its vulnerable range in one direction or the
other, or has no path an attacker can take.

protobufjs was the last one standing and it went too, on the advisory's own
wording rather than on anything we did.

### tar - both criticals were not what they looked like

**#213, GHSA-23hp-3jrh-7fpw, critical.** Vulnerable `<= 7.5.18`, we have 6.2.1,
so in range. GitHub says `scope: runtime`.

It is not runtime. `yarn why tar` gives `cacache` and `node-gyp`, and `node-gyp`
only comes in through `evp_bytestokey` and `fsevents`. That is install-time
native-build tooling. It is gone by the time the image is built, and it is
absent from the 331.

Twelve tar alerts, all the same story. Re-traced and cleared by lockfile in the
2026-10-01 section.

### protobufjs - the one critical that IS real

**#97, GHSA-xq3m-2v4x-88gg, critical.** Vulnerable `< 7.5.5` and
`>= 8.0.0, < 8.0.1`.

Four copies in the tree, and only one is in range:

| Pulled by                                                         | Version    | In range |
| ----------------------------------------------------------------- | ---------- | -------- |
| `@hyperdx/api`, declared directly                                 | 7.6.5      | no       |
| `@grpc/proto-loader`                                              | 7.6.2      | no       |
| `@opentelemetry/otlp-transformer`                                 | 7.5.8      | no       |
| `@hyperdx/browser` -> `@hyperdx/otel-web-session-recorder@0.16.2` | **6.11.4** | **yes**  |

`@hyperdx/browser` is imported at `DBSearchPage.tsx:28`, `AppNav.tsx` and
`AppNavFeedback.tsx`, but the old copy never reaches the browser.
`@hyperdx/browser` 0.22.1 ships a prebuilt bundle with `protobufjs/minimal`
inlined and no external `require`, so the `node_modules` copy ships nowhere.
Corrected 2026-10-01 - this line first said the old copy went into the frontend
bundle.

The vulnerable copy is a transitive of a HyperDX package we do not control, so
there is nothing to bump directly. No `resolutions` entry was needed though. A
lockfile re-resolve inside the recorder's own `~6.11.2` range moved it to 6.11.6
(#114), which carries the type-name filter. Corrected 2026-10-01 - this
paragraph first said a `resolutions` pin was the only way.

**Then read the advisory properly, and it clears itself.** Its own text:

> Applications that only decode messages using trusted, application-defined
> schemas are not directly affected by this issue.

The preconditions are explicit - the attacker has to control a protobuf
definition or JSON DESCRIPTOR, and it has to be loaded through protobufjs
reflection APIs. The session recorder serialises OTLP telemetry against a fixed
schema compiled into the bundle. It never loads a descriptor from anywhere, let
alone an untrusted one.

So NOT reachable, and no pin needed. Which is the good outcome, because the pin
was the dangerous one: `resolutions` would have forced every copy to 7.x while
the recorder asks for `~6.11.2`, a major bump on a transitive of a package we do
not control.

The lesson worth keeping: "critical" plus "the vulnerable version is in our
tree" got this to the top of the list, and the thing that actually settled it
was two sentences in the advisory's own Impact section. Read those before
reaching for a pin.

For completeness, the init path is conditional anyway - `pages/_app.tsx:159`
only calls `HyperDX.init()` outside local mode and only when `/api/config`
returns an `apiKey`. That was not needed to clear it.

### systeminformation - pinned, and the tool then called it redundant

**#199 and #150, both high, command injection in `networkInterfaces()`.**

This one is genuinely reached. `packages/api/src/index.ts` instantiates
`@opentelemetry/host-metrics`, which requires `systeminformation/lib/network`
(`si.js:22`) and calls `networkStats()` on the metrics timer. `networkStats()`
calls `networkInterfaces()` at `network.js:1302` and `:1518`.

Where it stops: the source is host-local, not remote. Both advisories need the
attacker to already control host network config - a NetworkManager profile name,
or a `source` directive in `/etc/network/interfaces`. In a container that is
root-equivalent already. So it is privilege-escalation shaped, and it does not
clear the bar outright.

Pinned anyway at `^5.31.7`, because upstream already carries systeminformation
in `resolutions`, so we raise an existing key instead of adding conflict
surface. Lockfile moved 5.30.7 -> 5.33.1.

**The wart, and it will bite again.** Straight after applying it,
`scripts/security-override.py --check` reported the pin REDUNDANT and told us to
delete it. It compares our floor against the lockfile resolution that OUR OWN
PIN just produced, so it cannot tell an upstream fix from ours. `--verify` is
the one CI gates on and it is correct. Do not act on `--check` calling a fresh
pin redundant.

### ip-address - the only genuinely remote one, already closed

**#248, high, SSRF via leading-zero octets read as decimal.**

Lands exactly on `packages/api/src/utils/validators.ts:34` `isPrivateIp()`,
which is the SSRF guard for user-supplied webhook URLs. That is the one
unauthenticated remote vector in the whole set.

Already fixed: `packages/api/package.json:48` declares `ip-address ^10.3.1` and
the lock resolves 10.3.1, above the `<= 10.3.0` range. The still-vulnerable
10.1.0 and 9.0.5 copies sit under `socks-proxy-agent` and are never reached from
`isPrivateIp`.

**Re-check this one every sync.** If a merge ever drags that declaration back
below 10.3.1 it becomes a real remote SSRF immediately.

### Watch the scoped packages - a top-level listing misses them

First pass at "what is in the image" listed `node_modules` one level deep and
came back with 15 packages. That was wrong: a scoped package sits at
`node_modules/@scope/name`, so `@opentelemetry/core` reads as `@opentelemetry`
and never matches. Depth 2 is the real number - **21**, not 15.

Six more turned out to be in the image: `@hono/node-server` and five
`@opentelemetry/*`. Only `@babel/runtime` was genuinely absent.

### The OpenTelemetry six

Five of the six are inside their vulnerable ranges, so version alone does not
clear them. `packages/api/src/index.ts` starts metrics only:

```
const meterProvider = new MeterProvider({ readers: [getHyperDXMetricReader()] })
const hostMetrics = new HostMetrics({ meterProvider })
hostMetrics.start()
```

That is not the whole process though. `packages/api/bin/hyperdx` starts the api
and every task with `node -r @hyperdx/node-opentelemetry/build/src/tracing`, and
that preload calls `initSDK()`. Whenever `HYPERDX_API_KEY` or
`OTEL_EXPORTER_OTLP_HEADERS` is set it builds a `NodeSDK` with a tracer
provider, the auto-instrumentations (HTTP included) and the default propagators,
tracecontext plus baggage. With neither set it logs "OpenTelemetry SDK
initialization skipped" and starts nothing.

Corrected 2026-10-01. This section first said there was no `NodeSDK`, no tracer
provider, no HTTP instrumentation and no propagators. The 2026-10-01 section
below has the trace.

| Alert         | Package                                                   | Have            | Range               | Why it does not bite                                                                                                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------- | --------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 126, 127, 128 | exporter-prometheus, auto-instrumentations-node, sdk-node | 0.57.2 / 0.56.1 | `< 0.217.0`         | Prometheus exporter crash needs the exporter's own HTTP server. `sdk-node` builds a `PrometheusExporter` (`sdk.js:105-106`), which binds 9464, only when `OTEL_METRICS_EXPORTER` includes `prometheus`. Nothing in the repo sets it, so there is no server unless an operator opts in. Our metrics endpoint is `prom-client` in `dfe/observability/metrics.ts`. |
| 184           | core                                                      | 1.30.1          | `< 2.8.0`           | Unbounded memory in W3C Baggage propagation. REACHABLE whenever the SDK starts - see the 2026-10-01 section. Bounded by Node's 16 KB header cap, so tolerable risk rather than not used.                                                                                                                                                                        |
| 227           | propagator-jaeger                                         | 1.30.1          | `< 2.9.0`           | Needs `OTEL_PROPAGATORS` to include jaeger. That string appears NOWHERE in the repo - not code, compose or env - and OTel's defaults are tracecontext plus baggage.                                                                                                                                                                                             |
| 265           | @hono/node-server                                         | 1.19.17         | `>= 2.0.0, < 2.0.5` | Below the range, not above it. Also Windows-only path traversal, and we ship Alpine.                                                                                                                                                                                                                                                                            |

Alert 227 was left undetermined by the previous pass. It is settled: not
reachable.

Corrected 2026-10-01: the image has been Debian trixie since #103, not Alpine.
The traversal is Windows-only, so 265 still does not bite.

The same file is why systeminformation IS real - `hostMetrics.start()` on line
18 is the chain into `networkStats()`.

### The other 15 in the image

Resolved versions read out of the production `node_modules`, not from
`yarn.lock`.

| Package               | Resolved               | Verdict                                                                           |
| --------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| protobufjs            | 6.11.4 via browser SDK | in range, no vector - the advisory needs an untrusted descriptor and we load none |
| systeminformation     | 5.30.7 -> 5.33.1       | REAL - pinned this pass                                                           |
| ip-address            | 10.3.1                 | already above range, re-check every sync                                          |
| fast-xml-parser       | upstream pins `^4.5.6` | already handled upstream                                                          |
| ajv                   | 8.20.0                 | above `< 8.18.0`, not in range                                                    |
| cross-spawn           | 7.0.6                  | above `< 7.0.5`, not in range                                                     |
| fast-uri              | 3.1.4                  | above both 2.x ranges, not in range                                               |
| lodash                | 4.18.1                 | above `<= 4.17.23`, not in range                                                  |
| semver                | 6.3.1                  | BELOW the `>= 7.0.0` range, not in range                                          |
| path-to-regexp        | 0.1.12 via express     | in range, no vector - see below                                                   |
| picomatch             | 4.0.3                  | in range, no vector - see below                                                   |
| bn.js, qs, uuid, hono | -                      | medium or low, no reachable sink                                                  |

**path-to-regexp is the one worth understanding.** `express@4.22.1` pulls
`0.1.12`, which is inside #81's `< 0.1.13`, and express is unambiguously
production. The ReDoS is in ROUTE PATTERN compilation though, and route patterns
are our own source. An attacker supplies a URL, not a route definition. No
vector.

**picomatch** is in the closure but every parent is build tooling - jest,
rollup, knip, micromatch, tinyglobby, dotenvx. Both advisories are ReDoS via a
crafted GLOB, and our globs come from config. No vector.

**semver is the nice one.** Alerts #22 and #1 are `>= 7.0.0, < 7.5.2`, and we
resolve 6.3.1 - BELOW the vulnerable range, not above it. Worth reading version
ranges in both directions.

### Two feeds, not one - and dismissing alerts does not touch the gate

This one cost time. Dependabot alerts and the CI audit gate are SEPARATE.

`quality.typescript.audit` in `.hyperi-ci.yaml` runs
`yarn npm audit --severity moderate` (hyperi-ci builds that command in
`languages/typescript/quality.py`). It reads the lockfile against npm's advisory
DB. **Dismissing a Dependabot alert does nothing to it.** Plan the two
separately or you will dismiss 99 things and watch the build fail anyway.

Measured 2026-08-26: 99 Dependabot alerts, but only **26** audit findings at
moderate-and-above. Fewer because yarn dedupes by package, and different because
it walks the whole workspace including devDependencies - so it finds nested
copies the hoisted `node_modules` view hides. `lodash` reads 4.18.1 at the top
level and the audit finds a 4.17.21 copy; `semver` reads 6.3.1 and the audit
finds 5.7.1.

**How to silence one, properly.** Yarn Berry's own settings, confirmed present
in 4.13.0 via `yarn config --json`:

- `npmAuditIgnoreAdvisories` - a list of advisory IDs. Use this one.
- `npmAuditExcludePackages` - excludes a package entirely, so a NEW advisory
  against it is silenced too. Do not use it for risk acceptance.

The IDs are the numeric npm ones from the audit output (`1104000`), not GHSA
strings. Get them with:

```
yarn npm audit --severity moderate --json --recursive
```

Each line carries `children.ID`, `children.URL` (the GHSA link) and
`Tree Versions`. Put the ID in `.yarnrc.yml` with a comment naming the reason
and the date, same discipline as a `security/overrides.yaml` entry.

`.yarnrc.yml` is upstream's file, so an addition there is fork surface and
belongs in the catalogue.

**Other finding classes take an inline tag instead**, and should use it rather
than a config-level mute:

| Finding                       | Where the acceptance goes                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| dependency advisory           | `.yarnrc.yml` `npmAuditIgnoreAdvisories` - there is no line of code to tag                          |
| eslint `security/*`           | `// eslint-disable-next-line security/detect-object-injection -- <reason>` at the site              |
| semgrep (`fork-security.yml`) | `// nosemgrep: <rule-id> -- <reason>`, or a rule-scoped entry in `.hyperi-ci.yaml` `quality.ignore` |
| CodeQL, once enabled          | `// codeql[<rule-id>] -- <reason>`                                                                  |

The `.hyperi-ci.yaml` `quality.ignore` block already does this for two semgrep
rules, with a written reason each. Follow that shape.

### Tooling warts found on the way

- **`hyperi-ci deps drift` never read `yarn.lock`.** It looked for
  `package-lock.json` only, so it compared nothing and reported clean - on this
  repo and on dfe-ui. Fixed in hyperi-ci 2.9.23. First honest run here: 12
  floors a whole major behind the lock, including `zod` declared `3.25` against
  `4.4.3` locked, in four packages.
- **husky is not installed on a fresh clone**, so `lint-staged` never runs and
  formatting errors reach the commit. Two of ours got through that way this
  pass.

  Do not just run `yarn setup` to fix it. Installing husky turns on
  `.husky/pre-commit`, which also runs `npx knip --no-config-hints`, and knip
  cannot pass on this fork: it flags UPSTREAM's unused files -
  `BenchmarkPage.tsx`, `ClickhousePage.tsx`, all of `TeamSettings/*`,
  `SessionsPage.tsx`, `JoinTeamPage.tsx`, `TeamPage.tsx`,
  `DBServiceMapPage.tsx` - and deleting those is exactly the fork-surface damage
  we do not do. So installing husky blocks every commit. Tried it, reverted it
  with `git config --unset core.hooksPath`.

  The hook's own comment says it "runs the same check as the Knip CI workflow".
  There is no Knip workflow in this repo. Knip runs in the hook and nowhere
  else.

  Real fix, not done yet: scope knip to `packages/*/src/dfe/**` the same way
  `scripts/dfe-lint-ours.mjs` scopes eslint, so it audits our code and ignores
  upstream's. Until then the hook stays off and lint-staged has to be run by
  hand.

- **There are TWO ratchets, and the second one catches you fixing the first
  wrongly.** `--max-warnings` per package is one. `scripts/ci/ratchet.mjs` is
  the other, and it counts `as any` and `eslint-disable` occurrences against a
  committed baseline. So silencing an eslint warning with a disable comment
  passes the first and fails the second, by design. Good design - it is the
  guard against exactly that reflex.

  The right move is a real fix. `sql[i]` in a loop trips
  `security/detect-object-injection` on every read; `sql.charAt(i)` does not,
  and is the same operation. `as jest.Mock` trips `no-unsafe-type-assertion`;
  `jest.mocked()` is the typed helper and needs no cast. Eleven
  `(dfeConfig as any).X = ` assignments collapse to one
  `dfeConfig as Record<string, unknown>` alias. Twenty-one casts removed that
  way this pass, none of them muted.

- **The warning ratchet hides behind errors.** common-utils runs
  `eslint . --max-warnings 80` and was at 83. That was invisible while the run
  also had 3 prettier ERRORS - the summary reads "86 problems (3 errors, 83
  warnings)" and the eye goes to the errors. Fix the errors and the ratchet
  breach becomes the failure. Check both numbers, not the headline.

- **Renovate's blanket-disable pattern is broken upstream.**
  `matchFileNames: ['**'], enabled: false` plus `vulnerabilityAlerts` is the
  obvious way to say "security only", and Renovate 43.113.0 added a filter that
  drops those deps anyway - security PRs get autoclosed and no new ones appear
  (renovatebot/renovate#42655, closed as not planned). We scope by
  `includePaths` instead so there is no disabled dep to mis-filter.

### Repo settings are org policy, not a repo toggle

Trying to enable secret scanning per-repo returns a 422: "An enforced security
configuration prevented modifying secret scanning enablement."

The org carries four configurations, and a repo is attached to one:

| Config             | Enforced | Secret scanning | Push protection | Code scanning |
| ------------------ | -------- | --------------- | --------------- | ------------- |
| HyperI Default     | yes      | off             | off             | off           |
| HyperI Public      | yes      | on              | on              | on            |
| HyperI Public Fork | yes      | on              | off             | off           |
| GitHub recommended | no       | on              | on              | on            |

dfe-hyperdx is on **HyperI Default**, hyperi-ci is on **HyperI Public**. That is
the whole difference, and it is deliberate: dfe-hyperdx is PRIVATE
(`"visibility":"private"`, `"fork":false`), the org is on the Team plan, and
those features are only free on public repos. They stay off until the repo is
public and GA.

Do not confuse it with `hyperdx-1`, which IS a public fork and IS on HyperI
Public Fork - but was last pushed 2026-03-05 and is not where the work happens.

`dependabot_alerts` is `enabled` in every one of these configs, which is why the
alerts arrive regardless.

### What is done as of this pass

- 99 alerts -> 4. The 95 dismissed each carry their reason on the alert;
  `scripts/dismiss-triaged-alerts.py` holds the verdicts as data and re-runs
  after a sync.
- The 4 left open are systeminformation, the one real finding. They close when
  the pin reaches the default branch.
- The audit gate is back to `blocking` at `audit_level: moderate`, and
  `yarn npm audit --severity moderate` reports "No audit suggestions".
- Two real fixes fell out of clearing that gate: `@ungap/structured-clone` 1.3.0
  -> 1.3.3 for the CWE-502, and eslint -> 9.39.5.
- `SECURITY.md` points anyone running a scanner at this file before they file.

### Escape hatches: what came out, and what is left on purpose

`eslint-disable` in our api code went 8 to 3, without relaxing anything. The
patterns that replaced them, worth reusing:

- `jest.mocked(x)` instead of `x as jest.Mock` - typed, no cast, and it catches
  real errors the cast hid.
- `Object.assign(jest.fn(), { findOne: jest.fn() })` instead of
  `(Model as unknown as { findOne: jest.Mock })` - the intersection type is
  inferred, so the statics need no assertion. Works inside a hoisted `jest.mock`
  factory, where a helper cannot reach.
- `src/dfe/__tests__/doubles.ts` - one file holding the express and mongoose
  doubles, with ONE disable, replacing a file-level disable in each of six test
  files.
- `sql.charAt(i)` instead of `sql[i]` - same operation, and it does not trip
  `security/detect-object-injection` on every read.

**Do not try `jest.mocked()` on the mongoose controller mocks.** Tried it on
org-connection, provisioned-lockdown, user-provisioning and jwt-verify. It
type-checks the mock properly, which is the point, and that is exactly why it
fails: `createConnection` resolves a full mongoose `Document` - 50-plus methods

- so `mockResolvedValue({ _id: someObjectId })` is rejected. Minting real
  ObjectIds does not help; the Document shape is the blocker, not the id type.

17 tsc errors, and no honest way through short of building real Documents in
every fixture. The loose `x as jest.Mock` cast exists for that reason and the
file-level disables saying so were correct. `jest.mocked()` DOES work where the
mock is a plain function - admin-lockdown and team-provisioning - and those kept
it.

The three left are deliberate:

| Where                           | Rule                     | Why it stays                                                                                  |
| ------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `__tests__/doubles.ts`          | no-unsafe-type-assertion | The assertion IS the helper. One, instead of six.                                             |
| `middleware/admin-lockdown.ts`  | no-namespace             | Express type augmentation has no other spelling.                                              |
| `controllers/org-connection.ts` | no-unsafe-type-assertion | Two casts bridge upstream's loosely-typed controllers. The third is worth fixing - see below. |

**Done, and it was hiding a real one.** `org-connection.ts` asserted the
engine's JSON response and then hand-checked `name`, `host` and `username`. It
never checked `password` - which is written straight onto the ClickHouse
connection, so a response without one stored `undefined` as the password.

Now a zod parse, with the type inferred from the schema so the two cannot drift,
plus a regression test that fails against the old guard. That is the argument
for parsing over asserting in one example: the cast did not cause the bug, but
it made the bug something a reader had to notice rather than something the code
enforced.

### Still open

- Nothing further to fix. systeminformation was the only pin this pass.
- Repo settings are still off: secret scanning, push protection, code scanning.
  hyperi-ci has the first two on and CodeQL via default setup. Human-only to
  change, and on the Team plan they stay off for a private repo anyway.

Closed during the pass, recorded here so the next reader does not redo them:

- The ~50 alerts on packages absent from the image were dismissed by
  `scripts/dismiss-triaged-alerts.py`, each carrying its trace.
- `.hyperi-ci.yaml` is back to the house default of `blocking` at
  `audit_level: moderate`. The 26-finding backlog it was waiting on is cleared -
  `yarn npm audit --severity moderate` reports "No audit suggestions".

## 2026-08-27 - what an upstream merge puts back

### The fork surface catalogues what we CHANGE, never what we DELETE

`.fork-surface` is built from
`git diff --name-only --diff-filter=M <merge-base> HEAD` - modified files only.
`.githooks/fork-surface-check.py` reads the same range at `--diff-filter=ACMR`.
Neither looks at deletions. So a file we deleted from upstream is invisible to
both, an upstream merge brings it straight back, and the pre-commit hook and CI
check pass because nothing is looking.

Found it on `feat/json-first-class`: four of upstream's workflows are back, 2923
lines. Main deleted them in `3d08d465` ("remove og workflows (for now)"). All
four are byte-identical to upstream, which is exactly why the check misses
them - unmodified against the merge-base is invisible to `ACMR`.

| Workflow          | Fires on                 | What it would do                                                                              |
| ----------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `release.yml`     | push to main             | npm publish `@hyperdx/*`, docker push `hyperdx/*` and `clickhouse/clickstack-*` to Docker Hub |
| `main.yml`        | push + PR to main, v1    | duplicate lint and test on runner labels we do not have                                       |
| `deep-review.yml` | PR opened, synchronize   | runs a model, wants `ANTHROPIC_API_KEY`                                                       |
| `vouch.yml`       | PR opened, issue comment | outside-contributor triage                                                                    |

`release.yml` is the one that matters. Those Docker Hub namespaces and npm
scopes belong to hyperdxio and ClickHouse, not us. It fails for want of secrets,
which is luck rather than design - the question is whether it would try, and it
would.

Fix is the same as `3d08d465`: delete the four again. The durable fix is a
deletion catalogue the fork-surface check can read, so the next sync fails
loudly instead of quietly reinstating.

Cheap check, worth running every sync:

    git diff --stat origin/main..<branch> -- .github/workflows/

### The image source label pointed at the old repo name

`Dockerfile` said `hyperi-io/hyperi-hyperdx` in three places. Two were header
comments. The third was `org.opencontainers.image.source`, which is baked into
every published image and is what GHCR reads to link the package back to its
repo. It resolves today only because GitHub redirects the old name. Create a new
repo at that name and the provenance on every image we have shipped points
somewhere else.

The repo is `hyperi-io/dfe-hyperdx`, renamed from `hyperi-hyperdx`. The image is
`ghcr.io/hyperi-io/dfe-hyperdx`: hyperi-ci builds it from `publish.container` in
`.hyperi-ci.yaml` and names it `ghcr.io/<org>/<checkout dir>`, which is the repo
name. GHCR is the only registry hyperi-ci publishes to - Docker Hub login exists
in the reusable workflow purely to dodge anonymous pull limits. Upstream's
`release.yml` Docker Hub path is not ours and never was.

## 2026-09-04 - npm's advisory endpoint is browning out, so the gate is a coin toss

Five open PRs went red on `ci / Quality` overnight with the same two lines,
while `ci / Test` stayed green:

    audit: failed
    YN0001: RequestError: Timeout awaiting 'socket' for 60000ms

dfe-ui hit it first and put it down to the self-hosted runners (dfe-ui#210
guesses path MTU on arc-native). It is neither the runners nor us. The same
command fails from an ordinary Linux box on a home network, and so does plain
`curl` with a one-package body.

The endpoint is not down. It is answering less than half the time. Twelve
identical `curl` POSTs from that home-network box at 14:29 AEST, two seconds
apart, body `{"lodash":["4.17.20"]}`:

| Attempts | Result                           |
| -------- | -------------------------------- |
| 5 of 12  | 200, between 3.2s and 8.9s       |
| 7 of 12  | zero bytes, never answers at 25s |

A run that draws a hang gets a hard CI failure, and a blocking gate on a 42%
pass rate gates nothing except whoever pushed at the wrong minute.

The rest of the picture, measured the same afternoon on a 32-core build host and
on that home-network box, which take separate network paths:

| Request                                              | Result              |
| ---------------------------------------------------- | ------------------- |
| `GET /lodash`                                        | 200 in 0.078s       |
| `POST /-/v1/login`, body `{}`                        | 401 in 0.211s       |
| `POST /-/npm/v1/user`, body `{}`                     | 401 in 0.199s       |
| `GET /-/npm/v1/security/advisories/bulk`             | 405 in 0.197s       |
| `POST /-/npm/v1/security/audits/quick`               | 0 bytes in 45s      |
| `yarn npm audit --severity moderate`                 | socket timeout, 61s |
| same, `npmAuditRegistry: https://registry.npmjs.org` | socket timeout, 62s |

So the registry is fine, the path is routable (the 405 on GET says so), and
POSTs to npm are answered in a fifth of a second on every other endpoint.
`registry.yarnpkg.com` behaves the same as `registry.npmjs.org`, so
`npmAuditRegistry` is no help, and `{}` hangs as often as a real body does, so
it is not request size. Nothing on our side changes the odds.

For the record, `/-/npm/v1/security/audits/quick` was retired after 2026-07-15
and should answer 410. It hangs as well, so it is the whole security-advisory
path in this state rather than one endpoint.

`.hyperi-ci.yaml` therefore holds `quality.typescript.audit: warn`. What that
does and does not cost:

- The triaged advisory exclusions in `.yarnrc.yml` are untouched and apply on
  every run the endpoint does answer.
- osv-scanner reads the same `yarn.lock` against osv.dev, which is answering,
  and already reports on every run (66 packages, 127 advisories, non-blocking).
- Dependabot stays enabled and the alerts keep arriving.

Revert to `blocking` once this comes back clean rather than one in two:

    for i in $(seq 1 12); do
      curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 25 \
        -X POST -H 'Content-Type: application/json' --data '{"lodash":["4.17.20"]}' \
        https://registry.npmjs.org/-/npm/v1/security/advisories/bulk
      sleep 2
    done

## 2026-09-21 - a fresh 26, and two verdicts that had gone stale under us

26 open alerts: 11 high, 12 moderate, 3 low. All 26 are dismissed. None clears
the `security/overrides.yaml` bar, so nothing is pinned and the register is
unchanged.

The interesting part is not the tally. Two entries in
`scripts/dismiss-triaged-alerts.py` were written against advisories that have
since been superseded, and both would have re-dismissed a new alert with a
reason that is no longer true.

### fast-uri - the range moved up past us, not the other way round

The old entry read "Resolves 3.1.4, above both 2.x ranges", and when it was
written that was correct. Four new advisories (GHSA-jqff-g426-hqxp,
GHSA-f65p-4m7j-42xc, GHSA-5jgf-p345-68v8, GHSA-fph4-wmhf-6fwf) are all
`< 3.1.6`. We still resolve 3.1.4, so we went from above the range to inside it
without moving.

This is the `ip-address` failure mode in reverse. That entry carries a RE-CHECK
EVERY SYNC note because a merge could drag the version DOWN into range. Nobody
wrote the mirror note, which is that a new advisory can raise the ceiling over a
version that never moved. A version-comparison verdict has a shelf life and the
advisory, not the lockfile, decides when it expires.

Still not reachable, for a different reason than before:

    @hyperdx/api -> @modelcontextprotocol/sdk@1.29.0 -> ajv@8.20.0 -> fast-uri@3.1.4

ajv is the only parent. It uses fast-uri to resolve `$id` and `$ref` and to
validate `format: uri`, against schemas that are our own source, and it issues
no request of its own. All four advisories are host confusion or SSRF, which
need a requester downstream of the parse. There is none. The fork also puts
`requireServicePrincipal` in front of `/mcp` (`api-app.ts:137`), so the
transport that drags ajv in is not reachable by a human user at all.

### qs - the old reason was simply wrong

The old entry read "No call site passes request-derived input to the sink."
Express's own query parser is a call site, and `req.query` is request-derived:

    @hyperdx/api -> express@4.22.1 -> qs@6.14.2
    @hyperdx/api -> express@4.22.1 -> body-parser@1.20.6 -> qs@6.15.3

Every request that carries a query string or an urlencoded body reaches qs
before any of our code does. GHSA-4mjr-xmp4-gh2g (DoS via attacker-controlled
`isBuffer`) and GHSA-x5fp-wj9c-mxmx (array-limit bypass via bracket-key comma
parsing) are both live against that path.

It is dismissed as `tolerable_risk` rather than `not_used`, which is the first
entry in that table to use it. Both advisories are moderate, so they do not
clear THE BAR, and the caller is an OIDC-authenticated tenant user rather than
the open internet - HyperDX sits behind Envoy or oauth2-proxy in every DFE
deployment. What it buys an attacker is a self-inflicted DoS on the tenant they
already have an account on.

**Watch this one.** The parents pin `~6.14.0` and `~6.15.1`, so a `resolutions`
bump to 6.16.0 is not free - express and body-parser would each be off their
declared range. If a HIGH lands against the same qs code path, it IS reachable
and it WILL clear the bar, and the fix is upstream's to make.

### The rest, and the shape they fall into

`dependency.scope` from Dependabot got two wrong again in the same direction the
2026-08-26 pass warned about - it reads the lockfile, not the image.
`@vitest/mocker` (#284) and `js-yaml` 4.1.1 (#290) are both labelled runtime and
both are dev.

| Package                  | Alerts                 | Where it actually lives                                  |
| ------------------------ | ---------------------- | -------------------------------------------------------- |
| smol-toml                | #292                   | knip, nx                                                 |
| js-yaml                  | #290, #291             | 3.15.0 via jest, 4.1.1 via cosmiconfig and swagger-jsdoc |
| brace-expansion          | #267, #268             | nodemon, tsup, minimatch                                 |
| csv-parse                | #283                   | @changesets/cli via tty-table                            |
| @humanfs/node            | #274                   | eslint                                                   |
| colord                   | #289                   | stylelint                                                |
| @vitest/mocker           | #284                   | @storybook/builder-webpack5                              |
| browserslist             | #279, #280             | babel, webpack, next - build-time target resolution      |
| baseline-browser-mapping | #285                   | browserslist, next - same                                |
| postcss-selector-parser  | #269, #270             | postcss-modules, postcss-nested, stylelint               |
| fflate                   | #277, #278             | rrweb and the session recorder, in the browser bundle    |
| @ai-sdk/provider-utils   | #282                   | @ai-sdk/anthropic and @ai-sdk/openai, in the image       |
| hono                     | #286, #287, #288       | @modelcontextprotocol/sdk, in the image                  |
| fast-uri                 | #272, #273, #275, #276 | ajv via the MCP SDK, in the image                        |
| qs                       | #271, #281             | express and body-parser, on the request path             |

Four of those need more than a parent list.

**browserslist** (both high) needs an untrusted `browserslist-stats.json` fed to
`normalizeStats`. That file is a build input in the repo. An attacker who can
write it has already won.

**fflate** ships to the browser, via rrweb and
`@hyperdx/otel-web-session-recorder`, both imported through `@hyperdx/browser`
(`_app.tsx:9`, `DBSearchPage.tsx:28`, `AppNav.tsx:6`, `AppNavFeedback.tsx:3`).
The advisory is an infinite loop in `unzipSync` on a malformed ZIP64 archive. A
session recorder compresses; nothing in the bundle parses a ZIP. Grepping
`packages/` for `unzipSync`, `unzlibSync`, `decompressSync` and `fflate` returns
nothing, so no code of ours reaches it either. NOT VERIFIED against the library
source: this clone has an empty `node_modules` and no `.yarn/cache`, so the
recorder's own call sites were not read.

**@ai-sdk/provider-utils** is in the image, reached from `@ai-sdk/anthropic` and
`@ai-sdk/openai`, both direct api dependencies, behind
`app.use('/ai', isUserAuthenticated, routers.aiRouter)` (`api-app.ts:140`). It
is inert in a DFE deployment: `getAIModel()` (`controllers/ai.ts:43`) throws
unless `AI_PROVIDER` or `ANTHROPIC_API_KEY` is set, and neither appears in
`.env.dfe-example` or `docker-compose.dfe.yml`. The advisory is uncontrolled
resource consumption, and the router caps `text` at 10000 characters with zod
before the SDK sees it.

**hono** is in the image via the MCP SDK and is never imported.
`api/src/mcp/app.ts:3` takes `StreamableHTTPServerTransport` and mounts it on an
express router, so no Hono app is ever constructed. `parseBody()`, the query
parser and `toSSG()` all belong to one. Grepping `packages/` for `from 'hono'`
and `@hono/node-server` returns nothing.

### How the closure was read this time

No `yarn workspaces focus` run - this clone has no installed tree and the
working copy belongs to another branch. The production closure was walked out of
`yarn.lock` instead, from `packages/api/package.json`'s `dependencies` only,
following `dependencies` only.

One trap in doing it that way, worth writing down: the root `package.json`
`resolutions` rewrite a descriptor before it reaches the lockfile, so a naive
walk loses whole subtrees. `express` is declared `^4.19.2` by the api and the
lockfile only carries `express@npm:^4.20.0`, because `resolutions` forces it.
The first pass silently dropped express, body-parser and both request-path
copies of qs - which is exactly the finding that mattered. Apply the name-keyed
resolutions before looking a descriptor up.

The walk also crosses into sibling workspaces, and a workspace lockfile entry
lists dev dependencies alongside runtime ones, so `@hyperdx/common-utils` drags
in jest, nodemon, tsup and stryker. That is what put js-yaml, browserslist,
brace-expansion and a third copy of qs in the first result. Trace the path
before believing the membership.

## 2026-09-25 - npm's advisory endpoint answers again, so audit is blocking again

The revert loop from the 2026-09-04 entry, run at 01:13 AEST, came back clean:

| Attempts | Result                       |
| -------- | ---------------------------- |
| 12 of 12 | 200, between 0.20s and 0.26s |

The gate itself passes on this lockfile. `yarn npm audit --severity moderate`,
the exact command hyperi-ci runs, answers `YN0001: No audit suggestions` with
the `.yarnrc.yml` exclusions in place.

So `quality.typescript.audit` comes out of `.hyperi-ci.yaml` and the house
default, `blocking`, applies again. If the brownout returns, the loop above is
still the test, and one success still says nothing.

## 2026-09-27 - image-size, and the copy Dependabot cannot see

Two open alerts, both high, both image-size 2.0.2. Neither clears THE BAR, so
nothing is pinned.

| Alert | Advisory            | Parser the loop is in | Vulnerable           | Fixed |
| ----- | ------------------- | --------------------- | -------------------- | ----- |
| #293  | GHSA-5p2g-fcmc-qvqq | JXL and HEIF          | `>= 1.2.0, <= 2.0.2` | 2.0.3 |
| #294  | GHSA-w3rx-r6r6-pgpr | ICNS                  | `>= 0.6.3, <= 2.0.2` | 2.0.3 |

2.0.3 and 2.0.4 both shipped 2026-09-14. Upstream already has a
`dependabot/npm_and_yarn/image-size-2.0.4` branch, so the lockfile copy moves on
a sync.

### The lockfile copy is dev only

`yarn why image-size --recursive` gives one path:

    @hyperdx/app -> @storybook/nextjs@10.1.4 -> image-size@2.0.2

`@storybook/nextjs` is an app devDependency. Dependabot calls it `runtime`
because it reads the lockfile, not the image - the same mistake as every earlier
pass. After `yarn workspaces focus @hyperdx/api --production` there is no
`image-size` directory anywhere in `node_modules`.

### Next vendors the same code, and that copy is in the image

`next@16.3.4` ships its own image-size at `next/dist/compiled/image-size` and
the type detector at `next/dist/compiled/image-detector/detector.js`. Neither is
in `yarn.lock`, so no alert will ever fire on them. Both carry the ICNS, JXL and
HEIF parsers, and the vendored JXL parser still throws 2.0.2's
`No codestream found in JXL container`, so it predates the fix. The standalone
server that `Dockerfile:106` copies into the image loads them from
`next/dist/server/image-optimizer.js`.

It still does not bite. Diffing 2.0.2 against 2.0.4 puts all three loops in
`calculate()` - the ICNS entry walk, the HEIF `ispe` walk and the JXL `jxlp`
walk. The only loop `validate()` reaches is `findBox`, which advances by the box
size or by 8 on a zero, so it always terminates. Next splits the two:

- `detectContentType()` runs on every buffer the optimiser fetches and falls
  back to `detector()`, which runs `validate()` only.
- `getImageSize()` is the only caller of `calculate()`, and
  `image-optimizer.js:1155` calls it only under `opts.isDev`, on the blur
  placeholder sharp has just produced.

So production never parses request-derived bytes with the vulnerable code, and
`/_next/image` sits behind the OIDC gateway anyway. The vendored copy moves when
a Next release vendors 2.0.3 or later. Check it on the next sync with:

    rg -o 'No codestream found in JXL container' node_modules/next/dist/compiled/image-size/index.js

### Recorded

- `scripts/dismiss-triaged-alerts.py` already carried image-size as absent from
  the image. Its reason now names the parent.
- Dismissing #293 and #294 is the same `not_used` verdict. It needs repo admin,
  so it is not done here.

## 2026-10-01 - four claims the dismissals stood on, and the tar critical

Four statements in the 2026-08-26 pass were wrong, and the dismissals for alerts
97, 126-128 and 184 point at this file. Each is corrected in place above with a
dated note. The evidence is here.

### protobufjs never reaches the browser

`@hyperdx/browser` 0.22.1 ships one file, `build/index.js`, 512738 bytes. It has
no `require(` call and no ES import of any package. It does carry `LongBits`,
`BufferWriter`, `BufferReader` and the `invalid wire type` error, which is
`protobufjs/minimal` inlined. `Root.prototype.load`, `illegal token` and
`resolveAll` are absent, so there is no reflection or parser in it. The app
imports `@hyperdx/browser` and nothing else from that family (`_app.tsx:9`,
`DBSearchPage.tsx:28`, `AppNav.tsx:6`, `AppNavFeedback.tsx:3`).

So the 6.11.x copy under `@hyperdx/otel-web-session-recorder/node_modules` is
never bundled. The published image agrees.
`ghcr.io/hyperi-io/dfe-hyperdx:latest` (0.2.8, revision 6fafb089) carries
protobufjs 7.6.5, 7.6.2 and 7.5.8 and no 6.x copy anywhere. #114 has since moved
the 7.x copies to 7.6.6.

No `resolutions` entry was ever needed. #114 re-resolved the recorder's copy to
6.11.6 inside its `~6.11.2` range, and 6.11.6 strips non-word characters from
type names at `src/type.js:32`, the GHSA-xq3m-2v4x-88gg fix.

### The tracing SDK does start

`packages/api/bin/hyperdx` runs the api and every task as
`node -r @hyperdx/node-opentelemetry/build/src/tracing`, and `entry.prod.sh`
lines 41, 48 and 50 launch through it. That module calls `initSDK({})`
(`@hyperdx/node-opentelemetry` 0.9.0, `build/src/otel.js:93`). It returns early
only when neither `HYPERDX_API_KEY` nor `OTEL_EXPORTER_OTLP_HEADERS` is set
(`otel.js:110`). Otherwise it builds a `NodeSDK` with a span processor and the
auto-instrumentations, HTTP enabled, and starts it.

`NodeSDK.start()` registers the tracer provider whenever it has a span
processor, which is always unless `OTEL_TRACES_EXPORTER=none`. With no explicit
propagator it builds one from `OTEL_PROPAGATORS`, and that defaults to
tracecontext plus baggage (`@opentelemetry/core` 1.30.1 `environment.js:108`,
`sdk-trace-base` `BasicTracerProvider.js:209-211`). `docker-compose.yml:57`
passes `HYPERDX_API_KEY` through, so any deployment that sets a key runs all of
it.

Prometheus is the narrow one. `start()` always calls
`configureMetricProviderFromEnv()`, which builds a `PrometheusExporter`
(`sdk-node` `sdk.js:105-106`) only when `OTEL_METRICS_EXPORTER` includes
`prometheus`. The exporter's constructor binds 9464 unless `preventServerStart`
is set. `git grep OTEL_METRICS_EXPORTER` finds nothing. So alerts 126-128 still
do not bite, but because nobody opts in, not because nothing starts the SDK.

### #184 - reachable, bounded, tolerable risk

With the SDK running, every inbound request on the api port reaches the sink:

```text
http server 'request'
  -> instrumentation-http 0.57.2  http.js:385  propagation.extract(ROOT_CONTEXT, headers)
  -> CompositePropagator -> W3CBaggagePropagator.extract  (@opentelemetry/core 1.30.1)
```

That runs before express, so before any auth middleware. In a DFE deployment the
OIDC gateway stops an unauthenticated request first, but anything that reaches
the pod port directly gets to the propagator.

What bounds it is the advisory's own Impact section. Node caps the combined
headers at 16 KB by default, the header is already in memory, and the extra cost
is splitting it into entry objects. The image raises nothing - neither the
`Dockerfile` nor `entry.prod.sh` sets `NODE_OPTIONS`. The 128 KB
`--max-http-header-size` lives in `packages/api/.env.development` and its
example, and the `Dockerfile` copies neither.

No lockfile fix exists. `sdk-node` 0.57.2, `sdk-trace-base` 1.30.1,
`sdk-trace-node` 1.30.1 and `instrumentation-http` 0.57.2 all pin core at
exactly `1.30.1`, and `@hyperdx/node-opentelemetry` `^0.9.0` holds them there.
2.8.0 needs a newer `@hyperdx/node-opentelemetry`, which is a change to
upstream's `package.json`.

Verdict: the dismissal holds, on a different reason. It is `tolerable_risk`, not
`not_used`. Moderate, at most 16 KB of parsing per request, and it does not
clear THE BAR. The `not_used` comment on #184 and the `@opentelemetry/core`
entry in `scripts/dismiss-triaged-alerts.py` still carry the old claim.
Re-dismissing needs repo admin.

### tar - the critical is out of the lockfile

Alert 213, GHSA-23hp-3jrh-7fpw, npm 1123940. Decompression and parse DoS,
`<= 7.5.18`. The only parent was Yarn's implicit `node-gyp@npm:latest`, locked
at 10.2.0:

```text
@hyperdx/app -> @storybook/nextjs -> node-polyfill-webpack-plugin -> crypto-browserify
  -> browserify-cipher -> browserify-aes -> evp_bytestokey -> node-gyp@10.2.0 -> tar@6.2.1
node-gyp@10.2.0 -> make-fetch-happen@13.0.1 -> cacache@18.0.4 -> tar@6.2.1
```

plus `fsevents` under rollup, jest, nodemon and playwright, which never installs
on Linux.

It never ran. A full Linux install builds nx, esbuild, msw, protobufjs,
core-js-pure, @scarf/scarf and unrs-resolver, and nothing through node-gyp. The
image installs with `--mode=skip-build` (`Dockerfile:38`). Neither tar nor
node-gyp is in the `yarn workspaces focus @hyperdx/api --production` tree, or
under `/app` in the published image.

Fixed anyway, because it is one command. `yarn up --recursive node-gyp` moves
`node-gyp@npm:latest` to 13.0.2 (2026-08-26), whose `tar ^7.5.4` locks 7.5.22
(2026-07-24). That clears every tar range in the audit, the highest being
GHSA-r292-9mhp-454m at `<= 7.5.20`. cacache, make-fetch-happen and their subtree
drop out. `yarn npm audit --all --recursive` with the ignore list emptied loses
exactly the twelve tar advisories and gains none. node-gyp 13 wants Node
`^22.22.2 || ^24.15.0 || >=26`, and both `.nvmrc` (22.23.1) and the image
(24.21.0) qualify.

### brace-expansion - which ids still match

`yarn.lock` holds 1.1.21, 2.1.7, 5.0.8 and 5.0.12. Only 5.0.8 is in range of
anything, and it is `nx@23.1.1` pinning `brace-expansion: "npm:5.0.8"` exactly.
nx is a root devDependency, and the production focus tree has no brace-expansion
at all.

| npm id  | Advisory            | Range             | Matches 5.0.8 |
| ------- | ------------------- | ----------------- | ------------- |
| 1130734 | GHSA-rgw5-rvv9-x895 | `>=4.0.0 <5.0.9`  | yes           |
| 1240103 | GHSA-q2hr-2g5m-vwhr | `>=4.0.0 <5.0.12` | yes           |
| 1240107 | GHSA-qhr7-859c-m2p7 | `>=4.0.0 <5.0.11` | yes           |
| 1240111 | GHSA-6j4f-fj2g-mc7p | `>=4.0.0 <5.0.10` | yes           |
| 1130736 | GHSA-rgw5-rvv9-x895 | `>=2.0.0 <2.1.4`  | no - 2.1.7    |
| 1130737 | GHSA-rgw5-rvv9-x895 | `<1.1.18`         | no - 1.1.21   |

None of them reach the CI gate. `yarn npm audit --severity moderate` audits the
root workspace's direct dependencies only, and with the ignore list emptied it
reports nothing but the eslint deprecation. The numeric ids matter to
`--recursive` runs like the one this file recommends.

### What the image carries that no audit sees

The published image is the root `Dockerfile` (`.hyperi-ci.yaml`
`release.container`), not `docker/hyperdx/Dockerfile`. The production tree is
the focus at `Dockerfile:87`, and three more things ship beside it:

- `Dockerfile:99` copies `packages/common-utils/node_modules` from the FULL
  install. A local full install puts only `dotenv` there.
- `Dockerfile:100` copies the Next standalone trace. In 0.2.8 it carries its own
  `minimatch` with brace-expansion 1.1.17, inside 1130737's `<1.1.18`. The
  lockfile has since moved to 1.1.21.
- The node base image's own npm at `/usr/local/lib/node_modules/npm` carries tar
  7.5.19, node-gyp 12.4.0 and brace-expansion 5.0.7. None of it is in
  `yarn.lock`, so neither the audit nor Dependabot sees it. tar 7.5.19 is above
  the critical's range and inside GHSA-r292-9mhp-454m. npm runs once, at build,
  for `npm install -g concurrently@9.1.0` (`Dockerfile:127`), and nothing at
  runtime calls it.

## 2026-10-01 - axios, webpack-dev-middleware, and seven comments that named the wrong copy

16 open alerts: 12 axios (#310-#321), 3 brace-expansion (#299, #302, #305) and
webpack-dev-middleware (#298). All 16 are `not_used`. None clears THE BAR and
none has a lockfile fix, so nothing is pinned or re-resolved.

The image was read three ways on `b07c0deb3`:
`yarn workspaces focus @hyperdx/api --production` in a clean worktree, a full
`yarn install --mode=skip-build` for what `Dockerfile:99` and `Dockerfile:100`
copy, and the published `ghcr.io/hyperi-io/dfe-hyperdx:latest` (0.2.8, revision
6fafb089) for what the Next trace carries.

### axios - fixed in the image, still pinned by nx

Two copies, and all 12 ranges end at `< 1.20.0`:

```text
@hyperdx/api -> @slack/webhook@7.0.7 -> axios@1.20.0
hyperdx (root) -> nx@23.1.1 -> axios@1.18.1      nx pins "1.18.1" exactly
```

The production focus holds one axios, 1.20.0, which #111 put there.

The Next trace carries axios too. `pages/api/[...all].ts` imports
`@hyperdx/api/build/serverless` behind `HDX_PREVIEW_INLINE_API`, and the trace
follows that import into `@slack/webhook`
(`.next/server/pages/api/[...all].js.nft.json` in 0.2.8). In a full install nx's
1.18.1 is hoisted to `node_modules/axios` and 1.20.0 sits at
`node_modules/@slack/webhook/node_modules/axios`. Node resolves `axios` from
`@slack/webhook` to the nested 1.20.0, which is the copy the trace should take.
NOT VERIFIED with a Next build.

No lockfile fix exists. nx pins axios exactly, and nx 23.2.1, the latest
(2026-09-09), still pins `axios: 1.18.1` and `brace-expansion: 5.0.9`.

**The published image is behind main.** 0.2.8 predates #111 and carries axios
1.18.1 at `/app/node_modules/axios` and `/app/packages/app/node_modules/axios`.
There the check-alerts task posts to a webhook URL a tenant user configures
(`tasks/checkAlerts/transports/slack.ts:25`) through 1.18.1. Whether any of the
12 advisories is reachable that way in 0.2.8 was not traced. The dismissals
describe main, and the image catches up at the next release.

### webpack-dev-middleware - Storybook's dev server

#298, GHSA-g84c-rxfj-3j2c, high. Path traversal in `getFilenameFromUrl` when
`publicPath` has no trailing slash. The range is `< 7.4.5`, and the advisory's
own text puts the fix at 8.3.0 with no backport to 6.x or 7.x.

```text
@hyperdx/app -> @storybook/nextjs@10.1.4 -> @storybook/builder-webpack5@10.1.4 -> webpack-dev-middleware@6.1.3
```

`@storybook/nextjs` is an app devDependency (`packages/app/package.json:115`),
and only `storybook dev` serves the middleware. It is in neither the production
focus nor the 0.2.8 image. GitHub's `scope: runtime` is the lockfile reading
again.

There is no fix to take. `@storybook/builder-webpack5` 10.6.1, the latest, still
declares `webpack-dev-middleware: ^6.1.2`.

### brace-expansion - verdict kept

#299, #302 and #305 match only 5.0.8, nx's exact pin, as the section above
found. The production focus has no brace-expansion. 0.2.8 carries 1.1.17 in the
Next trace, below these `>= 4.0.0` ranges, and 5.0.7 in the base image's npm,
inside them but run only at build.

### Seven comments that described the wrong copy

A verdict is one comment per package, and a package's alerts can name different
ranges and different copies. Each of these comments was true of the advisory it
was written for and false on another alert.

| Alerts        | Package     | The comment said                   | Measured                                                                                                                                                                      |
| ------------- | ----------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #5            | cross-spawn | 7.0.6, above `< 7.0.5`             | #5 also covers `< 6.0.6`. The image has 7.0.6 only. The in-range 5.1.0 is spawndamnit under `@changesets/cli`                                                                 |
| #1, #22       | semver      | resolves 6.3.1                     | The image has 7.5.2, 7.5.4 and 7.6.2, plus 7.8.5 in the trace. The in-range 5.7.1 and 7.0.0 come from nodemon and `@changesets/cli`, both dev                                 |
| #31           | ajv         | 8.20.0, above `< 8.18.0`           | #31 also covers `< 6.14.0`. The image has 8.20.0 only. The 6.12.6 is schema-utils 3 under two webpack plugins                                                                 |
| #19, #88, #89 | lodash      | concurrently's 4.17.21 is dev only | concurrently is an api dependency (`packages/api/package.json:37`) and `entry.prod.sh:45` runs it, so its 4.17.21 ships. Its `dist` never calls `template`, `unset` or `omit` |

All seven stay `not_used`, and the verdicts in
`scripts/dismiss-triaged-alerts.py` now carry what is measured here.

### Correcting a dismissal means reopening it

GitHub's docs say "You can only dismiss open alerts." So
`scripts/dismiss-triaged-alerts.py --refresh` reopens each dismissed alert whose
reason or comment differs from its verdict, then dismisses it again. A dismissed
alert with no verdict is left alone.

`--dry-run --refresh` against the live repo lists 27. #184 and #156 move to
`tolerable_risk`. #126-#128, #97 and ten more protobufjs alerts, four js-yaml
alerts and the seven above take new comments. The other 55 already match.

A dismissed alert whose copy leaves the lockfile turns `fixed` by itself. The
tar alerts did that on 2026-10-01, and GitHub cleared their dismissal fields.

### The audit ignore list, measured

| Run                                               | With the `.yarnrc.yml` list | List emptied                |
| ------------------------------------------------- | --------------------------- | --------------------------- |
| `yarn npm audit --severity moderate`, the CI gate | nothing                     | `eslint (deprecation)` only |
| `yarn npm audit --recursive`                      | 20 findings                 | 39 findings                 |

Of the list's 25 entries, `--recursive` no longer reports 1113714 (ajv),
1121860, 1123911 and 1138115 (js-yaml), or 1130736 and 1130737
(brace-expansion). `--all --recursive` still reports the first four, so only
1130736 and 1130737 are gone from every run. The 20 findings left under
`--recursive` are the 12 axios ids, three brace-expansion ids and five more, all
dev only.
