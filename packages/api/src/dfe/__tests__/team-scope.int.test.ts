/**
 * A member reads their OWN team on /me and /team, never whichever team was
 * inserted first. Two teams in one store, against the real app and a real
 * MongoDB (`make dev-int FILE=team-scope`).
 */
jest.mock('@/dfe/config', () => ({
  __esModule: true,
  ...jest.requireActual('@/dfe/config'),
  get isDfeEnabled() {
    return mockDfeEnabled;
  },
}));
// The app imports it for the SQL export route; its ESM-only jose dependency does
// not load under jest.int.config.js, and nothing here verifies a token.
jest.mock('@/dfe/middleware/jwt-verify', () => ({ extractToken: jest.fn() }));

// Off while the app loads and the member signs in: DFE mode refuses the password login.
let mockDfeEnabled = false;

import { clearDBCollections, getLoggedInAgent, getServer } from '@/fixtures';
import Team from '@/models/team';
import User from '@/models/user';

describe('team scoping across two teams', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  // MongoDB only: nothing here reads or writes ClickHouse.
  afterEach(async () => {
    mockDfeEnabled = false;
    await clearDBCollections();
  });

  afterAll(async () => {
    await server.stop();
  });

  // Registration creates the first team; the member then moves to a second one.
  const memberOfSecondTeam = async () => {
    const { agent, team: first, user } = await getLoggedInAgent(server);
    const own = await Team.create({ name: 'team-b' });
    await User.updateOne({ _id: user._id }, { team: own._id });
    return { agent, first, own };
  };

  it('GET /me and GET /team return the caller team', async () => {
    const { agent, first, own } = await memberOfSecondTeam();

    const me = await agent.get('/me').expect(200);
    expect(me.body.team).toMatchObject({
      id: own.id,
      name: 'team-b',
      apiKey: own.apiKey,
    });

    const team = await agent.get('/team').expect(200);
    expect(team.body).toMatchObject({
      _id: own.id,
      name: 'team-b',
      apiKey: own.apiKey,
    });

    for (const body of [me.body, team.body]) {
      expect(JSON.stringify(body)).not.toContain(first.apiKey);
      expect(JSON.stringify(body)).not.toContain(first.name);
    }
  });

  it('in DFE mode a member gets their team without the admin-only fields', async () => {
    const { agent, first, own } = await memberOfSecondTeam();
    mockDfeEnabled = true;

    const team = await agent.get('/team').expect(200);
    expect(team.body).toMatchObject({ _id: own.id, name: 'team-b' });

    const me = await agent.get('/me').expect(200);
    expect(me.body.team).toMatchObject({ id: own.id, name: 'team-b' });

    for (const body of [me.body, team.body]) {
      const wire = JSON.stringify(body);
      expect(wire).not.toContain(own.apiKey);
      expect(wire).not.toContain(first.apiKey);
      expect(wire).not.toContain(first.name);
      expect(wire).not.toContain('allowedAuthMethods');
    }
  });
});
