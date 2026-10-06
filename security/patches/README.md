# Security patches - the TEMPORARY code layer

A `*.patch` here is a small security fix to an upstream source file that we are
carrying **until upstream ships their own**. It is applied on top of the tree,
reverted before every upstream merge, and re-applied after.

## Why these are not just commits

Committing the fix into the upstream file would put a delta we EXPECT to delete
within weeks onto the permanent conflict surface: catalogued in `.fork-surface`
next to deltas we intend to keep forever, re-conflicted on every sync, and
hand-reverted when upstream fixes it their own way. That last step is the
expensive one, and it is exactly what this layer removes.

Our PERMANENT changes are different and do belong in merged history - see
docs/fork/what-we-changed.md. The test is lifetime, not size: if we would keep it after upstream
fixed the vulnerability, it is not a security patch, it is a fork delta.

## The bar

The same one as `security/overrides.yaml`: HIGH or CRITICAL, with a real vector
in how DFE runs this fork. Reachability is a human judgement.
`scripts/security-triage.py` drafts a verdict; it does not make one.

## Naming

    NNNN-<slug>.patch

The numeric prefix is the apply order and reverses for unapply, so it is
load-bearing. Add a header comment to each patch recording the advisory, the vector, and the upstream issue or release that tracks the fix (or `none`) - the same fields the register carries. We do not raise the fix upstream: the patch is ours, and `--apply` reports it stale once upstream fixes the code on its own.

## Making one

    # fix the file in your working tree, then:
    git diff -- <the file> > security/patches/0001-<slug>.patch
    git checkout -- <the file>
    scripts/security-override.py --apply

## The lifecycle

    scripts/security-override.py --verify    # all patches applied?
    scripts/security-override.py --unapply   # before an upstream merge
    scripts/security-override.py --apply     # after one

A patch that will not apply after a merge is the SIGNAL the cycle exists to
produce: either upstream fixed it (delete the patch) or the code moved and the
fix needs re-deriving. `scripts/security-triage.py --patches` drafts which.

An empty directory is the goal state.
