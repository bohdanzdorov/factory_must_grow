import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/errors/http-error.js';
import { errorHandler } from '../src/middlewares/error.middleware.js';
import { requestLogger } from '../src/middlewares/request-logger.middleware.js';
import { api } from './helpers/api.js';

// A tiny app with routes that throw, because no real route fails on purpose.
function appThrowing(error: unknown) {
  const app = express();
  app.use(requestLogger);
  app.get('/fail', () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe('error handling', () => {
  it('hides the details of unexpected errors', async () => {
    const res = await request(appThrowing(new Error('connection to db-internal:5432 failed'))).get(
      '/fail',
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal server error' } });
  });

  it('uses the status of an HttpError', async () => {
    const res = await request(appThrowing(new HttpError(409, 'Slot already taken'))).get('/fail');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { message: 'Slot already taken' } });
  });

  it('returns JSON for unknown routes', async () => {
    const res = await api().get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { message: 'Route not found: GET /api/nope' } });
  });
});
