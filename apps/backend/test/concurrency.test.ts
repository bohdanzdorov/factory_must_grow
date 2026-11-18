// W2-06: many requests fighting over the same machines at once, through the real API.
// Concurrency bugs depend on timing, so each scenario runs several rounds, and the whole
// database is checked for consistency after every round, not just the responses.
import { OrderDecisionResultSchema } from '@factorymustgrow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { api } from './helpers/api.js';
import { useManualClock } from './helpers/clock.js';
import { findInconsistencies } from './helpers/consistency.js';
import {
  createMachine,
  createOrder,
  createShippingLeadTime,
  createSite,
} from './helpers/factories.js';

const START = Date.parse('2030-01-01T08:00:00Z');
const ROUNDS = 3;
// These tests are deliberately heavy: many requests at once, each retrying up to 4 times,
// over several rounds. They need far more than Vitest's default 5 seconds per test,
// especially on slower CI machines.
const STRESS = { timeout: 30_000 };

// How many route requests ran and how many gave up with 409, printed at the end.
const stats = { routed: 0, gaveUp: 0 };

beforeEach(() => {
  // A clock that stands still, so every request in a round sees the same "now".
  useManualClock(new Date(START), 60);
});

afterAll(() => {
  console.log(
    `Concurrency: ${String(stats.routed)} route requests, ${String(stats.gaveUp)} gave up with 409`,
  );
});

async function createNetwork(sites: string[], machinesPerSite: number) {
  for (const site of sites) {
    await createSite({ id: site });
    await createShippingLeadTime({ siteId: site, destination: 'DE', days: 1 });
    for (let i = 1; i <= machinesPerSite; i++) {
      await createMachine({ id: `${site}-${String(i)}`, siteId: site });
    }
  }
}

// Creates `count` draft orders, then routes them all at the same moment.
async function routeAllAtOnce(count: number) {
  const orders = [];
  for (let i = 0; i < count; i++) orders.push(await createOrder());

  const responses = await Promise.all(
    orders.map((order) => api().post(`/api/orders/${order.id}/route`)),
  );

  stats.routed += responses.length;
  stats.gaveUp += responses.filter((res) => res.status === 409).length;
  return orders.map((order, index) => ({ order, res: responses[index] }));
}

async function expectConsistent() {
  expect(await findInconsistencies()).toEqual([]);
}

describe('routing many orders at the same moment', STRESS, () => {
  it('never double-books one machine; each request succeeds or cleanly gives up', async () => {
    await createNetwork(['HAM'], 1);
    let totalSucceeded = 0;

    for (let round = 0; round < ROUNDS; round++) {
      const results = await routeAllAtOnce(10);

      for (const { order, res } of results) {
        expect([201, 409]).toContain(res?.status);

        if (res?.status === 409) {
          // Gave up: nothing was saved, so the order can simply be routed again.
          expect(await prisma.routingDecision.count({ where: { orderId: order.id } })).toBe(0);
          expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
            'DRAFT',
          );
        }
      }

      // Exactly one booked job per successful request, across all rounds so far.
      totalSucceeded += results.filter(({ res }) => res?.status === 201).length;
      expect(await prisma.job.count({ where: { status: 'PLANNED' } })).toBe(totalSucceeded);
      await expectConsistent();
    }
  });

  it('gives the first free slot to exactly one order', async () => {
    await createNetwork(['HAM'], 1);

    const results = await routeAllAtOnce(10);

    const firstSlot = new Date(START + 2 * 60 * 60 * 1000).toISOString(); // after the window
    const startingFirst = results.filter(({ res }) => {
      if (res?.status !== 201) return false;
      return OrderDecisionResultSchema.parse(res.body).decision.jobs[0]?.plannedStart === firstSlot;
    });

    expect(startingFirst).toHaveLength(1);
    await expectConsistent();
  });

  it('stays consistent across several sites and machines', async () => {
    await createNetwork(['HAM', 'LON', 'KYI'], 2);

    for (let round = 0; round < ROUNDS; round++) {
      const results = await routeAllAtOnce(20);

      expect(results.every(({ res }) => res?.status === 201 || res?.status === 409)).toBe(true);
      await expectConsistent();
    }
  });
});

describe('routing, approving and rejecting at the same moment', STRESS, () => {
  it('keeps every order, decision and job consistent', async () => {
    await createNetwork(['HAM', 'LON'], 1);

    for (let round = 0; round < ROUNDS; round++) {
      // Proposals to act on, created one by one so they all succeed.
      const proposals = [];
      for (let i = 0; i < 6; i++) {
        const order = await createOrder();
        const res = await api().post(`/api/orders/${order.id}/route`);
        proposals.push(OrderDecisionResultSchema.parse(res.body));
      }
      const newOrders = [];
      for (let i = 0; i < 6; i++) newOrders.push(await createOrder());

      // Reject half (freeing their slots), approve the other half, and route new orders
      // into the slots being freed, all at once.
      const responses = await Promise.all([
        ...proposals
          .slice(0, 3)
          .map(({ decision }) =>
            api().post(`/api/decisions/${decision.id}/reject`).send({ reason: 'Stress test' }),
          ),
        ...proposals
          .slice(3)
          .map(({ decision }) => api().post(`/api/decisions/${decision.id}/approve`)),
        ...newOrders.map((order) => api().post(`/api/orders/${order.id}/route`)),
      ]);

      expect(responses.slice(0, 6).map((res) => res.status)).toEqual([
        200, 200, 200, 200, 200, 200,
      ]);
      expect(responses.slice(6).every((res) => res.status === 201 || res.status === 409)).toBe(
        true,
      );
      await expectConsistent();
    }
  });
});

describe('the consistency check itself', () => {
  it('reports overlapping jobs when the database has them', async () => {
    // Without the constraint the database can't stop this, so it's planted directly.
    await createNetwork(['HAM'], 1);
    const order = await createOrder({ status: 'ROUTED' });
    const decision = await prisma.routingDecision.create({
      data: {
        orderId: order.id,
        kind: 'INITIAL',
        status: 'PROPOSED',
        chosenMachineId: 'HAM-1',
        explanation: 'Planted',
        createdAt: new Date(START),
      },
    });
    await prisma.job.create({
      data: {
        routingDecisionId: decision.id,
        machineId: 'HAM-1',
        plannedStart: new Date(START),
        plannedEnd: new Date(START + 60 * 60 * 1000),
      },
    });

    // A second PLANNED job for the same proposal breaks "one booked slot per proposal".
    const later = new Date(START + 2 * 60 * 60 * 1000);
    await prisma.job.create({
      data: {
        routingDecisionId: decision.id,
        machineId: 'HAM-1',
        plannedStart: later,
        plannedEnd: new Date(later.getTime() + 60 * 60 * 1000),
      },
    });

    expect(await findInconsistencies()).toEqual([`Proposal ${decision.id} has 2 PLANNED jobs`]);
  });
});
