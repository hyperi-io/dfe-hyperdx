// DFE unit test config -- upstream's, plus the brand pin our rebrand needs.
//
// A separate file rather than an edit to upstream's jest.config.js, because an
// in-place edit to a pristine upstream file is permanent conflict surface for
// `git rerere`. Mirrors packages/api/jest.dfe.config.js. See CLAUDE.md.
//
// testMatch is deliberately NOT narrowed: scoping to `src/dfe/**` would run our
// handful of tests and silently skip upstream's several thousand.

const base = require('./jest.config');

/** @type {import("jest").Config} **/
module.exports = {
  ...base,
  setupFiles: [...(base.setupFiles ?? []), '<rootDir>/jest.dfe.setup.js'],
};
