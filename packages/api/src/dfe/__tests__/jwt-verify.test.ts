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
 * pointing `createRemoteJWKSet` at the local public key, and the engine's
 * session answer is stubbed at `fetch`.
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
  placeUserOnTeam: jest.fn(),
}));

jest.mock('@/dfe/controllers/org-connection', () => ({
  ensureOrgConnection: jest.fn(),
  engineOrigin: () => 'https://engine.example.test',
}));

jest.mock('@/dfe/tasks/team-connection-repair', () => ({
  scheduleTeamConnectionRepair: jest.fn(),
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

const { placeUserOnTeam } = jest.requireMock<{ placeUserOnTeam: jest.Mock }>(
  '@/dfe/controllers/user-provisioning',
);

const { ensureOrgConnection } = jest.requireMock<{
  ensureOrgConnection: jest.Mock;
}>('@/dfe/controllers/org-connection');

// The config module exports consts, so a test that varies them has to write
// through a mutable view. One alias rather than a cast per assignment.
const config = dfeConfig as Record<string, unknown>;

const ISSUER = 'https://engine.example.test';
// The ClickHouse identity the engine hands the session, which names its team.
const IDENTITY = 'dfe_org_acme';
const TEAM = { _id: 'team-oid', name: IDENTITY };
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

const ENGINE_ME = `${ISSUER}/api/v1/auth/me`;
const ENGINE_CONNECTION = `${ISSUER}/api/v1/hyperdx/connection`;

// The engine's GET /api/v1/auth/me: `groups` is what the BOUND account holds.
const engineAnswers = (groups: string[], extra: Record<string, unknown> = {}) =>
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      user_id: USER.email,
      groups,
      hyperdx_identity: IDENTITY,
      ...extra,
    }),
  });

// An engine that predates hyperdx_identity and hyperdx_role.
const olderEngineAnswers = (groups: string[], username: string) => {
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ user_id: USER.email, groups }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'acme',
        host: 'http://ch:8123',
        username,
        password: 'pw',
      }),
    });
};

const engineStatus = (status: number) =>
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({}),
  });

const run = async (claims: Record<string, unknown>) => {
  const token = await sign(claims);
  const req = makeReq({ authorization: `Bearer ${token}` });
  const reply = makeRes();
  const next = jest.fn();
  await engineJwtMiddleware(req, reply, next as NextFunction);
  return { token, req, reply, next };
};

const expectRefused = (
  outcome: Awaited<ReturnType<typeof run>>,
  status: number,
) => {
  expect(outcome.reply.sendStatus).toHaveBeenCalledWith(status);
  expect(findOrCreateTeamByName).not.toHaveBeenCalled();
  expect(outcome.req.login).not.toHaveBeenCalled();
  expect(outcome.next).not.toHaveBeenCalled();
};

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
    ensureOrgConnection.mockResolvedValue('present');
    config.DFE_ENGINE_JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
    config.DFE_ENGINE_ISSUER = ISSUER;
    config.DFE_AUTH_DEFAULT_TEAM = undefined;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user_id: USER.email,
        groups: ['sre'],
        hyperdx_identity: IDENTITY,
      }),
    });
  });

  it('accepts a valid ES384 bearer token and logs the user in', async () => {
    const token = await sign({ sub: USER.email, groups: ['sre'] });
    const req = makeReq({ authorization: `Bearer ${token}` });
    const next = jest.fn() as NextFunction;

    await engineJwtMiddleware(req, res, next);

    expect(findOrCreateTeamByName).toHaveBeenCalledWith(IDENTITY);
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

  describe('team resolution follows the engine, never the groups claim', () => {
    it('asks the engine about the session with the caller token', async () => {
      const { token } = await run({ sub: USER.email, groups: ['sre'] });

      expect(global.fetch).toHaveBeenCalledWith(
        ENGINE_ME,
        expect.objectContaining({
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
    });

    it('names the team after the ClickHouse identity the engine hands the caller', async () => {
      engineAnswers(['org-a-analysts'], { hyperdx_identity: 'dfe_org_a' });

      await run({ sub: USER.email, groups: ['platform-admins'] });

      expect(findOrCreateTeamByName).toHaveBeenCalledWith('dfe_org_a');
      expect(findOrCreateTeamByName).not.toHaveBeenCalledWith(
        'platform-admins',
      );
      expect(findOrCreateTeamByName).not.toHaveBeenCalledWith('org-a-analysts');
    });

    it('refuses a session the engine hands no ClickHouse identity', async () => {
      engineAnswers(['dfe-infra'], { hyperdx_identity: '' });

      expectRefused(await run({ sub: USER.email, groups: ['dfe-infra'] }), 403);
    });

    it('on an engine that predates the identity field, asks the connection read', async () => {
      olderEngineAnswers(['sre'], 'dfe_org_older');

      const outcome = await run({ sub: USER.email, groups: ['sre'] });

      expect(global.fetch).toHaveBeenCalledWith(
        ENGINE_CONNECTION,
        expect.objectContaining({
          headers: { Authorization: `Bearer ${outcome.token}` },
        }),
      );
      expect(findOrCreateTeamByName).toHaveBeenCalledWith('dfe_org_older');
      expect(outcome.req.login).toHaveBeenCalled();
    });

    it('refuses a token whose claim groups the engine does not grant', async () => {
      engineAnswers([]);

      const outcome = await run({
        sub: USER.email,
        groups: ['platform-admins'],
      });

      expectRefused(outcome, 403);
    });

    it("refuses a deleted account's token that still carries its groups", async () => {
      // A deleted account binds nothing, so the engine answers 200 with no groups.
      config.DFE_AUTH_DEFAULT_TEAM = 'house-team';
      engineAnswers([], { roles: [], org_ids: [] });

      const outcome = await run({
        sub: 'leaver@example.test',
        groups: ['dfe-admins'],
      });

      expectRefused(outcome, 403);
    });

    it('refuses with 401 when the engine refuses the token', async () => {
      engineStatus(401);

      expectRefused(await run({ sub: USER.email, groups: ['sre'] }), 401);
    });

    it('refuses a session the engine reports as pending a password change', async () => {
      engineAnswers(['sre'], { password_change_required: true });

      expectRefused(await run({ sub: USER.email, groups: ['sre'] }), 403);
    });

    it('lands a two-group user on the same team whatever order the groups arrive in', async () => {
      const teams: unknown[] = [];
      for (const order of [
        ['sre', 'platform'],
        ['platform', 'sre'],
      ]) {
        engineAnswers(order);
        await run({ sub: USER.email, groups: order });
        teams.push(
          (findOrCreateTeamByName as jest.Mock).mock.calls.at(-1)?.[0],
        );
      }

      expect(teams).toEqual([IDENTITY, IDENTITY]);
    });

    it('moves an existing user onto the team the engine selects', async () => {
      await run({ sub: USER.email, groups: ['sre'] });

      expect(placeUserOnTeam).toHaveBeenCalledWith(USER, TEAM._id);
    });
  });

  describe('the team connection', () => {
    it('is ensured on every request, not only the one that created the team', async () => {
      // A failed first seed used to be permanent: only the creating request seeded.
      const { token } = await run({ sub: USER.email, groups: ['sre'] });

      expect(ensureOrgConnection).toHaveBeenCalledWith(
        token,
        TEAM._id,
        IDENTITY,
      );
    });

    it('is ensured after the user is on its identity team', async () => {
      await run({ sub: USER.email, groups: ['sre'] });

      expect(placeUserOnTeam.mock.invocationCallOrder[0]).toBeLessThan(
        ensureOrgConnection.mock.invocationCallOrder[0],
      );
    });

    it.each(['refused', 'mismatch'])(
      'a %s team connection refuses the session',
      async seed => {
        ensureOrgConnection.mockResolvedValueOnce(seed);

        const outcome = await run({ sub: USER.email, groups: ['sre'] });

        expect(outcome.reply.sendStatus).toHaveBeenCalledWith(403);
        expect(outcome.req.login).not.toHaveBeenCalled();
        expect(outcome.next).not.toHaveBeenCalled();
      },
    );

    it.each(['present', 'seeded', 'unavailable'])(
      'a %s team connection lets the login through',
      async seed => {
        ensureOrgConnection.mockResolvedValueOnce(seed);

        const outcome = await run({ sub: USER.email, groups: ['sre'] });

        expect(outcome.req.login).toHaveBeenCalled();
        expect(outcome.next).toHaveBeenCalledWith();
      },
    );
  });

  describe('the dashboard role', () => {
    const roleOf = (req: Request) => req.dfeRole;

    it("takes the engine's live role over the token claim", async () => {
      engineAnswers(['dfe-admins'], { hyperdx_role: 'admin' });

      const outcome = await run({ sub: USER.email, role: 'member' });

      expect(roleOf(outcome.req)).toBe('admin');
    });

    it('a demoted account loses the role while its token still claims admin', async () => {
      engineAnswers(['dfe-viewers'], { hyperdx_role: 'member' });

      const outcome = await run({ sub: USER.email, role: 'admin' });

      expect(roleOf(outcome.req)).toBe('member');
    });

    it('falls back to the token claim on an engine that sends no role', async () => {
      olderEngineAnswers(['dfe-admins'], IDENTITY);

      const outcome = await run({ sub: USER.email, role: 'admin' });

      expect(roleOf(outcome.req)).toBe('admin');
    });

    it('is unset when neither the engine nor the token says', async () => {
      const outcome = await run({ sub: USER.email });

      expect(roleOf(outcome.req)).toBeUndefined();
    });
  });

  describe('an engine that cannot answer refuses, never falling back to the claim', () => {
    it.each([
      ['unreachable', () => new TypeError('fetch failed')],
      ['timed out', () => new DOMException('timed out', 'TimeoutError')],
    ])('when the engine is %s', async (_label, fault) => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(fault());

      expectRefused(await run({ sub: USER.email, groups: ['sre'] }), 401);
    });

    it.each([500, 502, 404])('when the engine answers %i', async status => {
      engineStatus(status);

      expectRefused(await run({ sub: USER.email, groups: ['sre'] }), 401);
    });

    it('when the engine answers with a body it cannot read', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ groups: 'sre' }),
      });

      expectRefused(await run({ sub: USER.email, groups: ['sre'] }), 401);
    });
  });

  describe('rejection paths fall THROUGH rather than 401', () => {
    // The route-level isUserAuthenticated guard owns the rejection. Returning
    // 401 from here would also break every unauthenticated public route.
    const expectFellThrough = (req: Request, next: jest.Mock) => {
      expect(next).toHaveBeenCalledWith();
      expect(req.login).not.toHaveBeenCalled();
      expect(findOrCreateTeamByName).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
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

    it('with a session still on an issued password', async () => {
      const token = await sign({
        sub: USER.email,
        groups: [],
        password_change_required: true,
      });
      const req = makeReq({ authorization: `Bearer ${token}` });
      const next = jest.fn();
      await engineJwtMiddleware(req, res, next as NextFunction);
      expectFellThrough(req, next);
    });
  });

  it('logs in a session whose password change is not pending', async () => {
    const token = await sign({
      sub: USER.email,
      groups: ['sre'],
      password_change_required: false,
    });
    const req = makeReq({ authorization: `Bearer ${token}` });
    await engineJwtMiddleware(req, res, jest.fn() as NextFunction);
    expect(req.login).toHaveBeenCalled();
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
      config.DFE_AUTH_DEFAULT_TEAM = 'dfe';
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
        // The service identity binds no account, so there is no session to ask about.
        expect(global.fetch).not.toHaveBeenCalled();
      },
    );

    it("JIT-creates the 'default' team when DFE_AUTH_DEFAULT_TEAM is unset", async () => {
      config.DFE_AUTH_DEFAULT_TEAM = undefined;
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
    config.DFE_ENGINE_JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
    config.DFE_ENGINE_ISSUER = ISSUER;
  });

  it('uses the unverified header path ONLY in header-dev mode', async () => {
    config.DFE_AUTH_MODE = 'header-dev';
    const next = jest.fn();

    await dfeIdentityMiddleware(makeReq(), res, next as NextFunction);

    expect(oidcIdentityMiddleware).toHaveBeenCalled();
  });

  it('verifies the engine JWT in the default oidc-proxy mode', async () => {
    config.DFE_AUTH_MODE = 'oidc-proxy';
    const next = jest.fn();

    await dfeIdentityMiddleware(makeReq(), res, next as NextFunction);

    expect(oidcIdentityMiddleware).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('does NOT trust identity headers when the mode is unset', async () => {
    // Unset means DFE middleware is disabled and upstream behaviour applies -
    // it must never silently degrade to the dev header path.
    config.DFE_AUTH_MODE = undefined;
    const next = jest.fn();

    await dfeIdentityMiddleware(
      makeReq({ 'x-forwarded-email': 'attacker@example.test' }),
      res,
      next as NextFunction,
    );

    expect(oidcIdentityMiddleware).not.toHaveBeenCalled();
  });
});
