import { useEffect, useState } from 'react';

import { isEmbedChrome } from './embedFeatures';

type Scheme = 'light' | 'dark';

const parse = (t?: string | null): Scheme | null =>
  t === 'light' || t === 'dark' ? t : null;

/**
 * DFE embed color-scheme. When hyperdx is embedded in dfe-ui, dfe-ui owns light/dark.
 * hyperdx's MantineProvider uses `forceColorScheme`, so `setColorScheme` is ignored --
 * the scheme must be supplied as that prop's value. This hook returns the embed scheme
 * (from the `?theme` URL param initially, then live from `DFE_SET_THEME` postMessages
 * on every dfe-ui toggle), falling back to hyperdx's own resolved scheme when NOT
 * embedded. Feed the result into ThemeWrapper's colorScheme.
 */
export function useEmbedColorScheme(fallback: Scheme): Scheme {
  const [embedScheme, setEmbedScheme] = useState<Scheme | null>(null);

  useEffect(() => {
    if (!isEmbedChrome()) return;

    try {
      const initial = parse(
        new URLSearchParams(window.location.search).get('theme'),
      );
      if (initial) setEmbedScheme(initial);
    } catch {
      /* ignore */
    }

    const onMessage = (e: MessageEvent) => {
      // Theme is non-sensitive (light|dark); accept the DFE host's sync message.
      if (e?.data?.type === 'DFE_SET_THEME') {
        const t = parse(e.data.theme);
        if (t) setEmbedScheme(t);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return embedScheme ?? fallback;
}
