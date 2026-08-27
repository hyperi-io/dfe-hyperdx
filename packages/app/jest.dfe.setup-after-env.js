// DFE: size testing-library's async budget for a contended CI runner.
//
// `waitFor` and every `findBy*` default to 1000ms, which is the assertion
// budget, not the test budget. Under the 4 workers CI runs on, Mantine popover
// and react-hook-form validation transitions land outside it - ColorSwatchInput
// "closes the popover after a selection" is the one that surfaces first.
//
// Kept BELOW jest.dfe.config.js's testTimeout on purpose: whichever budget is
// smaller decides the error message, and "unable to find element X" names the
// problem where "exceeded timeout" does not.

const { configure } = require('@testing-library/dom');

configure({ asyncUtilTimeout: 5000 });
