/**
 * Fork-local coverage for the DFE embed gating.
 *
 * WHY this exists: `git rerere` replays a recorded conflict resolution
 * TEXTUALLY. An upstream sync can therefore apply cleanly and still leave a DFE
 * delta subtly wrong - nothing in the merge machinery understands intent. These
 * tests are the behavioural gate that does.
 *
 * The gating claim being defended: a disabled feature is not merely hidden from
 * the nav, it is UNREACHABLE by direct URL.
 */
import {
  DFE_BLOCKED_ROUTE_PREFIXES,
  DFE_EMBED_FEATURES,
  isBlockedRoute,
  isEmbedChrome,
  isEmbedFeatureEnabled,
} from '@/dfe/embedFeatures';

describe('DFE embed feature allowlist', () => {
  it('enables exactly the four shipped features', () => {
    expect([...DFE_EMBED_FEATURES].sort()).toEqual([
      'chart',
      'dashboards',
      'saved-searches',
      'search',
    ]);
  });

  it.each(['search', 'saved-searches', 'chart', 'dashboards'])(
    'enables %s',
    id => {
      expect(isEmbedFeatureEnabled(id)).toBe(true);
    },
  );

  it.each(['alerts', 'sessions', 'service-map', 'team', 'unknown-feature'])(
    'disables %s',
    id => {
      expect(isEmbedFeatureEnabled(id)).toBe(false);
    },
  );

  it('keeps the blocked route prefixes aligned with the disabled features', () => {
    expect([...DFE_BLOCKED_ROUTE_PREFIXES].sort()).toEqual([
      '/alerts',
      '/service-map',
      '/sessions',
      '/team',
    ]);
  });
});

describe('isBlockedRoute', () => {
  it.each([
    '/alerts',
    '/alerts/123',
    '/sessions',
    '/sessions/abc/def',
    '/service-map',
    '/team',
    '/team/settings',
  ])('blocks %s', path => {
    expect(isBlockedRoute(path)).toBe(true);
  });

  it.each(['/search', '/dashboards', '/chart', '/'])('allows %s', path => {
    expect(isBlockedRoute(path)).toBe(false);
  });

  // The guard matches on a path SEGMENT, not a bare string prefix. Were it the
  // latter, an unrelated future route starting with a blocked word would be
  // redirected to /search with no obvious cause.
  it.each(['/teams', '/team-invites', '/alertsomething', '/sessionsx'])(
    'does not block the unrelated route %s',
    path => {
      expect(isBlockedRoute(path)).toBe(false);
    },
  );
});

describe('isEmbedChrome', () => {
  const setSearch = (search: string) => {
    window.history.replaceState({}, '', `/search${search}`);
  };

  beforeEach(() => {
    window.sessionStorage.clear();
    setSearch('');
  });

  it('is false for standalone access', () => {
    expect(isEmbedChrome()).toBe(false);
  });

  it('is true when ?embed=1 is present', () => {
    setSearch('?embed=1');
    expect(isEmbedChrome()).toBe(true);
  });

  it('persists across internal navigation once the flag is seen', () => {
    setSearch('?embed=1');
    expect(isEmbedChrome()).toBe(true);

    // hyperdx navigates internally and drops the query string; the embed must
    // stay chromeless or a second nav appears inside the iframe.
    setSearch('');
    expect(isEmbedChrome()).toBe(true);
  });

  it('ignores any value other than 1', () => {
    setSearch('?embed=0');
    expect(isEmbedChrome()).toBe(false);
    expect(window.sessionStorage.getItem('dfeEmbed')).toBeNull();
  });

  it('reports standalone when sessionStorage is unavailable', () => {
    const spy = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked by browser');
      });

    expect(isEmbedChrome()).toBe(false);

    spy.mockRestore();
  });
});
