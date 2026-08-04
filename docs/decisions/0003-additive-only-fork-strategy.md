# Additive-only fork strategy

A realistic assessment of where the additive-only principle holds, where it gets
difficult, and what the actual upstream merge cost looks like.

### Per-Work-Stream Breakdown

#### FerretDB: Fully Additive

Zero upstream application files modified. The only changes are to Docker Compose
(infrastructure we own) and the `MONGO_URI` environment variable value.

Prior art:
[FerretDB published a guide](https://blog.ferretdb.io/full-stack-observability-hyperdx-ferretdb/)
in July 2025 confirming HyperDX works with FerretDB as a drop-in MongoDB
replacement, with zero compatibility issues reported.

**Upstream merge cost: zero.**

#### OIDC Identity Middleware: Effectively Additive

All DFE logic lives in new files under `packages/api/src/dfe/`. The only
upstream file touched is `api-app.ts` with a single conditional block appended
to the end of the middleware stack.

The OIDC middleware **wraps** existing auth - it populates `req.user` the same
way Passport does, so the existing `isUserAuthenticated` middleware passes
through without modification. The `middleware/auth.ts` file is never touched.

**Upstream merge cost: trivial.** The conditional block in `api-app.ts` is at
the end of the file. Upstream changes to the middleware stack above it merge
cleanly. Only a major restructuring of `api-app.ts` (rare) would require a
manual rebase of the block.

#### Casbin RBAC: Fully Additive

All new files. The enforcement middleware is injected via the same conditional
block in `api-app.ts`. No router files are modified - the authorization check
runs globally before any route handler.

**Upstream merge cost: zero** for Casbin itself. When upstream adds new route
prefixes, the route-to-resource mapping in `dfe/middleware/casbin-authz.ts`
needs updating - but that's our file, not an upstream conflict.

#### Multi-Tenancy: Additive With a Caveat

The current `getTeam()` does `Team.findOne({})` - returns the only team. We do
**not** modify this function. Instead:

- Our OIDC middleware resolves the correct team and sets `req.user.team`
- All route handlers already read `req.user.team` via `getNonNullUserWithTeam()`
- For DFE-specific code, we use our own `dfe/controllers/team-provisioning.ts`
  which queries `Team.findOne({ _id: teamId })` - a new function, not a
  modification

**The risk:** If upstream adds a new controller that calls `getTeam()` directly
(no team ID filter), it returns data from an arbitrary team. This is mitigated
by Casbin enforcement upstream of the route handler - you can't reach the
handler without passing RBAC. But it's defense-in-depth, not a guarantee.

**What to do on each upstream merge:** grep for new calls to `getTeam()` in
upstream changes. If any appear in routes accessible through the DFE flow,
assess whether they need team scoping. This is a review-on-merge checklist item.

**Upstream merge cost: zero code conflicts, but requires review of new
`getTeam()` calls.**

#### Alerting: Fully Additive (Disabled, Not Removed)

The `checkAlerts` task is not started. Casbin blocks the `/alerts` and
`/webhooks` routes. No upstream code is modified or deleted.

**Upstream merge cost: zero.** Upstream can add alert features freely - the code
merges in, it just never runs.

#### Frontend: Zero to Minimal Changes

Three scenarios and how they play out with zero frontend modifications:

1. **Login/register pages** - Envoy intercepts unauthenticated requests before
   they reach HyperDX and redirects to the OIDC provider. The login page is
   never served. No change needed.

2. **401 handling** - the frontend's `ky` client redirects to `/login` on 401.
   Envoy intercepts that `/login` request and starts the OIDC flow. Extra
   redirect hop but functionally correct. No change needed.

3. **Invite UI on TeamPage** - still shows "Invite Member" buttons. These are
   harmless in OIDC mode (invite tokens don't work for OIDC-provisioned users).
   Confusing but not broken. No change needed unless UI polish is desired.

**If UI polish is desired** (hiding invite buttons, showing role info), that
requires 1-2 small conditionals in upstream frontend files (`TeamPage.tsx`,
possibly `AuthPage.tsx`). These are in rendering logic, not structural code, so
upstream conflicts are unlikely but possible.

**Upstream merge cost: zero if we accept the cosmetic quirks. Trivial if we add
1-2 conditionals.**

### Honest Summary

| Work Stream       | Files modified in upstream | Truly additive?          | Merge cost per release          |
| ----------------- | -------------------------- | ------------------------ | ------------------------------- |
| FerretDB          | 0                          | Yes                      | Zero                            |
| OIDC middleware   | 1 (`api-app.ts`)           | Effectively yes          | Trivial (one delimited block)   |
| Casbin RBAC       | 0                          | Yes                      | Zero (review new routes)        |
| Multi-tenancy     | 0                          | Yes (with review caveat) | Zero (review `getTeam()` calls) |
| Alerting disabled | 0                          | Yes                      | Zero                            |
| Frontend          | 0-2 (optional cosmetics)   | Mostly                   | Zero to trivial                 |

**Realistic worst case per upstream merge:**

- `api-app.ts` conditional block: rebase if upstream restructures middleware
  stack (~1 per year frequency based on commit history)
- New route prefixes: update Casbin mapping in our `dfe/` code (no conflict)
- New `getTeam()` calls: review for multi-tenancy safety (no conflict)
- Frontend conditionals (if added): re-apply if upstream redesigns the page
  (infrequent)

**Total upstream files modified: 1** (`api-app.ts`), optionally **1-2** frontend
files for cosmetics.

**Total new files: ~8-10** in `packages/api/src/dfe/` plus Casbin model conf.
