import { describe, expect, it } from 'vitest';
import { api } from './helpers/api.js';

describe('GET /health', () => {
  it('reports ok when the database is reachable', async () => {
    const res = await api().get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });
});
