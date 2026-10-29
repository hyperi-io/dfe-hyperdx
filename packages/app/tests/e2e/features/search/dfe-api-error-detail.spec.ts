/**
 * A saved-search save the API refuses with a 4xx shows the API's reason.
 *
 * The UI form rejects a blank name itself, so the 400 is the API's own answer
 * to a whitespace-only name, captured from the real server and replayed to the
 * page for the save the user submits. Before the fix the toast said "An error
 * occurred while saving your search" and the reason never reached the user.
 *
 * See docs/fork/what-we-changed.md (apiErrorDetail).
 */
import { SearchPage } from '../../page-objects/SearchPage';
import { getApiUrl } from '../../utils/api-helpers';
import { expect, test } from '../../utils/base-test';

test.describe(
  'A 4xx on a save shows its reason',
  { tag: '@full-stack' },
  () => {
    test('saved-search create surfaces the API validation detail', async ({
      page,
    }) => {
      test.skip(
        process.env.E2E_FULLSTACK !== 'true',
        'needs the real API for the 400 body',
      );

      const searchPage = new SearchPage(page);
      await searchPage.goto();

      const refused = await page.request.post(`${getApiUrl()}/saved-search`, {
        data: {
          name: '   ',
          select: '',
          where: '',
          whereLanguage: 'lucene',
          source: '000000000000000000000000',
          tags: [],
        },
      });
      expect(refused.status()).toBe(400);
      const body = await refused.text();
      const reason = body.match(/"message":"([^"]+)"/)?.[1];
      expect(reason).toBeTruthy();

      await page.route('**/api/saved-search', route =>
        route.request().method() === 'POST'
          ? route.fulfill({
              status: 400,
              contentType: 'application/json',
              body,
            })
          : route.continue(),
      );

      await searchPage.openSaveSearchModal();
      await searchPage.savedSearchModal.fillName('A search the API refuses');
      await searchPage.savedSearchModal.submit();

      const toast = page.locator('.mantine-Notification-root');
      await expect(toast).toContainText(reason!);
      await expect(toast).not.toContainText('An error occurred while saving');
    });
  },
);
