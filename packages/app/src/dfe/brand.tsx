// The DFE name, marks and Mantine theme, read by upstream's brand/index.tsx and ThemeWrapper.tsx.
import UpstreamLogomark from '@/brand/Logomark';
import UpstreamWordmark from '@/brand/Wordmark';
import { theme as upstreamTheme } from '@/theme/mantineTheme';
import DfeLogomark from '@/theme/themes/dfe/Logomark';
import { theme as dfeTheme } from '@/theme/themes/dfe/mantineTheme';
import DfeWordmark from '@/theme/themes/dfe/Wordmark';

// jest.dfe.setup.js sets this, so upstream's tests see the brand they assert.
const UPSTREAM_BRAND = process.env.DFE_UPSTREAM_BRAND === 'true';

export const DFE_BRAND_DISPLAY_NAME = 'DFE';

export function dfeBrandName(upstreamName: string): string {
  return UPSTREAM_BRAND ? upstreamName : DFE_BRAND_DISPLAY_NAME;
}

export const Logomark: typeof UpstreamLogomark = UPSTREAM_BRAND
  ? UpstreamLogomark
  : DfeLogomark;

export const Wordmark: typeof UpstreamWordmark = UPSTREAM_BRAND
  ? UpstreamWordmark
  : DfeWordmark;

export const theme = UPSTREAM_BRAND ? upstreamTheme : dfeTheme;
