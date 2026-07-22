// DFE fork-local UNIT test config.
//
// Upstream's api package has no unit target at all - every api test is an
// integration test (`ci:int`) that wants Mongo and ClickHouse up. Our identity
// middleware does not, and we want it gated on every PR, not only when the
// integration stack is available. So this config runs ONLY `src/dfe/**`.
//
// It is a SEPARATE file, not an edit to upstream's jest.config.js, because
// every in-place edit to a pristine upstream file is permanent merge-conflict
// surface for `git rerere`. See CLAUDE.md / FORK.md.

const base = require('./jest.config');

/** @type {import("jest").Config} **/
module.exports = {
  ...base,
  // jose v6 ships ESM only (no CJS build). Node >= 22.12 handles require(ESM)
  // so the compiled service is fine, but Jest's CJS loader is not - transform
  // it instead of ignoring it, so the tests exercise REAL ES384 verification
  // rather than a hand-rolled crypto double.
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
  testMatch: ['<rootDir>/dfe/**/__tests__/**/*.test.ts?(x)'],
};
