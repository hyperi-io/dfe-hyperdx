import { ThemeConfig } from '@/theme/types';

import Logomark from './Logomark';
import { theme } from './mantineTheme';
import Wordmark from './Wordmark';

export const dfeTheme: ThemeConfig = {
  name: 'dfe',
  displayName: 'DFE',
  mantineTheme: theme,
  Wordmark,
  Logomark,
  cssClass: 'theme-dfe',
  favicon: {
    svg: '/favicons/dfe/favicon.svg',
    png32: '/favicons/dfe/favicon-32x32.png',
    png16: '/favicons/dfe/favicon-16x16.png',
    appleTouchIcon: '/favicons/dfe/apple-touch-icon.png',
    themeColor: '#1a1a1a', // Dark background for DFE
  },
};
