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
dependencies get deleted before the final stage. The frontend goes in as a
built Next bundle.

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

Write down the path. If you cannot write it down, it is not a vector.
"npm audit says high" is not a vector.

---

## 2026-08-26 - first full pass

99 open alerts. 2 critical, 58 high, 35 moderate, 4 low. Nobody had been
through them, and the audit gate in `.hyperi-ci.yaml` was set to `warn`, so
none of them had ever failed a build.

### The one number that mattered

Full install is 2691 packages. The api production closure is **331**.

Of the 38 packages carrying alerts, **15** are in the image:

ajv, bn.js, cross-spawn, fast-uri, fast-xml-parser, hono, ip-address, lodash,
path-to-regexp, picomatch, protobufjs, qs, semver, systeminformation, uuid

The other 23 are not. That kills most of the backlog in one go, including the
biggest clusters - tar (12 alerts), minimatch (9), js-yaml (4), postcss (4),
nanoid (3).

### tar - both criticals were not what they looked like

**#213, GHSA-23hp-3jrh-7fpw, critical.** Vulnerable `<= 7.5.18`, we have 6.2.1,
so in range. GitHub says `scope: runtime`.

It is not runtime. `yarn why tar` gives `cacache` and `node-gyp`, and
`node-gyp` only comes in through `evp_bytestokey` and `fsevents`. That is
install-time native-build tooling. It is gone by the time the image is built,
and it is absent from the 331.

Twelve tar alerts, all the same story.

### protobufjs - the one critical that IS real

**#97, GHSA-xq3m-2v4x-88gg, critical.** Vulnerable `< 7.5.5` and
`>= 8.0.0, < 8.0.1`.

Four copies in the tree, and only one is in range:

| Pulled by | Version | In range |
|---|---|---|
| `@hyperdx/api`, declared directly | 7.6.5 | no |
| `@grpc/proto-loader` | 7.6.2 | no |
| `@opentelemetry/otlp-transformer` | 7.5.8 | no |
| `@hyperdx/browser` -> `@hyperdx/otel-web-session-recorder@0.16.2` | **6.11.4** | **yes** |

`@hyperdx/browser` is imported at `DBSearchPage.tsx:28`, `AppNav.tsx` and
`AppNavFeedback.tsx`, so the old copy goes into the frontend bundle.

The wart: the vulnerable copy is a transitive of a HyperDX package we do not
control, so there is nothing to bump directly. It needs a `resolutions` entry
raising protobufjs across the tree, and then someone has to confirm the session
recorder still works.

The other half of the story: protobufjs there is serialising OTLP telemetry
against a fixed compiled schema. No attacker-supplied `.proto` reaches the
parser. So it is critical and reachable and the vector is still weak. Worth
pinning because the cost is near zero, not because anyone is getting code
execution out of it.

### systeminformation - pinned, and the tool then called it redundant

**#199 and #150, both high, command injection in `networkInterfaces()`.**

This one is genuinely reached. `packages/api/src/index.ts` instantiates
`@opentelemetry/host-metrics`, which requires `systeminformation/lib/network`
(`si.js:22`) and calls `networkStats()` on the metrics timer.
`networkStats()` calls `networkInterfaces()` at `network.js:1302` and `:1518`.

Where it stops: the source is host-local, not remote. Both advisories need the
attacker to already control host network config - a NetworkManager profile
name, or a `source` directive in `/etc/network/interfaces`. In a container
that is root-equivalent already. So it is privilege-escalation shaped, and it
does not clear the bar outright.

Pinned anyway at `^5.31.7`, because upstream already carries systeminformation
in `resolutions`, so we raise an existing key instead of adding conflict
surface. Lockfile moved 5.30.7 -> 5.33.1.

**The wart, and it will bite again.** Straight after applying it,
`scripts/security-override.py --check` reported the pin REDUNDANT and told us
to delete it. It compares our floor against the lockfile resolution that OUR
OWN PIN just produced, so it cannot tell an upstream fix from ours. `--verify`
is the one CI gates on and it is correct. Do not act on `--check` calling a
fresh pin redundant.

### ip-address - the only genuinely remote one, already closed

**#248, high, SSRF via leading-zero octets read as decimal.**

Lands exactly on `packages/api/src/utils/validators.ts:34` `isPrivateIp()`,
which is the SSRF guard for user-supplied webhook URLs. That is the one
unauthenticated remote vector in the whole set.

Already fixed: `packages/api/package.json:48` declares `ip-address ^10.3.1`
and the lock resolves 10.3.1, above the `<= 10.3.0` range. The still-vulnerable
10.1.0 and 9.0.5 copies sit under `socks-proxy-agent` and are never reached
from `isPrivateIp`.

**Re-check this one every sync.** If a merge ever drags that declaration back
below 10.3.1 it becomes a real remote SSRF immediately.

### Tooling warts found on the way

- **`hyperi-ci deps drift` never read `yarn.lock`.** It looked for
  `package-lock.json` only, so it compared nothing and reported clean - on this
  repo and on dfe-ui. Fixed in hyperi-ci 2.9.23. First honest run here: 12
  floors a whole major behind the lock, including `zod` declared `3.25` against
  `4.4.3` locked, in four packages.
- **husky is not installed on a fresh clone**, so `lint-staged` never runs and
  formatting errors reach the commit. `yarn setup` fixes it. Worth checking
  after any host move.
- **Renovate's blanket-disable pattern is broken upstream.**
  `matchFileNames: ['**'], enabled: false` plus `vulnerabilityAlerts` is the
  obvious way to say "security only", and Renovate 43.113.0 added a filter that
  drops those deps anyway - security PRs get autoclosed and no new ones appear
  (renovatebot/renovate#42655, closed as not planned). We scope by
  `includePaths` instead so there is no disabled dep to mis-filter.

### Still open

- The ~50 alerts on packages absent from the image are cleared by question 1
  but not yet dismissed on GitHub. Each needs the trace pasted into its
  dismissal so this does not get redone.
- protobufjs `resolutions` pin not applied - it changes the frontend bundle and
  wants a browser check first.
- Repo settings are still off: secret scanning, push protection, code scanning.
  hyperi-ci has the first two on and CodeQL via default setup. Human-only to
  change.
- `.hyperi-ci.yaml` still has `quality.typescript.audit: warn`. It goes back to
  `blocking` LAST, once the backlog is cleared - flipping it first just turns
  the build red and teaches everyone to bypass the gate.
