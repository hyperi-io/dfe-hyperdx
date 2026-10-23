/**
 * indexOnce: one build for every caller, and a failed build tried again.
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

import { indexOnce } from '@/dfe/models/index-once';
import logger from '@/utils/logger';

describe('indexOnce', () => {
  test('concurrent callers wait on one build', async () => {
    let finish: () => void = () => {};
    const build = jest.fn(
      () => new Promise<void>(resolve => (finish = resolve)),
    );
    const ensure = indexOnce(build, 'test index');

    const settled: number[] = [];
    const waiting = [ensure(), ensure(), ensure()].map((call, i) =>
      call.then(() => settled.push(i)),
    );
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toEqual([]);

    finish();
    await Promise.all(waiting);
    await ensure();

    expect(settled).toHaveLength(3);
    expect(build).toHaveBeenCalledTimes(1);
  });

  test('a failed build is logged, resolves, and is tried again next call', async () => {
    const build = jest
      .fn()
      .mockRejectedValueOnce(new Error('index build failed'))
      .mockResolvedValueOnce('built');
    const ensure = indexOnce(build, 'test index');

    await expect(ensure()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'DFE: failed to ensure test index',
    );
    await ensure();

    expect(build).toHaveBeenCalledTimes(2);
  });
});
