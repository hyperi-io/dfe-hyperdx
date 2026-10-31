/**
 * The DFE_* settings are read once at import. A combination the API cannot run
 * safely must stop it starting, because the alternative is serving stock HyperDX
 * auth (a mode that names nothing), answering 401 to everyone (oidc-proxy with
 * no JWKS URL) or trusting an unverified header (header-dev in production).
 */
const KEYS: readonly string[] = [
  'DFE_AUTH_MODE',
  'DFE_ENGINE_JWKS_URL',
  'NODE_ENV',
];
type Env = {
  DFE_AUTH_MODE?: string;
  DFE_ENGINE_JWKS_URL?: string;
  NODE_ENV?: string;
};

const JWKS = 'https://engine.example.test/.well-known/jwks.json';

/** The config module read under an environment holding only `env` of the DFE_* keys. */
function loadConfigWith(env: Env) {
  const saved = process.env;
  const kept = Object.entries(saved).filter(([key]) => !KEYS.includes(key));
  const given = Object.entries({ NODE_ENV: 'test', ...env }).filter(
    ([, value]) => value !== undefined,
  );
  process.env = Object.fromEntries([...kept, ...given]);
  try {
    let loaded: typeof import('@/dfe/config') | undefined;
    jest.isolateModules(() => {
      loaded =
        jest.requireActual<typeof import('@/dfe/config')>('@/dfe/config');
    });
    return loaded;
  } finally {
    process.env = saved;
  }
}

describe('DFE_AUTH_MODE', () => {
  test.each([
    ['oidc-proxy', 'oidc-proxy', true],
    ['header-dev', 'header-dev', true],
    [undefined, undefined, false],
    ['', undefined, false],
  ])('%j reads as %j (enabled: %s)', (value, mode, enabled) => {
    const config = loadConfigWith({
      DFE_AUTH_MODE: value,
      DFE_ENGINE_JWKS_URL: JWKS,
    });

    expect(config?.DFE_AUTH_MODE).toBe(mode);
    expect(config?.isDfeEnabled).toBe(enabled);
  });

  test.each(['oidc_proxy', 'OIDC-PROXY', 'oidc-proxy ', ' ', 'off'])(
    'refuses to start on %j',
    value => {
      expect(() =>
        loadConfigWith({ DFE_AUTH_MODE: value, DFE_ENGINE_JWKS_URL: JWKS }),
      ).toThrow(/DFE_AUTH_MODE/);
    },
  );
});

describe('oidc-proxy needs the engine JWKS URL', () => {
  test.each([undefined, '', 'not a url'])(
    'refuses to start with DFE_ENGINE_JWKS_URL %j',
    jwks => {
      expect(() =>
        loadConfigWith({
          DFE_AUTH_MODE: 'oidc-proxy',
          DFE_ENGINE_JWKS_URL: jwks,
        }),
      ).toThrow(/DFE_ENGINE_JWKS_URL/);
    },
  );

  test.each(['header-dev', undefined])('is not asked for by %j mode', mode => {
    expect(() => loadConfigWith({ DFE_AUTH_MODE: mode })).not.toThrow();
  });
});

describe('header-dev in production', () => {
  test.each([
    ['production', true],
    ['development', false],
    ['test', false],
  ])('NODE_ENV=%s refuses to start: %s', (nodeEnv, refuses) => {
    const load = () =>
      loadConfigWith({ DFE_AUTH_MODE: 'header-dev', NODE_ENV: nodeEnv });

    if (refuses) {
      expect(load).toThrow(/header-dev/);
    } else {
      expect(load).not.toThrow();
    }
  });

  test('oidc-proxy starts in production', () => {
    expect(() =>
      loadConfigWith({
        DFE_AUTH_MODE: 'oidc-proxy',
        DFE_ENGINE_JWKS_URL: JWKS,
        NODE_ENV: 'production',
      }),
    ).not.toThrow();
  });
});
