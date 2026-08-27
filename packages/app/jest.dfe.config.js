// DFE unit test config -- upstream's, plus the brand pin our rebrand needs.
//
// A separate file rather than an edit to upstream's jest.config.js, because an
// in-place edit to a pristine upstream file is permanent conflict surface for
// `git rerere`. Mirrors packages/api/jest.dfe.config.js. See CLAUDE.md.
//
// testMatch is deliberately NOT narrowed: scoping to `src/dfe/**` would run our
// handful of tests and silently skip upstream's several thousand.
//
// testTimeout is a BACKSTOP for a stuck test, sized from measurement rather than
// jest's 5000ms default: the whole 3210-test suite peaks at 8491ms per test
// under the 4 workers CI runs on, and only two tests exceed 8000ms. The default
// makes those two a coin toss on a contended runner while a genuinely hung
// promise still trips this one.

const base = require('./jest.config');

/** @type {import("jest").Config} **/
module.exports = {
  ...base,
  testTimeout: 20000,
  setupFiles: [...(base.setupFiles ?? []), '<rootDir>/jest.dfe.setup.js'],
  setupFilesAfterEnv: [
    ...(base.setupFilesAfterEnv ?? []),
    '<rootDir>/jest.dfe.setup-after-env.js',
  ],
};
