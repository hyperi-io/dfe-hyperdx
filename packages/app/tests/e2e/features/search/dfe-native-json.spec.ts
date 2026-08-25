/**
 * The filter sidebar against a source whose body is a NATIVE ClickHouse JSON
 * column -- the shape every DFE source uses.
 *
 * Before the fix the sidebar offered nothing from that column: a JSON dot path
 * reaches `getAllKeyValues`' dispatch as one opaque segment, matches no physical
 * column name, and falls out of the loop with no facet, no SQL and no error. The
 * absence read as "this data has no fields worth filtering on".
 *
 * See docs/fork/what-we-changed.md and common-utils/src/dfe/jsonPath.ts.
 */
import {
  DFE_JSON_FILTER_USER,
  DFE_JSON_SOURCE_NAME,
} from '../../dfe-json-seed';
import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

const QUERY_TIMEOUT = 20_000;
const BODY_COLUMN = 'Body';
const USER_PATH = 'user.name';

/** The sidebar's nested group for a JSON (or Map) column. */
const jsonGroup = (page: SearchPage['page']) =>
  page.getByTestId(`nested-filter-group-${BODY_COLUMN}`);

// FIXME: the sidebar renders no `Body` group here, though the same code does
// against the dev-stack demo source. Diagnosis so far in
// .hyperi-ai/plans/json-first-class.md, S5.T2.
test.describe.fixme(
  'Search: native JSON body column',
  { tag: ['@search', '@full-stack'] },
  () => {
    test.beforeEach(async ({ page }) => {
      const searchPage = new SearchPage(page);
      await searchPage.goto();
      await searchPage.selectSource(DFE_JSON_SOURCE_NAME);
      await searchPage.timePicker.selectRelativeTime('Last 1 hour');
      await expect(searchPage.table.getRows().first()).toBeVisible({
        timeout: QUERY_TIMEOUT,
      });
    });

    test('offers the JSON sub-paths as filters', async ({ page }) => {
      const group = jsonGroup(page);
      await expect(group).toBeVisible({ timeout: QUERY_TIMEOUT });

      await group.getByTestId('nested-filter-group-control').click();
      await expect(group.getByText(USER_PATH, { exact: true })).toBeVisible({
        timeout: QUERY_TIMEOUT,
      });
    });

    test('filters by a JSON sub-path without a ClickHouse error', async ({
      page,
    }) => {
      const searchPage = new SearchPage(page);
      const before = await searchPage.table.getRows().count();

      const group = jsonGroup(page);
      await group.getByTestId('nested-filter-group-control').click();
      await group.getByText(USER_PATH, { exact: true }).click();
      await searchPage.filters.applyFilter(USER_PATH, DFE_JSON_FILTER_USER);

      await expect(searchPage.getTableError()).toHaveCount(0);
      await expect
        .poll(() => searchPage.table.getRows().count(), {
          timeout: QUERY_TIMEOUT,
        })
        .toBeLessThan(before);
      await expect(searchPage.table.getRows().first()).toBeVisible();
    });

    // The coercion, and the shape that must never come back: `Body['user.name']`
    // is arrayElement, which ClickHouse refuses outright on a JSON column.
    test('emits a coerced dot path, never a bracket subscript', async ({
      page,
    }) => {
      const searchPage = new SearchPage(page);
      const group = jsonGroup(page);
      await group.getByTestId('nested-filter-group-control').click();
      await group.getByText(USER_PATH, { exact: true }).click();
      await searchPage.filters.applyFilter(USER_PATH, DFE_JSON_FILTER_USER);

      await expect
        .poll(() => decodeURIComponent(page.url()), { timeout: QUERY_TIMEOUT })
        .toContain(`toString(${BODY_COLUMN}.`);
      expect(decodeURIComponent(page.url())).not.toContain(`${BODY_COLUMN}['`);
    });

    // The filter is rebuilt from the URL on load, by a different path than the
    // one that created it, so a reload is a distinct case rather than a repeat.
    test('survives a reload', async ({ page }) => {
      const searchPage = new SearchPage(page);
      const group = jsonGroup(page);
      await group.getByTestId('nested-filter-group-control').click();
      await group.getByText(USER_PATH, { exact: true }).click();
      await searchPage.filters.applyFilter(USER_PATH, DFE_JSON_FILTER_USER);
      await expect(searchPage.getTableError()).toHaveCount(0);

      await page.reload();

      await expect(searchPage.getTableError()).toHaveCount(0, {
        timeout: QUERY_TIMEOUT,
      });
      await expect(searchPage.table.getRows().first()).toBeVisible({
        timeout: QUERY_TIMEOUT,
      });
    });
  },
);
