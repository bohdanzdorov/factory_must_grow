// Failure scenarios from docs/test-scenarios.md that span several steps, checked against the
// whole database (helpers/consistency.ts) after every step, not just against responses.
import { randomUUID } from 'node:crypto';
import { OrderDecisionResultSchema, type MachineEventRequest } from '@factorymustgrow/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { retryBlockedOrdersIfRequested } from '../src/operations/blocked-orders.js';
import { api } from './helpers/api.js';
import { useManualClock } from './helpers/clock.js';
import { findInconsistencies } from './helpers/consistency.js';
import {
  createJob,
  createMachine,
  createOrder,
  createRoutingDecision,
  createShippingLeadTime,
  createSite,
} from './helpers/factories.js';

const MINUTE = 60_000;
let seq = 1;

// HAM-1 ships faster and also does 5-axis milling; LON-1 is a plain 3-axis backup.
beforeEach(async () => {
  useManualClock(new Date('2030-01-01T08:00:00.000Z'), 60);
  await createSite({ id: 'HAM' });
  await createSite({ id: 'LON' });
  await createMachine({
    id: 'HAM-1',
    siteId: 'HAM',
    capabilities: [
      { capability: 'MILLING_3_AXIS', cycleMinutesPerPart: 10 },
      { capability: 'MILLING_5_AXIS', cycleMinutesPerPart: 20 },
    ],
  });
  await createMachine({ id: 'LON-1', siteId: 'LON' });
  await createShippingLeadTime({ siteId: 'HAM', destination: 'DE', days: 1 });
  await createShippingLeadTime({ siteId: 'LON', destination: 'DE', days: 2 });
  await retryBlockedOrdersIfRequested();
});

async function route(orderId: string) {
  const res = await api().post(`/api/orders/${orderId}/route`);
  expect(res.status).toBe(201);
  return OrderDecisionResultSchema.parse(res.body);
}

async function approve(decisionId: string) {
  expect((await api().post(`/api/decisions/${decisionId}/approve`)).status).toBe(200);
}

async function event(machineId: string, type: MachineEventRequest['type']) {
  const body: MachineEventRequest = { eventId: randomUUID(), seq: seq++, type, payload: {} };
  const res = await api()
    .post(`/api/machines/${machineId}/events`)
    .set('Authorization', `Bearer ${env.INGEST_TOKEN}`)
    .send(body);
  expect(res.status).toBe(200);
  // What the background loop does a moment later in the running app.
  await retryBlockedOrdersIfRequested();
}

const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
const activeJobsOf = (orderId: string) =>
  prisma.job.findMany({
    where: { routingDecision: { orderId }, status: { in: ['PLANNED', 'RUNNING'] } },
  });

async function expectConsistent() {
  expect(await findInconsistencies()).toEqual([]);
}

it('the whole story: route, fail, reroute, approve, reset, retry', async () => {
  // 1. An order is routed to HAM-1 and approved.
  const a = await createOrder();
  const first = await route(a.id);
  expect(first.decision.chosenMachineId).toBe('HAM-1');
  await approve(first.decision.id);
  await expectConsistent();

  // 2. HAM-1 breaks. The order is rerouted to LON-1, waiting for approval.
  await event('HAM-1', 'MACHINE_FAILURE');
  expect(await orderOf(a.id)).toMatchObject({ status: 'REROUTE_PENDING' });
  await expectConsistent();

  // 3. A 5-axis order arrives. Only HAM-1 can do it, so it is blocked.
  const b = await createOrder({ requiredCapabilities: ['MILLING_5_AXIS'] });
  expect((await route(b.id)).order.status).toBe('BLOCKED');
  await expectConsistent();

  // 4. The reroute is approved: the work is now on LON-1.
  const reroute = await prisma.routingDecision.findFirstOrThrow({
    where: { orderId: a.id, kind: 'REROUTE' },
  });
  await approve(reroute.id);
  expect(await orderOf(a.id)).toMatchObject({ status: 'APPROVED' });
  expect(await activeJobsOf(a.id)).toMatchObject([{ machineId: 'LON-1' }]);
  await expectConsistent();

  // 5. HAM-1 is reset. The blocked 5-axis order gets a proposal on it.
  await event('HAM-1', 'MACHINE_RESET');
  expect(await orderOf(b.id)).toMatchObject({ status: 'ROUTED' });
  expect(await activeJobsOf(b.id)).toMatchObject([{ machineId: 'HAM-1' }]);
  await expectConsistent();
});

it('an approved reroute restarts the full quantity, with no overlap', async () => {
  // 10 parts at 10 minutes each: 100 minutes on either machine.
  const order = await createOrder({ quantity: 10 });
  const first = await route(order.id);
  await approve(first.decision.id);
  // Something else already on LON-1, so the reroute has to fit around it.
  await createJob({ machineId: 'LON-1', plannedEnd: new Date(Date.parse('2030-01-01T12:00:00Z')) });

  await event('HAM-1', 'MACHINE_FAILURE');
  const reroute = await prisma.routingDecision.findFirstOrThrow({
    where: { orderId: order.id, kind: 'REROUTE' },
  });
  await approve(reroute.id);

  const [job] = await activeJobsOf(order.id);
  expect(job?.machineId).toBe('LON-1');
  expect((job?.plannedEnd.getTime() ?? 0) - (job?.plannedStart.getTime() ?? 0)).toBe(100 * MINUTE);
  const overlaps = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) FROM job a JOIN job b ON a.machine_id = b.machine_id AND a.id < b.id
      AND tstzrange(a.planned_start, a.planned_end) && tstzrange(b.planned_start, b.planned_end)
    WHERE a.status IN ('PLANNED', 'RUNNING') AND b.status IN ('PLANNED', 'RUNNING')
  `;
  expect(overlaps[0]?.count).toBe(0n);
});

it('a failure arriving after its site already went down releases nothing twice', async () => {
  const order = await createOrder();
  const first = await route(order.id);
  await approve(first.decision.id);
  await api().post('/api/sites/HAM/status').send({ status: 'DOWN' });
  await retryBlockedOrdersIfRequested();
  const decisionsAfterSiteDown = await prisma.routingDecision.count({
    where: { orderId: order.id },
  });

  await event('HAM-1', 'MACHINE_FAILURE');

  expect(await prisma.machine.findUniqueOrThrow({ where: { id: 'HAM-1' } })).toMatchObject({
    status: 'ERROR',
  });
  expect(await prisma.routingDecision.count({ where: { orderId: order.id } })).toBe(
    decisionsAfterSiteDown,
  );
  expect(await orderOf(order.id)).toMatchObject({ status: 'REROUTE_PENDING' });
  await expectConsistent();
});

describe('the consistency check catches failure problems', () => {
  it('an active job left on a broken machine', async () => {
    await prisma.machine.update({ where: { id: 'HAM-1' }, data: { status: 'ERROR' } });
    const job = await createJob({ machineId: 'HAM-1' });

    expect(await findInconsistencies()).toContain(
      `Job ${job.id} is still active on failed machine HAM-1`,
    );
  });

  it("a reroute that doesn't replace a decision of its own order", async () => {
    const decision = await createRoutingDecision({ kind: 'REROUTE', status: 'REJECTED' });

    expect(await findInconsistencies()).toContain(
      `Reroute ${decision.id} doesn't replace a decision of order ${decision.orderId}`,
    );
  });

  it('a blocked order with no reason in its decisions', async () => {
    const order = await createOrder({ status: 'BLOCKED' });

    expect(await findInconsistencies()).toContain(
      `Order ${order.id} is BLOCKED with no reason in its decisions`,
    );
  });
});
