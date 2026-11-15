import { ErrorResponseSchema, OrderSchema } from '@factorymustgrow/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { api } from './helpers/api.js';
import { createOrder, createShippingLeadTime, createSite } from './helpers/factories.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function validOrder() {
  return {
    partName: 'Bracket',
    quantity: 10,
    requiredCapabilities: ['MILLING_5_AXIS'],
    deadline: new Date(Date.now() + 7 * DAY_MS).toISOString(),
    destination: 'DE',
  };
}

describe('POST /api/orders', () => {
  beforeEach(async () => {
    const site = await createSite();
    await createShippingLeadTime({ siteId: site.id, destination: 'DE', days: 1 });
  });

  it('creates a draft order', async () => {
    const res = await api()
      .post('/api/orders')
      .send({ ...validOrder(), partName: '  Bracket  ' });

    expect(res.status).toBe(201);
    const order = OrderSchema.parse(res.body);
    expect(res.headers.location).toBe(`/api/orders/${order.id}`);
    expect(order).toMatchObject({ partName: 'Bracket', status: 'DRAFT', blockedReason: null });
  });

  it('ignores fields the client may not set', async () => {
    const res = await api()
      .post('/api/orders')
      .send({ ...validOrder(), status: 'COMPLETE' });

    expect(res.status).toBe(201);
    expect(OrderSchema.parse(res.body).status).toBe('DRAFT');
  });

  it('lists every invalid field', async () => {
    const res = await api()
      .post('/api/orders')
      .send({
        partName: '',
        quantity: 0,
        requiredCapabilities: ['TURNING', 'TURNING'],
        deadline: new Date(Date.now() - DAY_MS).toISOString(),
        destination: 'DE',
      });

    expect(res.status).toBe(400);
    const { error } = ErrorResponseSchema.parse(res.body);
    expect(error.issues?.map((issue) => issue.path)).toEqual([
      'partName',
      'quantity',
      'requiredCapabilities',
      'deadline',
    ]);
  });

  it('rejects a missing body', async () => {
    const res = await api().post('/api/orders');

    expect(res.status).toBe(400);
    expect(ErrorResponseSchema.parse(res.body).error.message).toBe('Invalid request');
  });

  it('rejects malformed JSON', async () => {
    const res = await api()
      .post('/api/orders')
      .set('content-type', 'application/json')
      .send('{bad');

    expect(res.status).toBe(400);
  });

  it('rejects a destination without shipping times', async () => {
    const res = await api()
      .post('/api/orders')
      .send({ ...validOrder(), destination: 'XX' });

    expect(res.status).toBe(400);
    expect(ErrorResponseSchema.parse(res.body).error.message).toBe('Unknown destination: XX');
  });
});

describe('GET /api/orders', () => {
  it('lists orders newest first', async () => {
    await createOrder({ partName: 'Older', createdAt: new Date('2026-01-01T00:00:00Z') });
    await createOrder({ partName: 'Newer', createdAt: new Date('2026-02-01T00:00:00Z') });

    const res = await api().get('/api/orders');

    expect(res.status).toBe(200);
    expect(
      OrderSchema.array()
        .parse(res.body)
        .map((order) => order.partName),
    ).toEqual(['Newer', 'Older']);
  });

  it('filters by status', async () => {
    await createOrder({ partName: 'Draft' });
    await createOrder({ partName: 'Blocked', status: 'BLOCKED' });

    const res = await api().get('/api/orders?status=BLOCKED');

    expect(res.status).toBe(200);
    expect(
      OrderSchema.array()
        .parse(res.body)
        .map((order) => order.partName),
    ).toEqual(['Blocked']);
  });

  it('rejects an unknown status', async () => {
    const res = await api().get('/api/orders?status=BOGUS');

    expect(res.status).toBe(400);
    expect(ErrorResponseSchema.parse(res.body).error.issues?.[0]?.path).toBe('status');
  });
});

describe('GET /api/orders/:id', () => {
  it('returns the order', async () => {
    const created = await createOrder({ partName: 'Shaft' });

    const res = await api().get(`/api/orders/${created.id}`);

    expect(res.status).toBe(200);
    expect(OrderSchema.parse(res.body).partName).toBe('Shaft');
  });

  it('returns 404 for an unknown order', async () => {
    const res = await api().get('/api/orders/not-a-uuid');

    expect(res.status).toBe(404);
  });
});
