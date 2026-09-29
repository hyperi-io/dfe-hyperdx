/**
 * The engine's session decision, and the cache in front of it.
 *
 * The invariants: the team comes only from the groups the engine answers with,
 * chosen the same way whatever order they arrive in; anything short of a
 * readable engine answer refuses; and a cached answer never outlives its token
 * or CACHE_TTL_MS, never grows past its bound, and is never a guess.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * Reading jest.Mock off a mocked module or global asserts a narrower type than
 * the real one; scoped here rather than relaxed in upstream's eslint config.
 */

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('@/dfe/controllers/org-connection', () => ({
  engineOrigin: jest.fn(() => 'http://engine.test:8000'),
}));

import {
  clearEngineSessionCache,
  resolveEngineSession,
} from '@/dfe/controllers/engine-session';
import { engineOrigin } from '@/dfe/controllers/org-connection';
import logger from '@/utils/logger';

const NOW = 1_800_000_000_000;
const TTL_MS = 30_000;
const FAR = NOW + 3_600_000;

const mockFetch = () => global.fetch as jest.Mock;

const answer = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const grants = (groups: string[]) =>
  mockFetch().mockResolvedValueOnce(answer({ groups }));

let clock: jest.SpyInstance<number, []>;

beforeEach(() => {
  jest.clearAllMocks();
  clearEngineSessionCache();
  global.fetch = jest.fn();
  clock = jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  clock.mockRestore();
});

describe('the decision', () => {
  test('asks GET /api/v1/auth/me with the caller token and a timeout', async () => {
    grants(['sre']);

    await resolveEngineSession('tok-a', FAR);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://engine.test:8000/api/v1/auth/me',
      expect.objectContaining({
        headers: { Authorization: 'Bearer tok-a' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  test.each([
    [['sre', 'platform']],
    [['platform', 'sre']],
    [['sre', 'zeta', 'platform']],
  ])('chooses the first group in code-point order from %j', async groups => {
    grants(groups);

    await expect(
      resolveEngineSession(`tok-${groups.join()}`, FAR),
    ).resolves.toEqual({ granted: true, team: 'platform' });
  });

  test('orders by code point, not by locale', async () => {
    grants(['alpha', 'Zulu', 'beta']);

    await expect(resolveEngineSession('tok-case', FAR)).resolves.toEqual({
      granted: true,
      team: 'Zulu',
    });
  });

  test('ignores blank group names and refuses when nothing else is left', async () => {
    grants(['', '   ']);

    await expect(resolveEngineSession('tok-blank', FAR)).resolves.toEqual({
      granted: false,
      status: 403,
      reason: 'no_group',
    });
  });

  test('refuses a session the engine grants no group', async () => {
    grants([]);

    await expect(resolveEngineSession('tok-none', FAR)).resolves.toEqual({
      granted: false,
      status: 403,
      reason: 'no_group',
    });
  });

  test('refuses a session pending a password change whatever groups it names', async () => {
    mockFetch().mockResolvedValueOnce(
      answer({ groups: ['sre'], password_change_required: true }),
    );

    await expect(resolveEngineSession('tok-pw', FAR)).resolves.toEqual({
      granted: false,
      status: 403,
      reason: 'password_change',
    });
  });

  test.each([401, 403] as const)(
    'passes an engine %i through as the refusal status',
    async status => {
      mockFetch().mockResolvedValueOnce(answer({}, status));

      await expect(resolveEngineSession(`tok-${status}`, FAR)).resolves.toEqual(
        {
          granted: false,
          status,
          reason: 'engine_refused',
        },
      );
    },
  );

  test.each([
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
    [
      'a timeout',
      () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
    ],
    ['a 500', () => Promise.resolve(answer({}, 500))],
    ['a 404', () => Promise.resolve(answer({}, 404))],
    [
      'groups that are not a list',
      () => Promise.resolve(answer({ groups: 'sre' })),
    ],
    [
      'a body that is not JSON',
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token');
          },
        }),
    ],
  ])('refuses with 401 on %s', async (_label, outcome) => {
    mockFetch().mockImplementationOnce(outcome);

    await expect(resolveEngineSession('tok-fault', FAR)).resolves.toEqual({
      granted: false,
      status: 401,
      reason: 'engine_unavailable',
    });
  });

  test('refuses with 401 when there is no engine to ask', async () => {
    (engineOrigin as jest.Mock).mockReturnValueOnce(undefined);

    await expect(resolveEngineSession('tok-origin', FAR)).resolves.toEqual({
      granted: false,
      status: 401,
      reason: 'engine_unavailable',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('never writes the token to the log on any refusal path', async () => {
    const token = 'tok-secret-value';
    mockFetch()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(answer({}, 500))
      .mockResolvedValueOnce(answer({ groups: token }));

    for (let i = 0; i < 3; i++) {
      await resolveEngineSession(token, FAR);
    }

    expect((logger.warn as jest.Mock).mock.calls).toHaveLength(3);
    const logged = JSON.stringify((logger.warn as jest.Mock).mock.calls);
    expect(logged).not.toContain(token);
  });
});

describe('the cache', () => {
  test('answers a repeat lookup for one token without asking again', async () => {
    grants(['sre']);

    await resolveEngineSession('tok-repeat', FAR);
    const second = await resolveEngineSession('tok-repeat', FAR);

    expect(second).toEqual({ granted: true, team: 'sre' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('keys on the token, so another token asks again', async () => {
    grants(['sre']);
    grants(['platform']);

    await resolveEngineSession('tok-one', FAR);
    const other = await resolveEngineSession('tok-two', FAR);

    expect(other).toEqual({ granted: true, team: 'platform' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('shares one engine request between concurrent lookups', async () => {
    grants(['sre']);

    const answers = await Promise.all([
      resolveEngineSession('tok-burst', FAR),
      resolveEngineSession('tok-burst', FAR),
      resolveEngineSession('tok-burst', FAR),
    ]);

    expect(answers).toEqual(Array(3).fill({ granted: true, team: 'sre' }));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('keeps an answer no longer than CACHE_TTL_MS', async () => {
    grants(['sre']);
    grants([]);

    await resolveEngineSession('tok-ttl', FAR);
    clock.mockReturnValue(NOW + TTL_MS - 1);
    await resolveEngineSession('tok-ttl', FAR);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    clock.mockReturnValue(NOW + TTL_MS);
    const later = await resolveEngineSession('tok-ttl', FAR);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(later).toEqual({ granted: false, status: 403, reason: 'no_group' });
  });

  test('never keeps an answer past the token expiry', async () => {
    grants(['sre']);
    grants(['sre']);
    const tokenExpiresAt = NOW + 1_000;

    await resolveEngineSession('tok-exp', tokenExpiresAt);
    clock.mockReturnValue(tokenExpiresAt);
    await resolveEngineSession('tok-exp', tokenExpiresAt);

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('does not cache an answer for a token that has already expired', async () => {
    grants(['sre']);
    grants(['sre']);

    await resolveEngineSession('tok-stale', NOW);
    await resolveEngineSession('tok-stale', NOW);

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('caches a refusal the engine gave', async () => {
    mockFetch().mockResolvedValueOnce(answer({}, 401));

    await resolveEngineSession('tok-refused', FAR);
    const again = await resolveEngineSession('tok-refused', FAR);

    expect(again).toEqual({
      granted: false,
      status: 401,
      reason: 'engine_refused',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('never caches a lookup the engine could not answer', async () => {
    mockFetch().mockRejectedValueOnce(new TypeError('fetch failed'));
    grants(['sre']);

    const first = await resolveEngineSession('tok-flap', FAR);
    const second = await resolveEngineSession('tok-flap', FAR);

    expect(first).toMatchObject({ granted: false, status: 401 });
    expect(second).toEqual({ granted: true, team: 'sre' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('holds at most 1000 answers, dropping the oldest first', async () => {
    mockFetch().mockImplementation(() =>
      Promise.resolve(answer({ groups: ['sre'] })),
    );

    for (let i = 0; i <= 1000; i++) {
      await resolveEngineSession(`tok-${i}`, FAR);
    }
    expect(global.fetch).toHaveBeenCalledTimes(1001);

    await resolveEngineSession('tok-1000', FAR);
    await resolveEngineSession('tok-1', FAR);
    expect(global.fetch).toHaveBeenCalledTimes(1001);

    await resolveEngineSession('tok-0', FAR);
    expect(global.fetch).toHaveBeenCalledTimes(1002);
  });

  test('drops expired answers before the oldest live one when full', async () => {
    mockFetch().mockImplementation(() =>
      Promise.resolve(answer({ groups: ['sre'] })),
    );

    await resolveEngineSession('tok-short', NOW + 1_000);
    for (let i = 0; i < 999; i++) {
      await resolveEngineSession(`tok-live-${i}`, FAR);
    }
    clock.mockReturnValue(NOW + 1_000);
    await resolveEngineSession('tok-newest', FAR);

    await resolveEngineSession('tok-live-0', FAR);
    expect(global.fetch).toHaveBeenCalledTimes(1001);
  });
});
