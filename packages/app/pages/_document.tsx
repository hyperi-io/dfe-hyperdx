import { Head, Html, Main, NextScript } from 'next/document';

import { IS_CLICKHOUSE_BUILD, IS_NOINDEX } from '@/config';
import { ibmPlexMono, inter, roboto, robotoMono } from '@/fonts';
import { themes } from '@/theme';

// Applied before React hydrates to prevent a flash of the wrong theme.
// Reads the runtime value from window.__ENV (set by __ENV.js) and swaps
// the theme class on <html> so CSS variables are correct on first paint.
const validThemes = Object.keys(themes);
const themeClasses = validThemes.map(t => `theme-${t}`);
const THEME_INIT_SCRIPT = `
(function () {
  var theme = window.__ENV && window.__ENV.NEXT_PUBLIC_THEME;
  var valid = ${JSON.stringify(validThemes)};
  if (valid.indexOf(theme) !== -1) {
    var html = document.documentElement;
    var remove = ${JSON.stringify(themeClasses)};
    for (var i = 0; i < remove.length; i++) html.classList.remove(remove[i]);
    html.classList.add('theme-' + theme);
  }
})();
`;

// Applied before React hydrates when embedded in dfe-ui (?embed=1): adds
// html.dfe-embed (globals.css hides .dfe-appnav-slot, no chrome-sidebar flash)
// and primes data-mantine-color-scheme from ?theme (no dark-background flash
// before the host's light/dark resolves). Both persist via sessionStorage so
// internal embed navigation stays chromeless and correctly themed.
const EMBED_INIT_SCRIPT = `
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    var embed = params.get('embed') === '1'
      || window.sessionStorage.getItem('dfeEmbed') === '1';
    if (embed) {
      window.sessionStorage.setItem('dfeEmbed', '1');
      document.documentElement.classList.add('dfe-embed');
      var theme = params.get('theme') || window.sessionStorage.getItem('dfeEmbedTheme');
      if (theme === 'light' || theme === 'dark') {
        window.sessionStorage.setItem('dfeEmbedTheme', theme);
        document.documentElement.setAttribute('data-mantine-color-scheme', theme);
      }
    }
  } catch (e) {}
})();
`;

export default function Document() {
  const fontClasses = [
    ibmPlexMono.variable,
    robotoMono.variable,
    inter.variable,
    roboto.variable,
  ].join(' ');

  return (
    <Html lang="en" className={`${fontClasses} theme-hyperdx`}>
      <Head>
        {IS_NOINDEX && <meta name="robots" content="noindex, nofollow" />}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/__ENV.js" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: EMBED_INIT_SCRIPT }} />
        {!IS_CLICKHOUSE_BUILD && (
          <>
            {/* eslint-disable-next-line @next/next/no-sync-scripts */}
            <script src="/pyodide/pyodide.js"></script>
          </>
        )}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
