# How the fork is held together

Four mechanisms, each answering a different failure. Read the ladder first - it
is the one that changes what you type today.

---

## Three questions, before every change

Before the ladder, before anything:

1. **Do I really need it?**
2. **Can it be smaller and simpler?**
3. **Can it be done with less upstream drift risk?**

The governing goal of this fork is to MINIMISE the file-level variation from
upstream we have to maintain, while still carrying our changes, our
integrations, and the occasional security fix. Every question above serves that
one sentence.

It is pointed at models in particular, because they reliably fail it: given a
small brief they produce a large diff, since a large diff reads as effort. Here
it is not effort. A change touching no upstream file is free; a change touching
an upstream file is a bill paid at every future sync, by whoever runs it.

Applies to removal too. When a sync leaves one of our deltas identical to
upstream again, take it OFF `.fork-surface` - the file is pristine and the entry
now costs a check for nothing.

---

## The cheapest-edit ladder

**Before changing an upstream file, stop at the first option that fits.**

This is the single highest-leverage habit in the repo, and the one every model
gets wrong by default: the instinct is to open the upstream file and rewrite the
function body. That works, passes tests, and costs a hand-resolve on every sync
forever.

```mermaid
flowchart TB
    start(["a change is needed"]) --> q1{"can it live<br/>under dfe/ ?"}
    q1 -->|yes| a1["put it there<br/>COSTS NOTHING"]
    q1 -->|no| q2{"can the upstream file<br/>change by ONE TOKEN?"}
    q2 -->|yes| a2["logic in dfe/, same signature,<br/>swap the identifier at the call site"]
    q2 -->|no| q3{"can it be an ADDITION<br/>next to a brace?"}
    q3 -->|yes| a3["append an else-if<br/>merges cleanly far more often"]
    q3 -->|no| a4["edit in place,<br/>and CATALOGUE it"]

    classDef free fill:#009E73,stroke:#005f45,color:#ffffff
    classDef cheap fill:#F0E442,stroke:#8a8200,color:#000000
    classDef costly fill:#D55E00,stroke:#7a3500,color:#ffffff
    classDef ask fill:#0072B2,stroke:#00456b,color:#ffffff
    class a1 free
    class a2,a3 cheap
    class a4 costly
    class q1,q2,q3 ask
```

Rule 2 is the one worth internalising. Give your function the SAME SIGNATURE as
upstream's and swap the identifier at the call site: `foo(a, b, c)` becomes
`dfeFoo(a, b, c)`. The argument list stays byte-identical, so if upstream later
changes those arguments the conflict is trivial instead of structural.

### It is worth real money

A native-ClickHouse-JSON fix was first written the obvious way: rewrite
`buildJSONExtractQuery`'s body in `DBRowJsonViewer.tsx` and edit upstream's test
expectations. That is 53 insertions across the two files upstream churns hardest
in that area.

Redone as rule 2 (four call sites differing by one identifier) plus rule 3
(three `else if (isJsonColumn)` additions reusing upstream's own predicate):
**15 insertions**, `buildJSONExtractQuery` left byte-pristine, and the test file
back to pristine and off the catalogue entirely.

Same feature. A quarter of the standing cost, forever.

---

## Two lifetimes, two mechanisms

Everything in this fork is one of two things, and almost every mistake here
comes from treating them the same way.

| content                  | lifetime  | mechanism                                                   | conflict surface          |
| ------------------------ | --------- | ----------------------------------------------------------- | ------------------------- |
| our features + additions | PERMANENT | merged history, `dfe/` dirs, rerere, `.fork-surface`        | real, managed, catalogued |
| security dependency pins | TEMPORARY | generated into `resolutions` from `security/overrides.yaml` | none                      |
| security code fixes      | TEMPORARY | `security/patches/*.patch`, applied on top                  | none                      |

The permanent half is what rerere is for. The temporary half is what rerere
CANNOT do, and asking it to is the trap:

- Upstream uses `resolutions` for its OWN security pins - fourteen of them as of
  2.33.0, five of which moved between 2.29.0 and 2.33.0. Anything we add there
  lands in a block whose contents change every cycle, so a recorded conflict
  preimage never matches twice and rerere accumulates one-shot resolutions that
  never replay.
- `yarn.lock` is a megabyte of generated text. "Replay these hunks" is not a
  meaningful answer for a lockfile; "take upstream's and regenerate" is the only
  correct one, every time.

So the temporary layer is GENERATED, never merged - stripped before an upstream
merge and rebuilt after. That is what makes "undo our security fixes and try
again" a command rather than an afternoon. The procedure is
[sync-cycle.md](sync-cycle.md).

---

## The security posture is INVERTED here

The house standard is scanners-on, dependencies-current. In this repo that is
backwards, deliberately: **off by default, on only for what WE added.**

- `renovate.json` disables every manager and re-enables exactly one thing: the
  SHA-pinned actions in the workflows we own. Upstream's workflows are excluded
  BY NAME so a sync that adds one does not silently opt it in.
- CodeQL and GitHub code security are OFF, as are Dependabot's automatic fix
  PRs.
- Dependabot vulnerability ALERTS stay ON - they are the input to
  `scripts/security-triage.py`.
- gitleaks stays ON and blocking. It scans OUR commits for OUR secrets and has
  nothing to do with upstream's dependency tree.

**Why.** We do not own upstream's dependency tree. Patching a vendored dep
diverges us for a fix we did not write, converts a pristine file into permanent
rerere conflict surface, and gets re-conflicted on the next sync regardless.
Upstream patches upstream; we get it when we sync. And an alert queue full of
items nobody can action trains everyone to ignore the queue, including the one
that matters.

**What this does NOT mean.** Muting per-PR noise does not make an inherited CVE
unreal - the fork ships as a container image and those CVEs ship with it. The
image scan at publish still applies, and a critical finding there is an argument
for **syncing upstream now**, not for hand-patching a dependency we do not own.

### The exception: a reachable HIGH or CRITICAL

We do patch, but only when BOTH hold:

1. severity is **high or critical**, AND
2. there is a **real vector** - the vulnerable path is actually reachable in how
   DFE runs this fork.

Point 2 is the one that gets skipped, and it is the one that matters. Most
advisories against a transitive dependency are unreachable here: the package is
present but the vulnerable function is never imported, or it is only reachable
from a path we do not ship. **"npm audit says high" is not a vector.** If you
cannot write down how an attacker gets there, there is nothing to patch.

### Code scanning: keep it all, sort it by who wrote the line

The muting above is the DEPENDENCY axis, where authorship is not a useful
question - the whole tree is upstream's regardless of who pulled a package in.

Code findings are different: they carry a file and a line, so they can be
attributed. `fork-security.yml` scans the whole tree and sorts the results:

- **OURS** - a line we added or changed versus the merge base. **Gates the
  build.**
- **ACCEPTED** - ours, reviewed, listed in `security/accepted.yaml` with a
  reason. Suppressed from the gate but PRINTED every run, because a suppression
  that has become wrong should be visible.
- **INHERITED** - upstream's lines. Reported, never gates.

Measured on a real run: 108 findings, 0 ours, 5 accepted, 103 inherited. Gating
on 108 is unworkable; muting 108 loses the ones that matter. Sorting is the only
answer that keeps both.

Attribution is `scripts/attribute-findings.py`, SARIF in, so it serves semgrep
and CodeQL alike. It compares **line content against the merge base**: a line we
added or changed is ours. That needs no catalogue and works even on an upstream
file nobody remembered to list.

---

## The squashed import, and the graft that repairs it

`e58f01d3 "Initial HyperDX commit"` is a FLATTENED copy of upstream, not a
continuation of their history, so git had no path from our tree back to theirs.
That broke two things: `git blame` attributed every upstream line to whoever ran
the import, and ancestry could not tell upstream code from ours.

The import was taken from upstream `fbeaf152`, and `scripts/fork-setup.sh`
reconnects them:

```bash
git replace --graft e58f01d3f4ede7b691ee4cf2873ad8548d93f210 fbeaf152...
```

**Non-destructive.** No object is rewritten and no SHA changes; `git replace -d`
undoes it. The merge base is unchanged, so the sync workflow, the drift report
and the attribution script all behave identically - blame and `git log` simply
stop lying.

It is per-clone config, applied by `fork-setup.sh` from the two recorded SHAs,
rather than a `refs/replace/*` ref that no clone fetches by default.

**What breaks it:** reformatting an upstream file rewrites every line into the
diff, so the whole file reads as ours and the signal is gone. That is a second,
independent reason for the no-bulk-reformat rule.

---

## Never put our assertions in an upstream test file

Upstream test files gain cases constantly and upstream has no stake in ours, so
a delta there is the most expensive kind for the least return. Ours live in a
`dfe/__tests__/` directory.

`.githooks/fork-surface-check.py --audit` lists the catalogued test files still
to migrate.
