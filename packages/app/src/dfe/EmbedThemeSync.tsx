import { useEffect, useState } from 'react';

import { DFE_UI_BASE_URL } from '@/config';

import { isEmbedChrome } from './embedFeatures';

type Scheme = 'light' | 'dark';

const parse = (t?: string | null): Scheme | null =>
  t === 'light' || t === 'dark' ? t : null;

/**
 * Only the DFE UI that framed us may drive the colour scheme.
 *
 * The payload is cosmetic (light|dark) and the CSP frame-ancestors allowlist
 * already bounds who can frame this app at all, so this is defence in depth
 * rather than the only control. It is still worth having: an unchecked
 * `message` listener is a habit that gets copied to a handler where the
 * payload is NOT cosmetic.
 *
 * Same-origin is accepted because the standard deploy serves dfe-ui and this
 * app behind one gateway origin, where DFE_UI_BASE_URL is typically unset.
 */
function isTrustedHost(origin: string): boolean {
  if (typeof window !== 'undefined' && origin === window.location.origin) {
    return true;
  }
  return Boolean(DFE_UI_BASE_URL) && origin === DFE_UI_BASE_URL;
}

/**
 * DFE embed color-scheme. When hyperdx is embedded in dfe-ui, dfe-ui owns light/dark.
 * hyperdx's MantineProvider uses `forceColorScheme`, so `setColorScheme` is ignored --
 * the scheme must be supplied as that prop's value. This hook returns the embed scheme
 * (from the `?theme` URL param initially, then live from `DFE_SET_THEME` postMessages
 * on every dfe-ui toggle), falling back to hyperdx's own resolved scheme when NOT
 * embedded. Feed the result into ThemeWrapper's colorScheme.
 */
export function useEmbedColorScheme(fallback: Scheme): Scheme {
  // Resolve the embed scheme on the FIRST client render (lazy init), so the
  // initial paint is already the host's light/dark instead of hyperdx's dark
  // fallback - otherwise the background flashes black before the effect runs.
  const [embedScheme, setEmbedScheme] = useState<Scheme | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      if (!isEmbedChrome()) return null;
      return parse(new URLSearchParams(window.location.search).get('theme'));
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!isEmbedChrome()) return;

    const onMessage = (e: MessageEvent) => {
      if (!isTrustedHost(e.origin)) return;
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
