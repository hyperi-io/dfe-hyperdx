/**
 * DFE_AUTH_MODE is read once at import. A value that names no mode must stop the
 * API starting: read as unset it disables the identity middleware, and the API
 * then serves stock HyperDX auth, first-user registration included.
 */
function loadConfigWith(mode: string | undefined) {
  const saved = process.env.DFE_AUTH_MODE;
  if (mode === undefined) {
    delete process.env.DFE_AUTH_MODE;
  } else {
    process.env.DFE_AUTH_MODE = mode;
  }
  try {
    let loaded: typeof import('@/dfe/config') | undefined;
    jest.isolateModules(() => {
      loaded =
        jest.requireActual<typeof import('@/dfe/config')>('@/dfe/config');
    });
    return loaded;
  } finally {
    if (saved === undefined) {
      delete process.env.DFE_AUTH_MODE;
    } else {
      process.env.DFE_AUTH_MODE = saved;
    }
  }
}

describe('DFE_AUTH_MODE', () => {
  test.each([
    ['oidc-proxy', 'oidc-proxy', true],
    ['header-dev', 'header-dev', true],
    [undefined, undefined, false],
    ['', undefined, false],
  ])('%j reads as %j (enabled: %s)', (value, mode, enabled) => {
    const config = loadConfigWith(value);

    expect(config?.DFE_AUTH_MODE).toBe(mode);
    expect(config?.isDfeEnabled).toBe(enabled);
  });

  test.each(['oidc_proxy', 'OIDC-PROXY', 'oidc-proxy ', ' ', 'off'])(
    'refuses to start on %j',
    value => {
      expect(() => loadConfigWith(value)).toThrow(/DFE_AUTH_MODE/);
    },
  );
});
