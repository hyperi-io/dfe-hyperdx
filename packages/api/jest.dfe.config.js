// DFE unit test config - upstream's, plus the one transform our tests need.
//
// It is a SEPARATE file, not an edit to upstream's jest.config.js, because
// every in-place edit to a pristine upstream file is permanent merge-conflict
// surface for `git rerere`. See CLAUDE.md and docs/fork/.
//
// It deliberately does NOT narrow testMatch. It used to, back when upstream's
// api package had no unit target at all; 2.33.0 added one and renamed their
// integration tests to `.int.test.ts`. Scoping this config to `src/dfe/**`
// would run our handful of tests while silently skipping upstream's several
// hundred.

const base = require('./jest.config');

/** @type {import("jest").Config} **/
module.exports = {
  ...base,
  // jose v6 ships ESM only (no CJS build). Node >= 22.12 handles require(ESM)
  // so the compiled service is fine, but Jest's CJS loader is not - transform
  // it instead of ignoring it, so the tests exercise REAL ES384 verification
  // rather than a hand-rolled crypto double.
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
};
