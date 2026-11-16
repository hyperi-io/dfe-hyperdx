# Sync track record

Sync cost over time is the evidence the [de-fork decision](leaving-upstream.md)
should be taken against, so each run is recorded here. The procedure is
[sync-cycle.md](sync-cycle.md).

|                        | 2026-07-23 (dry run) | 2026-08-04 (2.29.0 -> 2.33.0, full run) | 2026-09-21 (2.36.0 -> 2.39.1, aborted) | 2026-10-06 (2.36.0 -> 2.40.0, full run) | 2026-11-01 (2.41.0 -> 2.43.0, full run) |
| ---------------------- | -------------------- | --------------------------------------- | -------------------------------------- | --------------------------------------- | --------------------------------------- |
| upstream commits ahead | 122                  | 164                                     | 116                                    | 164                                     | 105                                     |
| conflicting files      | 11                   | 12                                      | 14                                     | 18                                      | 9                                       |
| replayed by rerere     | n/a                  | n/a                                     | **0 of 9**                             | **0 of 13**                             | **0 of 7**                              |
| `yarn.lock` conflicted | yes                  | **no**                                  | no                                     | no                                      | no                                      |
| delta gate             | 81 `src/dfe` tests   | 211 suites / 4795 tests                 | not reached                            | 427 suites / 9159 tests, 5 packages     | 529 suites / 10780 tests, 5 packages    |

What changed between the first two runs is the merge driver and the generated
security layer. The lockfile stopped conflicting outright: the driver took
upstream's copy and `yarn install` re-derived exactly ONE entry, `jose`, our
OIDC dependency.

Of the 12 conflicts, 7 had content, and the other 5 were modify/delete on the
workflows hyperi-ci replaced, whose resolution is to stay deleted. Two are worth
remembering:

- `packages/api/tsconfig.build.json` - our only delta turned out to be
  FORMATTING. The `include` content was upstream's all along. Taking theirs
  wholesale removed the file from the conflict surface entirely.
- `packages/app/src/layout.tsx` - upstream added a kiosk mode that hides the
  nav. Both conditions sit side by side, and that convergence is the first
  evidence for the de-fork path.

## 2026-09-21 - rerere replayed nothing, and the alarm had been off for a month

The 2.39.1 attempt produced 14 conflicts and rerere replayed **none** of them.
It was enabled and configured, and it had 11 recorded resolutions sitting in
`rr-cache`. Every one missed, because a preimage has to match EXACTLY and 116
commits of upstream had moved the context around every hunk.

That is the mechanism worth taking from this row: **rerere's value decays with
backlog.** A resolution recorded against a 20-commit gap is worthless at 116.
The weekly cadence is not a nicety, it is what keeps the preimages matching.

Which is why the alarm mattered. `gh issue create --label 'upstream-sync'` needs
the label to exist and this repo never had one, so the call failed on every
conflicted run and `|| echo "Issue may already exist."` turned the failure into
a success. Five consecutive Mondays reported green, no issue was filed, and the
drift number nobody was reading is the number that decides when re-forking beats
merging.

The step creates the label, tolerates only an already-open issue for the same
ref, and fails the run otherwise.

Of the 14: 5 are modify/delete on the upstream workflows that must stay deleted
(see the 2026-08-27 entry in [security-sync.md](security-sync.md): `release.yml`
would publish to hyperdxio's npm scopes and Docker Hub namespaces), and 9 have
content: `.gitignore`, `.prettierignore`,
`docker/otel-collector/config.standalone.auth.yaml`, `DBChartPage.tsx` (2
hunks), `DBDashboardPage.tsx` (2), `AppNav.tsx`, `SQLInlineEditor.tsx`,
`useRowWhere.tsx` and `scripts/ci/ratchet-baseline.json` (2). Thirteen hunks in
all.

## 2026-10-06 - the merge was the easy part

2.40.0 hit the 2.39.1 attempt's nine content conflicts plus four more:
`package.json`, `packages/api/package.json`, `DBRowJsonViewer.tsx` and
`DashboardsListPage.tsx`, which upstream rewrote with tabs and a header action
group. The other five were the deleted upstream workflows again. `rr-cache` held
25 entries and replayed none of the 13 content conflicts.
`config.standalone.auth.yaml` left the surface, since our only delta was quote
style, and upstream's new `jscpd.yml` joined `.fork-deleted`.

Three breakages got past a merge git called resolved:

- The lockfile. The driver took upstream's, so every security fix main held in
  `yarn.lock` alone went back to upstream's version, Next 16.3.6 to 16.3.4 among
  them. Nothing failed. See [step 5](sync-cycle.md#5-the-lockfile).
- `provisionDashboards/index.ts` merged clean and failed `tsc`: upstream's new
  `STATIC_LIST` filter has no `source` for our reference resolver to read.
- Upstream's new `DashboardsListPage.test.tsx` mounts the page with no
  QueryClient, and both components we inject there query. All 21 of its tests
  failed until they went behind `dfe/QueryClientOnly.tsx`.

## 2026-11-01 - two pins unwound, 120 packages put back

2.43.0 conflicted on seven content files and the deleted `release.yml` and
`vouch.yml`. `rr-cache` held 26 entries and replayed none. Upstream ships next
16.4.2 and undici 7.30.1, so `--check` called both register entries redundant
and they were removed.

The lockfile regressed again, and wider: 120 packages main had moved with
`yarn up -R` came back older, Storybook 10.6.2 to 10.1.4 and tar 7.5.22 to 6.2.1
among them. osv-scanner read 10 unfiltered packages until `yarn up -R` on the
whole list put them back.

Upstream moved the filter-key limit read into `useFilterKeysFetchLimit`, which
our `dfe/__tests__/jsonFilterSidebar.test.tsx` mocks partially, so its suite
failed until the mock gained the new hook.
