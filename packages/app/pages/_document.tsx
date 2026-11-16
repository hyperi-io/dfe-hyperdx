import { Head, Html, Main, NextScript } from 'next/document';

import { IS_CLICKHOUSE_BUILD, IS_NOINDEX } from '@/config';
import { ibmPlexMono, inter, roboto, robotoMono } from '@/fonts';

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
    <Html lang="en" className={fontClasses}>
      <Head>
        {IS_NOINDEX && <meta name="robots" content="noindex, nofollow" />}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/__ENV.js" />
        <script dangerouslySetInnerHTML={{ __html: EMBED_INIT_SCRIPT }} />
        <link rel="icon" href="/favicons/dfe/favicon.ico" sizes="any" />
        <link
          rel="icon"
          type="image/svg+xml"
          href="/favicons/dfe/favicon.svg"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicons/dfe/favicon-32x32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/favicons/dfe/favicon-16x16.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/favicons/dfe/apple-touch-icon.png"
        />
        <meta name="theme-color" content="#1a1a1a" />
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
