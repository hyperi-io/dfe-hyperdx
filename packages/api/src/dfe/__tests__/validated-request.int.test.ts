/**
 * Through the real app (`yarn ci:int`): a PATCH body carrying a key the route's
 * schema does not declare never reaches the dashboard write.
 */
import mongoose from 'mongoose';

import { getLoggedInAgent, getServer, makeTile } from '@/fixtures';
import Dashboard from '@/models/dashboard';

describe('PATCH /dashboards/:id with an undeclared team', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('renames the dashboard and leaves it in its own team', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const created = await agent
      .post('/dashboards')
      .send({ name: 'mine', tiles: [makeTile()], tags: [] })
      .expect(200);
    const otherTeam = new mongoose.Types.ObjectId().toString();

    await agent
      .patch(`/dashboards/${created.body.id}`)
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          name: 'renamed',
          team: otherTeam,
          constructor: { prototype: { polluted: true } },
        }),
      )
      .expect(200);

    const stored = await Dashboard.findById(created.body.id).lean();
    expect(stored?.name).toBe('renamed');
    expect(String(stored?.team)).toBe(String(team._id));
  });
});
