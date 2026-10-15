// DFE integration test config - upstream's, plus the jose transform.
//
// A SEPARATE file, not an edit to upstream's jest.int.config.js, for the same
// reason as jest.dfe.config.js: upstream changes that file's transform list
// often, and an in-place edit would conflict on every sync. The list is derived
// from upstream's, so packages upstream adds to it keep working here.
//
// jose ships ESM only, and api-app.ts reaches it through the DFE routers, so
// without this no integration test that boots the app can load.

const base = require('./jest.int.config');

const UNIGNORE = '/node_modules/(?!(';

const transformIgnorePatterns = base.transformIgnorePatterns.map(pattern =>
  pattern.replace(UNIGNORE, `${UNIGNORE}jose|`),
);
if (
  transformIgnorePatterns.every((p, i) => p === base.transformIgnorePatterns[i])
) {
  throw new Error(
    `jest.int.config.js no longer has a ${UNIGNORE} pattern to add jose to; update jest.dfe.int.config.js`,
  );
}

/** @type {import("jest").Config} **/
module.exports = {
  ...base,
  transformIgnorePatterns,
};
