/**
 * Fork-local coverage for the DFE identity middleware.
 *
 * The engine is the single JWT issuer; Envoy verifies its ES384 token at the
 * edge and hyperdx verifies it AGAIN as a Policy Enforcement Point. That second
 * check is the whole point of the file under test - if a merge weakens it, the
 * fork quietly starts trusting an unauthenticated header and nothing else in
 * the build notices.
 *
 * So the signing here is REAL: a generated ES384 keypair and the real
 * `jwtVerify`. Only the network fetch of the engine's JWKS is stubbed, by
 * pointing `createRemoteJWKSet` at the local public key.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * Building an express Request/Response double and reading jest.Mock off a
 * mocked module both mean asserting a narrower type than the real one, which
 * is exactly what this rule flags. Scoped to this file rather than relaxed in
 * packages/api/eslint.config.mjs, which is upstream's and stays untouched.
 */
import type { NextFunction, Request, Response } from 'express';
import { importJWK, SignJWT } from 'jose';

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('@/dfe/controllers/team-provisioning', () => ({
  findOrCreateTeamByName: jest.fn(),
}));

jest.mock('@/dfe/controllers/user-provisioning', () => ({
  findOrCreateUserFromOIDC: jest.fn(),
}));

jest.mock('@/dfe/controllers/org-connection', () => ({
  ensureOrgConnection: jest.fn(),
}));

const actualJose = jest.requireActual('jose');
let publicKey: CryptoKey;

// Real verification, observed: the spy delegates straight to jose so the crypto
// is genuine, while letting us assert the OPTIONS the middleware pins.
const jwtVerifySpy = jest.fn((...args: unknown[]) =>
  (actualJose.jwtVerify as (...a: unknown[]) => unknown)(...args),
);

jest.mock('jose', () => ({
  ...jest.requireActual('jose'),
  createRemoteJWKSet: jest.fn(() => async () => publicKey),
  jwtVerify: (...args: unknown[]) => jwtVerifySpy(...args),
}));

import * as dfeConfig from '@/dfe/config';
import { findOrCreateTeamByName } from '@/dfe/controllers/team-provisioning';
import { findOrCreateUserFromOIDC } from '@/dfe/controllers/user-provisioning';
import {
  dfeIdentityMiddleware,
  engineJwtMiddleware,
} from '@/dfe/middleware/jwt-verify';
import { oidcIdentityMiddleware } from '@/dfe/middleware/oidc-identity';

jest.mock('@/dfe/middleware/oidc-identity', () => ({
  oidcIdentityMiddleware: jest.fn((_req, _res, next) => next()),
}));

const ISSUER = 'https://engine.example.test';
const TEAM = { _id: 'team-oid', name: 'sre' };
const USER = { _id: 'user-oid', email: 'jo@example.test' };

let privateKey: CryptoKey;

const sign = async (
  claims: Record<string, unknown>,
  opts: { issuer?: string; alg?: string; key?: CryptoKey } = {},
) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: opts.alg ?? 'ES384' })
    .setIssuedAt()
    .setIssuer(opts.issuer ?? ISSUER)
    .setExpirationTime('5m')
    .sign(opts.key ?? privateKey);

const makeReq = (
  headers: Record<string, string> = {},
  path = '/search',
): Request =>
  ({
    headers,
    path,
    login: jest.fn((_user: unknown, _opts: unknown, cb: (e?: Error) => void) =>
      cb(),
    ),
  }) as unknown as Request;

const makeRes = (): Response =>
  ({ sendStatus: jest.fn() }) as unknown as Response;

const res = {} as Response;

describe('engineJwtMiddleware', () => {
  beforeAll(async () => {
    const pair = await actualJose.generateKeyPair('ES384', {
      extractable: true,
    });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (findOrCreateTeamByName as jest.Mock).mockResolvedValue({
      team: TEAM,
      created: false,
    });
    (findOrCreateUserFromOIDC as jest.Mock).mockResolvedValue({ user: USER });
    (dfeConfig as any).DFE_ENGINE_JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
    (dfeConfig as any).DFE_ENGINE_ISSUER = ISSUER;
    (dfeConfig as any).DFE_AUTH_DEFAULT_TEAM = undefined;
  });

  it('accepts a valid ES384 bearer token and logs the user in', async () => {
    const token = await sign({ sub: USER.email, groups: ['sre'] });
    const req = makeReq({ authorization: `Bearer ${token}` });
    const next = jest.fn() as NextFunction;

    await engineJwtMiddleware(req, res, next);

    expect(findOrCreateTeamByName).toHaveBeenCalledWith('sre');
    expect(findOrCreateUserFromOIDC).toHaveBeenCalledWith(USER.email, TEAM._id);
    expect(req.login).toHaveBeenCalledWith(
      USER,
      { session: false },
      expect.any(Function),
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('accepts the token from a dfe_token cookie', async () => {
    const token = await sign({ sub: USER.email, groups: ['sre'] });
    const req = makeReq({ cookie: `other=x; dfe_token=${token}; more=y` });
    const next = jest.fn() as NextFunction;

    await engineJwtMiddleware(req, res, next);

    expect(req.login).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('url-decodes a cookie value', async () => {
    const token = await sign({ sub: USER.email, groups: ['sre'] });
    const req = makeReq({ cookie: `dfe_token=${encodeURIComponent(token)}` });
    const next = jest.fn() as NextFunction;

    await engineJwtMiddleware(req, res, next);

    expect(req.login).toHaveBeenCalled();
  });

  it('prefers the Authorization header over the cookie', async () => {
    const header = await sign({ sub: 'header@example.test', groups: ['sre'] });
    const cookie = await sign({ sub: 'cookie@example.test', groups: ['sre'] });
    const req = makeReq({
      authorization: `Bearer ${header}`,
      cookie: `dfe_token=${cookie}`,
    });

    await engineJwtMiddleware(req, res, jest.fn() as NextFunction);

    expect(findOrCreateUserFromOIDC).toHaveBeenCalledWith(
      'header@example.test',
      TEAM._id,
    );
  });

  describe('team resolution', () => {
    it('uses the first group claim', async () => {
      const token = await sign({
        sub: USER.email,
        groups: ['platform', 'sre'],
      });
      await engineJwtMiddleware(
        makeReq({ authorization: `Bearer ${token}` }),
        res,
        jest.fn() as NextFunction,
      );
      expect(findOrCreateTeamByName).toHaveBeenCalledWith('platform');
    });

    it('accepts groups as a comma-separated string', async () => {
      const token = await sign({
        sub: USER.email,
        groups: ' platform , sre ',
      });
      await engineJwtMiddleware(
        makeReq({ authorization: `Bearer ${token}` }),
        res,
        jest.fn() as NextFunction,
      );
      expect(findOrCreateTeamByName).toHaveBeenCalledWith('platform');
    });

    it('falls back to DFE_AUTH_DEFAULT_TEAM when there are no groups', async () => {
      (dfeConfig as any).DFE_AUTH_DEFAULT_TEAM = 'house-team';
      const token = await sign({ sub: USER.email });
      await engineJwtMiddleware(
        makeReq({ authorization: `Bearer ${token}` }),
        res,
        jest.fn() as NextFunction,
      );
      expect(findOrCreateTeamByName).toHaveBeenCalledWith('house-team');
    });

    it("falls back to 'default' when nothing else is configured", async () => {
      const token = await sign({ sub: USER.email, groups: [] });
      await engineJwtMiddleware(
        makeReq({ authorization: `Bearer ${token}` }),
        res,
        jest.fn() as NextFunction,
      );
      expect(findOrCreateTeamByName).toHaveBeenCalledWith('default');
    });
  });

  describe('rejection paths fall THROUGH rather than 401', () => {
    // The route-level isUserAuthenticated guard owns the rejection. Returning
    // 401 from here would also break every unauthenticated public route.
    const expectFellThrough = (req: Request, next: jest.Mock) => {
      expect(next).toHaveBeenCalledWith();
      expect(req.login).not.toHaveBeenCalled();
      expect(findOrCreateTeamByName).not.toHaveBeenCalled();
    };

    it('with no token at all', async () => {
      const req = makeReq();
      const next = jest.fn();
      await engineJwtMiddleware(req, res, next as NextFunction);
      expectFellThrough(req, next);
    });

    it('with an empty bearer token', async () => {
      const req = makeReq({ authorization: 'Bearer   ' });
      const next = jest.fn();
      await engineJwtMiddleware(req, res, next as NextFunction);
      expectFellThrough(req, next);
    });

    it('with a garbage token', async () => {
      const req = makeReq({ authorization: 'Bearer not-a-jwt' });
      const next = jest.fn();
      await engineJwtMiddleware(req, res, next as NextFunction);
      expectFellThrough(req, next);
    });

    it('with a token signed by a DIFFERENT key', async () => {
      const rogue = await actualJose.generateKeyPair('ES384', {
        extractable: true,
      });
      const token = await sign({ sub: USER.email }, { key: rogue.privateKey });
      const req = makeReq({ authorization: `Bearer ${token}` });
      const next = jest.fn();
      await engineJwtMiddleware(req, res, next as NextFunction);
      expectFellThrough(req, next);
    });

    it('with the wrong issuer', async () => {
      const token = await sign(
        { sub: USER.email },
        { issuer: 'https://impostor.example.test' },
      );
      const req = makeReq({ authorization: `Bearer ${token}` });
      const next = jest.fn();
      await engineJwtMiddleware(req, res, next as NextFunction);
      expectFellThrough(req, next);
    });

    it('with an expired token', async () => {
      const token = await new SignJWT({ sub: USER.email })
        .setProtectedHeader({ alg: 'ES384' })
        .setIssuer(ISSUER)
        .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
        .sign(privateKey);
      const req = makeReq({ authorization: `Bearer ${token}` });
      const next = jest.fn();
      await engineJwtMiddleware(req, res, next as NextFunction);
      expectFellThrough(req, next);
    });

    it('with no sub (email) claim', async () => {
      const token = await sign({ groups: ['sre'] });
      const req = makeReq({ authorization: `Bearer ${token}` });
      const next = jest.fn();
      await engineJwtMiddleware(req, res, next as NextFunction);
      expectFellThrough(req, next);
    });
  });

  it('pins ES384 and the engine issuer in the verify options', async () => {
    // The pin is what stops algorithm confusion: without it, a token whose
    // header says HS256 is verified as an HMAC, and the attacker's "secret" is
    // the public key they already have.
    const token = await sign({ sub: USER.email, groups: ['sre'] });
    await engineJwtMiddleware(
      makeReq({ authorization: `Bearer ${token}` }),
      res,
      jest.fn() as NextFunction,
    );

    expect(jwtVerifySpy).toHaveBeenCalledWith(
      token,
      expect.any(Function),
      expect.objectContaining({ algorithms: ['ES384'], issuer: ISSUER }),
    );
  });

  it('does not authenticate a token whose alg is not ES384', async () => {
    const hmac = await importJWK(
      { kty: 'oct', k: Buffer.from('a'.repeat(64)).toString('base64url') },
      'HS256',
    );
    const token = await new SignJWT({ sub: USER.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(hmac);

    const req = makeReq({ authorization: `Bearer ${token}` });
    const next = jest.fn();
    await engineJwtMiddleware(req, res, next as NextFunction);

    expect(req.login).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('propagates an identity-resolution failure to the error handler', async () => {
    (findOrCreateTeamByName as jest.Mock).mockRejectedValue(
      new Error('mongo down'),
    );
    const token = await sign({ sub: USER.email, groups: ['sre'] });
    const next = jest.fn();

    await engineJwtMiddleware(
      makeReq({ authorization: `Bearer ${token}` }),
      res,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  describe('service tokens (svc:dfe-engine, dfe-engine#149)', () => {
    const svcClaims = { sub: 'svc:dfe-engine', aud: 'dfe-hyperdx' };

    beforeEach(() => {
      (dfeConfig as any).DFE_AUTH_DEFAULT_TEAM = 'dfe';
    });

    it.each(['/team', '/sources', '/connections/abc123'])(
      'allows %s as the internal service principal on the default team',
      async path => {
        const token = await sign(svcClaims);
        const req = makeReq({ authorization: `Bearer ${token}` }, path);
        const next = jest.fn() as NextFunction;

        await engineJwtMiddleware(req, makeRes(), next);

        expect(findOrCreateTeamByName).toHaveBeenCalledWith('dfe');
        expect(findOrCreateUserFromOIDC).toHaveBeenCalledWith(
          'svc-dfe-engine@dfe.internal',
          TEAM._id,
          'DFE Engine (service)',
        );
        expect(req.login).toHaveBeenCalledWith(
          USER,
          { session: false },
          expect.any(Function),
        );
        expect(next).toHaveBeenCalledWith();
      },
    );

    it("JIT-creates the 'default' team when DFE_AUTH_DEFAULT_TEAM is unset", async () => {
      (dfeConfig as any).DFE_AUTH_DEFAULT_TEAM = undefined;
      const token = await sign(svcClaims);
      const req = makeReq({ authorization: `Bearer ${token}` }, '/team');

      await engineJwtMiddleware(req, makeRes(), jest.fn() as NextFunction);

      expect(findOrCreateTeamByName).toHaveBeenCalledWith('default');
    });

    it('accepts an audience ARRAY containing dfe-hyperdx', async () => {
      const token = await sign({
        sub: 'svc:dfe-engine',
        aud: ['other', 'dfe-hyperdx'],
      });
      const req = makeReq({ authorization: `Bearer ${token}` }, '/sources');

      await engineJwtMiddleware(req, makeRes(), jest.fn() as NextFunction);

      expect(req.login).toHaveBeenCalled();
    });

    it('rejects a service token outside the control surface with 403', async () => {
      const token = await sign(svcClaims);
      const req = makeReq({ authorization: `Bearer ${token}` }, '/dashboards');
      const svcRes = makeRes();
      const next = jest.fn();

      await engineJwtMiddleware(req, svcRes, next as NextFunction);

      expect(svcRes.sendStatus).toHaveBeenCalledWith(403);
      expect(req.login).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('does not treat a prefix collision as control surface', async () => {
      // '/teammates' must not ride on the '/team' prefix.
      const token = await sign(svcClaims);
      const req = makeReq({ authorization: `Bearer ${token}` }, '/teammates');
      const svcRes = makeRes();

      await engineJwtMiddleware(req, svcRes, jest.fn() as NextFunction);

      expect(svcRes.sendStatus).toHaveBeenCalledWith(403);
      expect(req.login).not.toHaveBeenCalled();
    });

    it.each([
      ['wrong audience', { sub: 'svc:dfe-engine', aud: 'somewhere-else' }],
      ['missing audience', { sub: 'svc:dfe-engine' }],
    ])(
      'falls through (no login, no 403) on a service token with %s',
      async (_label, claims) => {
        const token = await sign(claims);
        const req = makeReq({ authorization: `Bearer ${token}` }, '/team');
        const svcRes = makeRes();
        const next = jest.fn();

        await engineJwtMiddleware(req, svcRes, next as NextFunction);

        expect(next).toHaveBeenCalledWith();
        expect(req.login).not.toHaveBeenCalled();
        expect(svcRes.sendStatus).not.toHaveBeenCalled();
        expect(findOrCreateTeamByName).not.toHaveBeenCalled();
      },
    );

    it('propagates a service identity-resolution failure to the error handler', async () => {
      (findOrCreateTeamByName as jest.Mock).mockRejectedValue(
        new Error('mongo down'),
      );
      const token = await sign(svcClaims);
      const next = jest.fn();

      await engineJwtMiddleware(
        makeReq({ authorization: `Bearer ${token}` }, '/team'),
        makeRes(),
        next as NextFunction,
      );

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

describe('dfeIdentityMiddleware dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (dfeConfig as any).DFE_ENGINE_JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
    (dfeConfig as any).DFE_ENGINE_ISSUER = ISSUER;
  });

  it('uses the unverified header path ONLY in header-dev mode', async () => {
    (dfeConfig as any).DFE_AUTH_MODE = 'header-dev';
    const next = jest.fn();

    await dfeIdentityMiddleware(makeReq(), res, next as NextFunction);

    expect(oidcIdentityMiddleware).toHaveBeenCalled();
  });

  it('verifies the engine JWT in the default oidc-proxy mode', async () => {
    (dfeConfig as any).DFE_AUTH_MODE = 'oidc-proxy';
    const next = jest.fn();

    await dfeIdentityMiddleware(makeReq(), res, next as NextFunction);

    expect(oidcIdentityMiddleware).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('does NOT trust identity headers when the mode is unset', async () => {
    // Unset means DFE middleware is disabled and upstream behaviour applies -
    // it must never silently degrade to the dev header path.
    (dfeConfig as any).DFE_AUTH_MODE = undefined;
    const next = jest.fn();

    await dfeIdentityMiddleware(
      makeReq({ 'x-forwarded-email': 'attacker@example.test' }),
      res,
      next as NextFunction,
    );

    expect(oidcIdentityMiddleware).not.toHaveBeenCalled();
  });
});
