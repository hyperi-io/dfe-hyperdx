# The fork

`dfe-hyperdx` is a long-lived fork of
[hyperdxio/hyperdx](https://github.com/hyperdxio/hyperdx). We merge upstream
repeatedly, forever, and everything in these docs exists to keep that cheap.

**The governing rule: minimise what we change in anything that comes from
upstream.** Every edit to a pristine upstream file becomes permanent
merge-conflict surface. Getting it wrong does not fail loudly. It
makes every future sync more expensive, and the bill arrives months later for
whoever runs one.

| You want to | Read |
| --- | --- |
| Know what we changed and why | [what-we-changed.md](what-we-changed.md) |
| Understand how the fork is held together | [design.md](design.md) |
| Run an upstream sync | [sync-cycle.md](sync-cycle.md) |
| See what each sync cost | [sync-track-record.md](sync-track-record.md) |
| Know how this ends | [leaving-upstream.md](leaving-upstream.md) |
| Make a change without adding conflict surface | [working-guide.md](working-guide.md) |

---

## What we own, in one diagram

Every upstream merge takes four kinds of content, and the catalogued in-place
edits are the only kind that can conflict.

```mermaid
flowchart LR
    accTitle: L4 Detail -- What an upstream merge takes
    accDescr: Our dfe directories never conflict, catalogued in-place edits conflict and rerere replays them, the security layer is stripped before the merge and rebuilt after, and the rest of the tree is taken whole from upstream. The build and tests after the merge are the proof.

    subgraph ours["What we own"]
        dfedir["packages/**/dfe/**"]
        inplace["In-place edits<br/>.fork-surface"]
        temp["security/overrides.yaml<br/>security/patches/"]
    end

    rest["Upstream's tree"]
    merge["Upstream<br/>merge"]
    gate(["Build and test"])

    dfedir -->|never conflicts| merge
    inplace -->|rerere replays| merge
    temp -->|stripped first| merge
    rest -->|taken whole| merge
    merge --> gate

    classDef default fill:#F8FAFC,stroke:#64748B,stroke-width:1px,color:#0F172A
    classDef error fill:#FBE3D6,stroke:#C2410C,stroke-width:1px,color:#4A1A05
    classDef ext fill:#EEF0F2,stroke:#6B7280,stroke-width:1px,stroke-dasharray:4 3,color:#1F2937
    classDef group fill:none,stroke:#64748B,stroke-width:1px,stroke-dasharray:2 4
    class inplace error
    class rest ext
    class ours group
```

*Figure 1. L4 Detail -- What an upstream merge takes. The orange box is the one that costs us on a sync.* Up: [dfe-hyperdx documentation](../README.md).

Keeping that box small is the whole game, and [design.md](design.md) is how.

The five rules that follow from it:

1. New code goes under a `dfe/` directory. Those paths do not exist upstream,
   so they have zero conflict risk. This is the default.
2. Editing an upstream file in place is an EXCEPTION. It must be identified,
   documented in [what-we-changed.md](what-we-changed.md), and listed in
   `.fork-surface` so the guard passes.
3. Never bulk-reformat an upstream file. A repo-wide formatter rewrites lines
   we do not own, which destroys rerere's ability to replay and makes every
   later sync a fresh hand-resolve.
4. Never merge upstream onto `main` by hand. The sync workflow does it on a bot
   branch and opens a PR.
5. All our work happens in the fork. Features, fixes and security fixes land
   here, and raising them upstream is not part of the process. When
   upstream fixes something we hold, `--check`, `--apply` and `--drift` say so
   and we delete our copy. The long-term plan is in
   [leaving-upstream.md](leaving-upstream.md).

Our files follow HyperI documentation standards. Upstream's files, docs
included, are left as upstream ships them unless `.fork-surface` lists a delta:
`agent_docs/`, `AGENTS.md` and the rest are theirs, and adding our conventions
to them would be conflict surface bought for nothing.

---

## The tooling

Run `fork-setup.sh` once per clone. Rerere, the conflict-surface hook and the
lockfile merge driver are all per-clone git config, and a fresh clone starts unprotected:

```bash
./scripts/fork-setup.sh
```

| Command | Answers |
| --- | --- |
| `.githooks/fork-surface-check.py --drift` | Has upstream touched anything we hold a delta in? |
| `.githooks/fork-surface-check.py --audit` | What is catalogued that should not be? |
| `scripts/security-override.py --verify` | Does the tree match the security register? |
| `scripts/upstream-pin.py --show` | Which upstream are we built on? |
| `scripts/security-triage.py --audit` | What is newly vulnerable, and is it reachable? |

`--drift` is the one to run before starting work. It is the cheap moment to
shrink a delta, long before a merge turns it into a conflict.
