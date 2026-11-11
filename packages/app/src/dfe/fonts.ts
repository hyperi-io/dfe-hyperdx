/**
 * The UI fonts, vendored so `next build` fetches nothing from Google Fonts.
 * `src/fonts.ts` imports these four loaders in place of `next/font/google`.
 * Sources and licences: fonts/README.md.
 */
import localFont from 'next/font/local';

import { vendoredFont } from './vendoredFont';

const ibmPlexMono = localFont({
  src: [
    { path: './fonts/ibm-plex-mono-latin-300.woff2', weight: '300' },
    { path: './fonts/ibm-plex-mono-latin-400.woff2', weight: '400' },
    { path: './fonts/ibm-plex-mono-latin-500.woff2', weight: '500' },
    { path: './fonts/ibm-plex-mono-latin-600.woff2', weight: '600' },
    { path: './fonts/ibm-plex-mono-latin-700.woff2', weight: '700' },
  ],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

const robotoMono = localFont({
  src: './fonts/roboto-mono-latin-variable.woff2',
  weight: '100 700',
  variable: '--font-roboto-mono',
  display: 'swap',
});

const inter = localFont({
  src: './fonts/inter-latin-variable.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
});

const roboto = localFont({
  src: './fonts/roboto-latin-variable.woff2',
  weight: '100 900',
  variable: '--font-roboto',
  display: 'swap',
});

export const IBM_Plex_Mono = vendoredFont(ibmPlexMono, 'IBM Plex Mono', {
  variable: '--font-ibm-plex-mono',
  weights: ['300', '400', '500', '600', '700'],
});

export const Roboto_Mono = vendoredFont(robotoMono, 'Roboto Mono', {
  variable: '--font-roboto-mono',
  weights: { min: 100, max: 700 },
});

export const Inter = vendoredFont(inter, 'Inter', {
  variable: '--font-inter',
  weights: { min: 100, max: 900 },
});

export const Roboto = vendoredFont(roboto, 'Roboto', {
  variable: '--font-roboto',
  weights: { min: 100, max: 900 },
});
