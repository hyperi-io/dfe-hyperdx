/**
 * /readyz against the process's real Mongoose connection, which nothing in a
 * unit run connects: the pod is up and Mongo is not, so it must not take traffic.
 */
import express from 'express';
import request from 'supertest';

import { livez, readyz } from '@/dfe/observability/health';

function appWithProbes() {
  const app = express();
  app.get('/livez', livez);
  app.get('/readyz', readyz);
  return app;
}

describe('/readyz while Mongo is not connected', () => {
  test('503 with the connection state, and /livez stays 200', async () => {
    const app = appWithProbes();

    const ready = await request(app).get('/readyz');
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: 'not_ready', mongo: 'disconnected' });

    // A restart would not bring Mongo back, so liveness never looks at it.
    const alive = await request(app).get('/livez');
    expect(alive.status).toBe(200);
    expect(alive.body).toEqual({ status: 'alive' });
  });
});
