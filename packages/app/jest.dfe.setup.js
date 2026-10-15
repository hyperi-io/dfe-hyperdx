// DFE: run the app's unit tests under upstream's branding.
//
// `theme/index.ts` resolves NEXT_PUBLIC_THEME at module load and falls back to
// 'dfe', so unset it renders "DFE" where upstream's tests assert "HyperDX".
// Pinning it here keeps upstream's suite passing unchanged, instead of editing
// their test files and owning that conflict surface forever.
//
// DFE branding is covered by `src/dfe/__tests__/dfeTheme.test.ts`, which imports
// the theme directly and is unaffected.
process.env.NEXT_PUBLIC_THEME = 'hyperdx';

// Same reason: OnboardingModal renders upstream's manual source setup only
// behind this flag, and upstream's OnboardingModal.test.tsx asserts that step.
process.env.NEXT_PUBLIC_DFE_SHOW_SOURCE_ADD = 'true';
