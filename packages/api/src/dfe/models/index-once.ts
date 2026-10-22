// An index the dfe layer adds to an upstream collection, built once per process.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import logger from '@/utils/logger';

/**
 * Wrap an idempotent createIndex so every caller awaits one build, and none
 * reads or writes before the index exists. A failed build is logged and tried
 * again by the next call.
 */
export function indexOnce(
  build: () => Promise<unknown>,
  what: string,
): () => Promise<void> {
  let built: Promise<void> | undefined;
  return () => {
    built ??= build().then(
      () => undefined,
      err => {
        built = undefined;
        logger.warn({ err }, `DFE: failed to ensure ${what}`);
      },
    );
    return built;
  };
}
