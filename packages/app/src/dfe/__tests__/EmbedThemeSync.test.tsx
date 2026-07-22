/**
 * Fork-local coverage for the embed colour-scheme bridge.
 *
 * When hyperdx is embedded in dfe-ui, dfe-ui owns light/dark. hyperdx's
 * MantineProvider uses `forceColorScheme`, so `setColorScheme` is a no-op - the
 * scheme has to arrive as that prop's VALUE. If a merge breaks this hook the
 * symptom is a dark panel inside a light shell, which no type check catches.
 */
import { act, renderHook } from '@testing-library/react';

import { useEmbedColorScheme } from '@/dfe/EmbedThemeSync';

const setSearch = (search: string) => {
  window.history.replaceState({}, '', `/search${search}`);
};

const postTheme = (theme: unknown) => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'DFE_SET_THEME', theme } }),
    );
  });
};

describe('useEmbedColorScheme', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    setSearch('');
  });

  it('returns hyperdx own scheme when NOT embedded', () => {
    const { result } = renderHook(() => useEmbedColorScheme('dark'));
    expect(result.current).toBe('dark');
  });

  it('ignores host theme messages when NOT embedded', () => {
    const { result } = renderHook(() => useEmbedColorScheme('dark'));
    postTheme('light');
    expect(result.current).toBe('dark');
  });

  it('takes the initial scheme from the ?theme param when embedded', () => {
    setSearch('?embed=1&theme=light');
    const { result } = renderHook(() => useEmbedColorScheme('dark'));
    expect(result.current).toBe('light');
  });

  it('falls back to hyperdx scheme when embedded without a ?theme param', () => {
    setSearch('?embed=1');
    const { result } = renderHook(() => useEmbedColorScheme('dark'));
    expect(result.current).toBe('dark');
  });

  it('follows live DFE_SET_THEME messages from the host', () => {
    setSearch('?embed=1&theme=light');
    const { result } = renderHook(() => useEmbedColorScheme('dark'));
    expect(result.current).toBe('light');

    postTheme('dark');
    expect(result.current).toBe('dark');

    postTheme('light');
    expect(result.current).toBe('light');
  });

  it('ignores a malformed theme rather than rendering an invalid scheme', () => {
    setSearch('?embed=1&theme=light');
    const { result } = renderHook(() => useEmbedColorScheme('dark'));

    postTheme('purple');
    postTheme(null);
    postTheme(42);

    expect(result.current).toBe('light');
  });

  it('ignores an unrelated postMessage', () => {
    setSearch('?embed=1&theme=light');
    const { result } = renderHook(() => useEmbedColorScheme('dark'));

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'SOMETHING_ELSE', theme: 'dark' },
        }),
      );
    });

    expect(result.current).toBe('light');
  });

  it('ignores an invalid ?theme param and uses the fallback', () => {
    setSearch('?embed=1&theme=neon');
    const { result } = renderHook(() => useEmbedColorScheme('dark'));
    expect(result.current).toBe('dark');
  });

  it('detaches its listener on unmount', () => {
    setSearch('?embed=1&theme=light');
    const removeSpy = jest.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useEmbedColorScheme('dark'));
    unmount();

    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
    removeSpy.mockRestore();
  });
});
