/**
 * /readyz follows a real MongoDB connection down and back up. The probes ride
 * a bare Express app, as in observability.test.ts, so the run needs Mongo and
 * not the ClickHouse the full server waits on.
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

import * as config from '@/config';
import { mountObservability } from '@/dfe/observability';

function mongoUri(): string {
  if (config.MONGO_URI == null) {
    throw new Error('MONGO_URI is not set');
  }
  return config.MONGO_URI;
}

describe('/readyz and /livez across a MongoDB outage', () => {
  const app = express();
  mountObservability(app);

  beforeAll(async () => {
    await mongoose.connect(mongoUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  test('ready while connected, not ready while disconnected, ready again after', async () => {
    const connected = await request(app).get('/readyz');
    expect(connected.status).toBe(200);
    expect(connected.body).toEqual({ status: 'ready' });

    await mongoose.disconnect();
    try {
      const down = await request(app).get('/readyz');
      expect(down.status).toBe(503);
      expect(down.body).toEqual({ status: 'not_ready', mongo: 'disconnected' });

      const alive = await request(app).get('/livez');
      expect(alive.status).toBe(200);
    } finally {
      await mongoose.connect(mongoUri());
    }

    const back = await request(app).get('/readyz');
    expect(back.status).toBe(200);
  });
});
