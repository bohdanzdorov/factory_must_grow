import {
  ErrorResponseSchema,
  RouteOrderResultSchema,
  RoutingDecisionSchema,
} from '@factorymustgrow/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { api } from './helpers/api.js';
import { useManualClock } from './helpers/clock.js';
import {
  createJob,
  createMachine,
  createOrder,
  createRoutingDecision,
  createShippingLeadTime,
  createSite,
} from './helpers/factories.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const START = Date.parse('2030-01-01T08:00:00Z');
const at = (offsetMs: number) => new Date(START + offsetMs);
const iso = (offsetMs: number) => at(offsetMs).toISOString();

// At scale 60, the 120-second approval window is 2 simulated hours.
const WINDOW = 2 * HOUR;

beforeEach(async () => {
  useManualClock(at(0), 60);

  await createSite({ id: 'HAM' });
  // 3-axis milling, 10 minutes per part.
  await createMachine({ id: 'HAM-1', siteId: 'HAM' });
  await createShippingLeadTime({ siteId: 'HAM', destination: 'DE', days: 1 });
});

// The default test order: 10 parts on a 3-axis mill = 100 minutes, due in 7 days.
function route(orderId: string) {
  return api().post(`/api/orders/${orderId}/route`);
}

describe('POST /api/orders/:id/route', () => {
  it('books the best machine after the approval window and saves the whole decision', async () => {
    const order = await createOrder();

    const res = await route(order.id);

    expect(res.status).toBe(201);
    const { order: routed, decision } = RouteOrderResultSchema.parse(res.body);
    expect(routed.status).toBe('ROUTED');
    expect(decision).toMatchObject({
      orderId: order.id,
      kind: 'INITIAL',
      status: 'PROPOSED',
      chosenMachineId: 'HAM-1',
      supersedesId: null,
    });
    expect(decision.candidates).toEqual([
      {
        machineId: 'HAM-1',
        siteId: 'HAM',
        rank: 1,
        rejectionReason: null,
        earliestStart: iso(WINDOW),
        finishAt: iso(WINDOW + 100 * MINUTE),
        arrivalAt: iso(WINDOW + 100 * MINUTE + DAY),
        // 7 days − (2 h + 100 min + 1 day)
        slackMinutes: (6 * DAY - WINDOW - 100 * MINUTE) / MINUTE,
      },
    ]);
    expect(decision.jobs).toEqual([
      {
        id: expect.any(String) as string,
        machineId: 'HAM-1',
        status: 'PLANNED',
        plannedStart: iso(WINDOW),
        plannedEnd: iso(WINDOW + 100 * MINUTE),
      },
    ]);
    expect(await prisma.job.count()).toBe(1);
  });

  it('books around existing jobs on the machine', async () => {
    await createJob({ machineId: 'HAM-1', plannedStart: at(WINDOW), plannedEnd: at(5 * HOUR) });
    const order = await createOrder();

    const res = await route(order.id);

    expect(RouteOrderResultSchema.parse(res.body).decision.jobs[0]?.plannedStart).toBe(
      iso(5 * HOUR),
    );
  });

  it('blocks the order with a reason when no machine is eligible', async () => {
    const order = await createOrder({ requiredCapabilities: ['INSPECTION'] });

    const res = await route(order.id);

    expect(res.status).toBe(201);
    const { order: blocked, decision } = RouteOrderResultSchema.parse(res.body);
    expect(decision).toMatchObject({ status: 'NO_ELIGIBLE_MACHINE', chosenMachineId: null });
    expect(decision.jobs).toEqual([]);
    expect(decision.candidates[0]?.rejectionReason).toBe('MISSING_CAPABILITY');
    expect(blocked.status).toBe('BLOCKED');
    expect(blocked.blockedReason).toBe(decision.explanation);
    expect(await prisma.job.count()).toBe(0);
  });

  it('can route a blocked order again', async () => {
    const order = await createOrder({ status: 'BLOCKED' });

    const res = await route(order.id);

    const { order: routed } = RouteOrderResultSchema.parse(res.body);
    expect(routed).toMatchObject({ status: 'ROUTED', blockedReason: null });
  });

  it('does not propose a machine the operator already rejected for this order', async () => {
    await createMachine({ id: 'HAM-2', siteId: 'HAM' });
    const order = await createOrder();
    await createRoutingDecision({
      orderId: order.id,
      chosenMachineId: 'HAM-1',
      status: 'REJECTED',
    });

    const res = await route(order.id);

    const { decision } = RouteOrderResultSchema.parse(res.body);
    expect(decision.chosenMachineId).toBe('HAM-2');
    expect(decision.candidates.find((c) => c.machineId === 'HAM-1')?.rejectionReason).toBe(
      'REJECTED_BY_OPERATOR',
    );
  });

  it.each(['ROUTED', 'APPROVED', 'IN_PRODUCTION', 'COMPLETE', 'REROUTE_PENDING'] as const)(
    'refuses to route an order that is %s',
    async (status) => {
      const order = await createOrder({ status });

      const res = await route(order.id);

      expect(res.status).toBe(409);
      expect(ErrorResponseSchema.parse(res.body).error.message).toContain(status);
      expect(await prisma.routingDecision.count()).toBe(0);
    },
  );

  it('returns 404 for an unknown order', async () => {
    const res = await route('not-a-uuid');

    expect(res.status).toBe(404);
  });

  it('routes an order only once when two requests arrive together', async () => {
    const order = await createOrder();

    const responses = await Promise.all([route(order.id), route(order.id)]);

    expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await prisma.routingDecision.count()).toBe(1);
    expect(await prisma.job.count()).toBe(1);
  });

  it('gives two orders routed together different, non-overlapping slots', async () => {
    const [first, second] = await Promise.all([createOrder(), createOrder()]);

    const responses = await Promise.all([route(first.id), route(second.id)]);

    expect(responses.map((res) => res.status)).toEqual([201, 201]);
    const jobs = await prisma.job.findMany({ orderBy: { plannedStart: 'asc' } });
    expect(jobs).toHaveLength(2);
    const [earlier, later] = jobs;
    expect(later?.plannedStart.getTime()).toBeGreaterThanOrEqual(
      earlier?.plannedEnd.getTime() ?? 0,
    );
  });
});

describe('GET /api/orders/:id/decisions', () => {
  it('lists every decision for the order, newest first', async () => {
    const clock = useManualClock(at(0), 60);
    const order = await createOrder({ requiredCapabilities: ['INSPECTION'] });
    await route(order.id);

    // An inspection machine appears, and the blocked order is routed again.
    clock.advance(MINUTE);
    await createMachine({
      id: 'HAM-CMM-1',
      siteId: 'HAM',
      capabilities: [{ capability: 'INSPECTION', cycleMinutesPerPart: 4 }],
    });
    await route(order.id);

    const res = await api().get(`/api/orders/${order.id}/decisions`);

    expect(res.status).toBe(200);
    const decisions = RoutingDecisionSchema.array().parse(res.body);
    expect(decisions.map((decision) => decision.status)).toEqual([
      'PROPOSED',
      'NO_ELIGIBLE_MACHINE',
    ]);
    expect(decisions[0]?.chosenMachineId).toBe('HAM-CMM-1');
    expect(decisions[0]?.jobs).toHaveLength(1);
  });

  it('returns an empty list for an order that was never routed', async () => {
    const order = await createOrder();

    const res = await api().get(`/api/orders/${order.id}/decisions`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 404 for an unknown order', async () => {
    const res = await api().get('/api/orders/not-a-uuid/decisions');

    expect(res.status).toBe(404);
  });
});
