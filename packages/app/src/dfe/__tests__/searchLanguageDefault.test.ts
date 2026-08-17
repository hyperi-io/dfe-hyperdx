/**
 * DFE search-language default: SQL, not upstream's Lucene.
 *
 * getStoredLanguage() is the one seam every search surface consults, so
 * pinning it here pins the default for the search page, dashboards, chart
 * editor and side panels at once. An explicit user selection (either
 * language) still wins.
 */
import { getStoredLanguage } from '@/components/SearchInput/SearchWhereInput';

const STORAGE_KEY = 'hdx-search-where-language';

describe('getStoredLanguage (DFE default)', () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it('defaults to sql when no preference is stored', () => {
    expect(getStoredLanguage()).toBe('sql');
  });

  it('returns the stored preference when the user chose lucene', () => {
    window.localStorage.setItem(STORAGE_KEY, 'lucene');
    expect(getStoredLanguage()).toBe('lucene');
  });

  it('falls back to sql on an unrecognised stored value', () => {
    window.localStorage.setItem(STORAGE_KEY, 'kusto');
    expect(getStoredLanguage()).toBe('sql');
  });
});
