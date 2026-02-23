import { ThemeConfig } from '../../types';

import Logomark from './Logomark';
import { theme } from './mantineTheme';
import Wordmark from './Wordmark';

export const hyperiTheme: ThemeConfig = {
  name: 'hyperi',
  displayName: 'HyperI',
  mantineTheme: theme,
  Wordmark,
  Logomark,
  cssClass: 'theme-hyperi',
  favicon: {
    svg: '/favicons/hyperi/favicon.svg',
    png32: '/favicons/hyperi/favicon-32x32.png',
    png16: '/favicons/hyperi/favicon-16x16.png',
    appleTouchIcon: '/favicons/hyperi/apple-touch-icon.png',
    themeColor: '#1a1a1a', // Dark background for HyperI
  },
};
