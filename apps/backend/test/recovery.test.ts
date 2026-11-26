// Failed machines coming back, blocked orders getting another chance, and sites going down
// and coming back up.
import { randomUUID } from 'node:crypto';
import {
  OrderDecisionResultSchema,
  SiteSchema,
  type MachineEventRequest,
  type ReportedMachineState,
} from '@factorymustgrow/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import type { MachineStatus } from '../src/generated/prisma/enums.js';
import { retryBlockedOrdersIfRequested } from '../src/operations/blocked-orders.js';
import { api } from './helpers/api.js';
import { useManualClock } from './helpers/clock.js';
import {
  createMachine,
  createOrder,
  createShippingLeadTime,
  createSite,
} from './helpers/factories.js';

const DAY = 24 * 60 * 60_000;
const T0 = new Date('2030-01-01T08:00:00.000Z');
const AUTH = `Bearer ${env.INGEST_TOKEN}`;
let seq = 1;

// Hamburg ships faster, so routing prefers HAM-1; LON-1 is the backup.
beforeEach(async () => {
  useManualClock(T0, 60);
  await createSite({ id: 'HAM' });
  await createSite({ id: 'LON' });
  await createMachine({ id: 'HAM-1', siteId: 'HAM' });
  await createMachine({ id: 'LON-1', siteId: 'LON' });
  await createShippingLeadTime({ siteId: 'HAM', destination: 'DE', days: 1 });
  await createShippingLeadTime({ siteId: 'LON', destination: 'DE', days: 2 });
  // Clears a retry request left by a previous test.
  await retryBlockedOrdersIfRequested();
});

function heartbeat(machineId: string, state: ReportedMachineState) {
  return api()
    .post(`/api/machines/${machineId}/heartbeat`)
    .set('Authorization', AUTH)
    .send({ state, jobId: null });
}

function sendEvent(machineId: string, event: Partial<MachineEventRequest> = {}) {
  const body: MachineEventRequest = {
    eventId: randomUUID(),
    seq: seq++,
    type: 'MACHINE_RESET',
    payload: {},
    ...event,
  };
  return api().post(`/api/machines/${machineId}/events`).set('Authorization', AUTH).send(body);
}

function setSiteStatus(siteId: string, status: unknown) {
  return api().post(`/api/sites/${siteId}/status`).send({ status });
}

async function setStatus(machineId: string, status: MachineStatus) {
  await prisma.machine.update({ where: { id: machineId }, data: { status } });
}

const statusOf = (machineId: string) =>
  prisma.machine.findUniqueOrThrow({ where: { id: machineId } }).then((m) => m.status);
const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
const decisionCount = (orderId: string) => prisma.routingDecision.count({ where: { orderId } });

// An order that can't be routed right now: both machines are broken.
async function blockedOrder(overrides: { deadline?: Date } = {}) {
  await setStatus('HAM-1', 'ERROR');
  await setStatus('LON-1', 'ERROR');
  const order = await createOrder(overrides);
  const res = await api().post(`/api/orders/${order.id}/route`);
  expect(OrderDecisionResultSchema.parse(res.body).order.status).toBe('BLOCKED');
  return order;
}

describe('a new machine', () => {
  it('starts OFFLINE until it is heard from, and its first heartbeat brings it online', async () => {
    const site = await createSite();
    await prisma.machine.create({ data: { id: 'NEW-1', siteId: site.id, name: 'New' } });
    expect(await statusOf('NEW-1')).toBe('OFFLINE');

    await heartbeat('NEW-1', 'IDLE');

    expect(await statusOf('NEW-1')).toBe('IDLE');
  });
});

describe('MACHINE_RESET', () => {
  it.each<MachineStatus>(['ERROR', 'OFFLINE'])(
    'brings a %s machine back to IDLE',
    async (status) => {
      await setStatus('HAM-1', status);

      const res = await sendEvent('HAM-1');

      expect(res.status).toBe(200);
      expect(await statusOf('HAM-1')).toBe('IDLE');
    },
  );

  it("doesn't act on a stale reset", async () => {
    await prisma.machine.update({
      where: { id: 'HAM-1' },
      data: { status: 'ERROR', lastSeq: 1000n },
    });

    await sendEvent('HAM-1', { seq: 999 });

    expect(await statusOf('HAM-1')).toBe('ERROR');
  });

  it("doesn't act on a duplicate reset", async () => {
    await setStatus('HAM-1', 'ERROR');
    const eventId = randomUUID();
    await sendEvent('HAM-1', { eventId, seq: 500 });
    // It broke again since.
    await setStatus('HAM-1', 'ERROR');

    await sendEvent('HAM-1', { eventId, seq: 500 });

    expect(await statusOf('HAM-1')).toBe('ERROR');
  });

  it('leaves a reset machine OFFLINE while its site is down', async () => {
    await setStatus('HAM-1', 'ERROR');
    await prisma.site.update({ where: { id: 'HAM' }, data: { status: 'DOWN' } });

    await sendEvent('HAM-1');

    expect(await statusOf('HAM-1')).toBe('OFFLINE');
  });
});

describe('a heartbeat from an OFFLINE machine', () => {
  it('brings it back to IDLE when it says IDLE', async () => {
    await setStatus('HAM-1', 'OFFLINE');

    await heartbeat('HAM-1', 'IDLE');

    expect(await statusOf('HAM-1')).toBe('IDLE');
  });

  it('leaves it OFFLINE while it says RUNNING (a job that was moved elsewhere)', async () => {
    await setStatus('HAM-1', 'OFFLINE');

    await heartbeat('HAM-1', 'RUNNING');

    expect(await statusOf('HAM-1')).toBe('OFFLINE');
  });

  it('marks it ERROR when it says ERROR', async () => {
    await setStatus('HAM-1', 'OFFLINE');

    await heartbeat('HAM-1', 'ERROR');

    expect(await statusOf('HAM-1')).toBe('ERROR');
  });

  it('leaves it OFFLINE while its site is down', async () => {
    await setStatus('HAM-1', 'OFFLINE');
    await prisma.site.update({ where: { id: 'HAM' }, data: { status: 'DOWN' } });

    await heartbeat('HAM-1', 'IDLE');

    expect(await statusOf('HAM-1')).toBe('OFFLINE');
  });
});

describe('retrying blocked orders', () => {
  it('routes a blocked order once a machine that fits comes back', async () => {
    const order = await blockedOrder();

    await sendEvent('HAM-1');
    const routed = await retryBlockedOrdersIfRequested();

    expect(routed).toEqual([order.id]);
    expect(await orderOf(order.id)).toMatchObject({ status: 'ROUTED', blockedReason: null });
    // The test clock stands still, so both decisions share createdAt: look up the proposal.
    const latest = await prisma.routingDecision.findFirstOrThrow({
      where: { orderId: order.id, status: { not: 'NO_ELIGIBLE_MACHINE' } },
      include: { jobs: true },
    });
    expect(latest).toMatchObject({ status: 'PROPOSED', chosenMachineId: 'HAM-1' });
    expect(latest.jobs).toMatchObject([{ machineId: 'HAM-1', status: 'PLANNED' }]);
  });

  it('also runs after a machine comes back through its heartbeat', async () => {
    const order = await blockedOrder();
    await setStatus('HAM-1', 'OFFLINE');

    await heartbeat('HAM-1', 'IDLE');

    expect(await retryBlockedOrdersIfRequested()).toEqual([order.id]);
  });

  it('leaves an order that still fits nowhere BLOCKED, and saves no new decision', async () => {
    // Needs 5-axis milling; no machine has it.
    await setStatus('HAM-1', 'ERROR');
    const order = await createOrder({ requiredCapabilities: ['MILLING_5_AXIS'] });
    await api().post(`/api/orders/${order.id}/route`);
    expect(await decisionCount(order.id)).toBe(1);

    await sendEvent('HAM-1');
    expect(await retryBlockedOrdersIfRequested()).toEqual([]);

    expect(await orderOf(order.id)).toMatchObject({ status: 'BLOCKED' });
    expect(await decisionCount(order.id)).toBe(1);
  });

  it('routes the most urgent order first, so it gets the earliest slot', async () => {
    const later = await blockedOrder({ deadline: new Date(T0.getTime() + 7 * DAY) });
    const urgent = await blockedOrder({ deadline: new Date(T0.getTime() + 5 * DAY) });

    await sendEvent('HAM-1');
    await retryBlockedOrdersIfRequested();

    const jobOf = (orderId: string) =>
      prisma.job.findFirstOrThrow({ where: { routingDecision: { orderId } } });
    expect((await jobOf(urgent.id)).plannedStart.getTime()).toBeLessThan(
      (await jobOf(later.id)).plannedStart.getTime(),
    );
  });

  it('only runs after a machine came back', async () => {
    const order = await blockedOrder();
    // A heartbeat from a machine that is already working is not a recovery.
    await setStatus('LON-1', 'IDLE');
    await heartbeat('LON-1', 'IDLE');

    expect(await retryBlockedOrdersIfRequested()).toEqual([]);
    expect(await orderOf(order.id)).toMatchObject({ status: 'BLOCKED' });
  });
});

describe('POST /api/sites/:id/status', () => {
  async function approvedOrderOnHamburg() {
    const order = await createOrder();
    const routed = await api().post(`/api/orders/${order.id}/route`);
    const decision = OrderDecisionResultSchema.parse(routed.body).decision;
    expect(decision.chosenMachineId).toBe('HAM-1');
    await api().post(`/api/decisions/${decision.id}/approve`);
    return order;
  }

  it('takes a site down: its machines go OFFLINE and their work moves elsewhere', async () => {
    const order = await approvedOrderOnHamburg();

    const res = await setSiteStatus('HAM', 'DOWN');

    expect(res.status).toBe(200);
    expect(SiteSchema.parse(res.body)).toMatchObject({ id: 'HAM', status: 'DOWN' });
    expect(await statusOf('HAM-1')).toBe('OFFLINE');
    expect(await orderOf(order.id)).toMatchObject({ status: 'REROUTE_PENDING' });
    const reroute = await prisma.routingDecision.findFirstOrThrow({
      where: { orderId: order.id, kind: 'REROUTE' },
    });
    expect(reroute.chosenMachineId).toBe('LON-1');
    expect(reroute.explanation).toMatch(/^Machine HAM-1 failed \(OFFLINE\): site HAM is down\./);
  });

  it('leaves a machine in ERROR as ERROR: it still needs a reset', async () => {
    await setStatus('HAM-1', 'ERROR');

    await setSiteStatus('HAM', 'DOWN');

    expect(await statusOf('HAM-1')).toBe('ERROR');
  });

  it('changes nothing when the site is already down', async () => {
    const order = await approvedOrderOnHamburg();
    await setSiteStatus('HAM', 'DOWN');
    const decisions = await decisionCount(order.id);

    const res = await setSiteStatus('HAM', 'DOWN');

    expect(res.status).toBe(200);
    expect(await decisionCount(order.id)).toBe(decisions);
  });

  it('brings a site back up; its machines return on their next heartbeat', async () => {
    await setSiteStatus('HAM', 'DOWN');
    const order = await blockedOrder();
    await setStatus('HAM-1', 'OFFLINE');

    const res = await setSiteStatus('HAM', 'UP');
    expect(SiteSchema.parse(res.body).status).toBe('UP');
    expect(await statusOf('HAM-1')).toBe('OFFLINE');

    await heartbeat('HAM-1', 'IDLE');

    expect(await statusOf('HAM-1')).toBe('IDLE');
    expect(await retryBlockedOrdersIfRequested()).toEqual([order.id]);
  });

  it('gives 404 for an unknown site', async () => {
    expect((await setSiteStatus('NOWHERE', 'DOWN')).status).toBe(404);
  });

  it('gives 400 for an unknown status', async () => {
    expect((await setSiteStatus('HAM', 'SIDEWAYS')).status).toBe(400);
  });
});
