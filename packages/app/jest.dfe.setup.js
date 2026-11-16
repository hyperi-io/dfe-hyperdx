// DFE: run the app's unit tests under upstream's branding.
//
// `src/dfe/brand.tsx` resolves the brand at module load and gives "DFE" unless
// this is set, where upstream's tests assert "ClickStack". Pinning it here keeps
// upstream's suite passing unchanged, instead of editing their test files and
// owning that conflict surface forever.
//
// DFE branding is covered by `src/dfe/__tests__/dfeTheme.test.ts`, which reloads
// the brand module with the pin cleared.
process.env.DFE_UPSTREAM_BRAND = 'true';

// Same reason: OnboardingModal renders upstream's manual source setup only
// behind this flag, and upstream's OnboardingModal.test.tsx asserts that step.
process.env.NEXT_PUBLIC_DFE_SHOW_SOURCE_ADD = 'true';
