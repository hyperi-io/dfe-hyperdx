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

Twelve tar alerts, all the same story.

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
`AppNavFeedback.tsx`, so the old copy goes into the frontend bundle.

The wart: the vulnerable copy is a transitive of a HyperDX package we do not
control, so there is nothing to bump directly. It needs a `resolutions` entry
raising protobufjs across the tree, and then someone has to confirm the session
recorder still works.

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

### The OpenTelemetry six, and why none of them bite

Five of the six are inside their vulnerable ranges, so version alone does not
clear them. What clears them is that `packages/api/src/index.ts` starts METRICS
ONLY:

```
const meterProvider = new MeterProvider({ readers: [getHyperDXMetricReader()] })
const hostMetrics = new HostMetrics({ meterProvider })
hostMetrics.start()
```

No `NodeSDK`, no tracer provider, no HTTP instrumentation, no propagators
registered.

| Alert         | Package                                                   | Have            | Range               | Why it does not bite                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------- | --------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 126, 127, 128 | exporter-prometheus, auto-instrumentations-node, sdk-node | 0.57.2 / 0.56.1 | `< 0.217.0`         | Prometheus exporter crash needs the exporter's own HTTP server. We never instantiate it - our metrics endpoint is `prom-client` directly in `dfe/observability/metrics.ts`. The package only arrives because `sdk-node` bundles every exporter. |
| 184           | core                                                      | 1.30.1          | `< 2.8.0`           | Unbounded memory in W3C Baggage propagation. Baggage needs a propagator on a tracing SDK, and no tracing SDK is started.                                                                                                                        |
| 227           | propagator-jaeger                                         | 1.30.1          | `< 2.9.0`           | Needs `OTEL_PROPAGATORS` to include jaeger. That string appears NOWHERE in the repo - not code, compose or env - and OTel's defaults are tracecontext plus baggage.                                                                             |
| 265           | @hono/node-server                                         | 1.19.17         | `>= 2.0.0, < 2.0.5` | Below the range, not above it. Also Windows-only path traversal, and we ship Alpine.                                                                                                                                                            |

Alert 227 was left undetermined by the previous pass. It is settled: not
reachable.

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

## 2026-09-04 - the audit gate cannot pass, and it is npm's end

Every open PR went red on `ci / Quality` with the same two lines, while
`ci / Test` stayed green:

    audit: failed
    YN0001: RequestError: Timeout awaiting 'socket' for 60000ms

dfe-ui hit it first and put it down to the self-hosted runners (dfe-ui#210
guesses path MTU on arc-native). The measurements say otherwise: the same
command fails from an ordinary Linux box on a home network, and so does plain
`curl` with an empty body.

Measured on desktop-derek, 2026-09-04:

| Request                                              | Result              |
| ---------------------------------------------------- | ------------------- |
| `GET registry.npmjs.org/lodash`                      | 200 in 0.078s       |
| `GET /-/npm/v1/security/advisories/bulk`             | 405 in 0.197s       |
| `POST /-/npm/v1/security/advisories/bulk`, body `{}` | 0 bytes in 45s      |
| `POST /-/npm/v1/security/audits/quick`               | 0 bytes in 45s      |
| `yarn npm audit --severity moderate`                 | socket timeout, 61s |
| same, `npmAuditRegistry: https://registry.npmjs.org` | socket timeout, 62s |

The registry is up and the path is routable - the 405 on GET proves the endpoint
is there. It accepts the POST connection and then answers nothing.
`registry.yarnpkg.com` and `registry.npmjs.org` fail alike, and `{}` hangs as
long as this repo's whole tree does, so it is not body size either. No setting
on our side makes that POST return.

`.hyperi-ci.yaml` therefore holds `quality.typescript.audit: warn`. What that
does and does not cost:

- The triaged advisory exclusions in `.yarnrc.yml` are untouched and apply again
  the moment the step runs.
- osv-scanner reads the same `yarn.lock` against osv.dev, which is answering,
  and already reports on every run (66 packages, 127 advisories, non-blocking).
- Dependabot stays enabled and the alerts keep arriving.

Revert to `blocking` as soon as this returns a body instead of hanging:

    curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 45 \
      -X POST -H 'Content-Type: application/json' --data '{}' \
      https://registry.npmjs.org/-/npm/v1/security/advisories/bulk
