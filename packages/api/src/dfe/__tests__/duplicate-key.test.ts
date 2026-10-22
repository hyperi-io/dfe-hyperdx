/**
 * retryUpsertRace: which failures it retries, and that it gives up.
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

import { retryUpsertRace } from '@/dfe/models/duplicate-key';

const storeError = (code: number) =>
  Object.assign(new Error(`store error ${code}`), { code });

describe('retryUpsertRace', () => {
  test.each([11000, 112])(
    'retries a lost insert race (%i) and returns the next answer',
    async code => {
      const upsert = jest
        .fn()
        .mockRejectedValueOnce(storeError(code))
        .mockResolvedValueOnce('upserted');

      await expect(retryUpsertRace(upsert)).resolves.toBe('upserted');
      expect(upsert).toHaveBeenCalledTimes(2);
    },
  );

  test('rethrows after four attempts that all lose', async () => {
    const upsert = jest.fn().mockRejectedValue(storeError(11000));

    await expect(retryUpsertRace(upsert)).rejects.toMatchObject({
      code: 11000,
    });
    expect(upsert).toHaveBeenCalledTimes(4);
  });

  test('rethrows any other store error at once', async () => {
    const upsert = jest.fn().mockRejectedValue(storeError(2));

    await expect(retryUpsertRace(upsert)).rejects.toMatchObject({ code: 2 });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  test('rethrows an error with no code at once', async () => {
    const upsert = jest.fn().mockRejectedValue(new Error('socket closed'));

    await expect(retryUpsertRace(upsert)).rejects.toThrow('socket closed');
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
