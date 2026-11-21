// What happens to a failed machine's work: jobs are freed and each order gets a reroute
// proposal on another machine, or is blocked with a reason. Nothing is lost.
import { randomUUID } from 'node:crypto';
import { OrderDecisionResultSchema, type MachineEventRequest } from '@factorymustgrow/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import type { ManualClock } from '../src/domain/clock.js';
import { markSilentMachinesOffline } from '../src/services/heartbeat-monitor.service.js';
import { api } from './helpers/api.js';
import { useManualClock } from './helpers/clock.js';
import {
  createCommand,
  createJob,
  createMachine,
  createOrder,
  createShippingLeadTime,
  createSite,
} from './helpers/factories.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const T0 = new Date('2030-01-01T08:00:00.000Z');

let clock: ManualClock;
let seq = 1;

// Hamburg ships to Germany in 1 day, London in 2, so routing prefers HAM-1 and LON-1 is the
// backup. Both are 3-axis mills, the default test order's capability.
beforeEach(async () => {
  clock = useManualClock(T0, 60);
  await createSite({ id: 'HAM' });
  await createSite({ id: 'LON' });
  await createMachine({ id: 'HAM-1', siteId: 'HAM' });
  await createMachine({ id: 'LON-1', siteId: 'LON' });
  await createShippingLeadTime({ siteId: 'HAM', destination: 'DE', days: 1 });
  await createShippingLeadTime({ siteId: 'LON', destination: 'DE', days: 2 });
});

async function route(orderId: string) {
  const res = await api().post(`/api/orders/${orderId}/route`);
  expect(res.status).toBe(201);
  return OrderDecisionResultSchema.parse(res.body).decision;
}

async function approve(decisionId: string) {
  const res = await api().post(`/api/decisions/${decisionId}/approve`);
  expect(res.status).toBe(200);
}

// An order routed (to HAM-1) and approved.
async function approvedOrder(overrides: { deadline?: Date } = {}) {
  const order = await createOrder(overrides);
  const decision = await route(order.id);
  await approve(decision.id);
  return { order, decision, jobId: decision.jobs[0]?.id ?? '' };
}

function reportFailure(machineId: string, event: Partial<MachineEventRequest> = {}) {
  const body: MachineEventRequest = {
    eventId: randomUUID(),
    seq: seq++,
    type: 'MACHINE_FAILURE',
    payload: {},
    ...event,
  };
  return api()
    .post(`/api/machines/${machineId}/events`)
    .set('Authorization', `Bearer ${env.INGEST_TOKEN}`)
    .send(body);
}

// Makes the machine look silent for longer than the heartbeat timeout, then runs the monitor.
async function goSilent(machineId: string) {
  await prisma.machine.update({ where: { id: machineId }, data: { lastHeartbeatAt: clock.now() } });
  clock.advance(10 * MINUTE + 1);
  return markSilentMachinesOffline();
}

const job = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });
const order = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
const decisionsOf = (orderId: string) =>
  prisma.routingDecision.findMany({
    where: { orderId },
    include: { jobs: true },
    orderBy: { createdAt: 'asc' },
  });
const latestDecision = async (orderId: string) => (await decisionsOf(orderId)).at(-1);

describe('an approved order on the failed machine', () => {
  it('releases the job and proposes another machine, linked to the old decision', async () => {
    const { order: o, decision: old, jobId } = await approvedOrder();

    const res = await reportFailure('HAM-1');

    expect(res.status).toBe(200);
    expect(await job(jobId)).toMatchObject({ status: 'RELEASED', machineId: 'HAM-1' });
    const decisions = await decisionsOf(o.id);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toMatchObject({ id: old.id, status: 'APPROVED' });
    expect(decisions[1]).toMatchObject({
      kind: 'REROUTE',
      status: 'PROPOSED',
      chosenMachineId: 'LON-1',
      supersedesId: old.id,
    });
    expect(decisions[1]?.explanation).toMatch(/^Machine HAM-1 failed \(ERROR\)\. /);
    expect(decisions[1]?.jobs).toMatchObject([{ machineId: 'LON-1', status: 'PLANNED' }]);
    expect(await order(o.id)).toMatchObject({ status: 'REROUTE_PENDING', blockedReason: null });
  });

  it('can be approved again on the new machine', async () => {
    const { order: o } = await approvedOrder();
    await reportFailure('HAM-1');

    await approve((await latestDecision(o.id))?.id ?? '');

    expect(await order(o.id)).toMatchObject({ status: 'APPROVED' });
  });
});

describe('a proposal waiting for approval on the failed machine', () => {
  it('supersedes the proposal, frees its slot, and proposes another machine', async () => {
    const o = await createOrder();
    const old = await route(o.id);

    await reportFailure('HAM-1');

    const decisions = await decisionsOf(o.id);
    expect(decisions[0]).toMatchObject({ id: old.id, status: 'SUPERSEDED' });
    expect(decisions[0]?.jobs).toMatchObject([{ status: 'CANCELLED' }]);
    expect(decisions[1]).toMatchObject({
      kind: 'REROUTE',
      status: 'PROPOSED',
      chosenMachineId: 'LON-1',
      supersedesId: old.id,
    });
    expect(await order(o.id)).toMatchObject({ status: 'REROUTE_PENDING' });
  });

  it('refuses to approve the superseded proposal afterwards', async () => {
    const o = await createOrder();
    const old = await route(o.id);
    await reportFailure('HAM-1');

    const res = await api().post(`/api/decisions/${old.id}/approve`);

    expect(res.status).toBe(409);
  });

  it('replaces a reroute proposal whose new machine fails too', async () => {
    const { order: o } = await approvedOrder();
    await reportFailure('HAM-1');
    const firstReroute = await latestDecision(o.id);

    await createMachine({ id: 'LON-2', siteId: 'LON' });
    await reportFailure('LON-1');

    const decisions = await decisionsOf(o.id);
    expect(decisions).toHaveLength(3);
    expect(decisions[1]).toMatchObject({ id: firstReroute?.id, status: 'SUPERSEDED' });
    expect(decisions[2]).toMatchObject({
      kind: 'REROUTE',
      chosenMachineId: 'LON-2',
      supersedesId: firstReroute?.id,
    });
    expect(await order(o.id)).toMatchObject({ status: 'REROUTE_PENDING' });
  });
});

it('releases a running job (order IN_PRODUCTION) and reroutes it', async () => {
  const { order: o, jobId } = await approvedOrder();
  await prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING' } });
  await prisma.order.update({ where: { id: o.id }, data: { status: 'IN_PRODUCTION' } });

  await reportFailure('HAM-1');

  expect(await job(jobId)).toMatchObject({ status: 'RELEASED' });
  expect(await order(o.id)).toMatchObject({ status: 'REROUTE_PENDING' });
});

it('blocks the order with a reason when no other machine fits, and keeps the job', async () => {
  await prisma.machine.update({ where: { id: 'LON-1' }, data: { status: 'ERROR' } });
  const { order: o, jobId } = await approvedOrder();

  await reportFailure('HAM-1');

  expect(await job(jobId)).toMatchObject({ status: 'RELEASED' });
  expect(await latestDecision(o.id)).toMatchObject({
    kind: 'REROUTE',
    status: 'NO_ELIGIBLE_MACHINE',
    chosenMachineId: null,
    jobs: [],
  });
  const blocked = await order(o.id);
  expect(blocked.status).toBe('BLOCKED');
  expect(blocked.blockedReason).toMatch(/^Machine HAM-1 failed \(ERROR\)\. /);
});

it('reroutes the most urgent order first, so it gets the earliest free slot', async () => {
  const later = await approvedOrder({ deadline: new Date(T0.getTime() + 7 * DAY) });
  const urgent = await approvedOrder({ deadline: new Date(T0.getTime() + 5 * DAY) });

  await reportFailure('HAM-1');

  const urgentJob = (await latestDecision(urgent.order.id))?.jobs[0];
  const laterJob = (await latestDecision(later.order.id))?.jobs[0];
  expect(urgentJob?.machineId).toBe('LON-1');
  expect(laterJob?.machineId).toBe('LON-1');
  expect(urgentJob?.plannedStart.getTime()).toBeLessThan(laterJob?.plannedStart.getTime() ?? 0);
});

it("leaves other machines' jobs and finished jobs alone", async () => {
  const onLondon = await createJob({ machineId: 'LON-1' });
  const finished = await createJob({ machineId: 'HAM-1', status: 'COMPLETE' });

  await reportFailure('HAM-1');

  expect(await job(onLondon.id)).toMatchObject({ status: 'PLANNED' });
  expect(await job(finished.id)).toMatchObject({ status: 'COMPLETE' });
});

it('does nothing more when the machine has no active jobs', async () => {
  const res = await reportFailure('HAM-1');

  expect(res.status).toBe(200);
  expect(await prisma.routingDecision.count()).toBe(0);
});

describe('commands', () => {
  const startPayload = (jobId: string) => ({
    jobId,
    plannedStart: T0.toISOString(),
    plannedEnd: new Date(T0.getTime() + 60 * MINUTE).toISOString(),
  });
  const status = (id: string) =>
    prisma.command.findUniqueOrThrow({ where: { id } }).then((command) => command.status);

  it("cancels the machine's open START_JOBs, but keeps RESET and CANCEL_JOB", async () => {
    const start = await createCommand({
      machineId: 'HAM-1',
      type: 'START_JOB',
      payload: startPayload('job-1'),
    });
    const reset = await createCommand({ machineId: 'HAM-1', type: 'RESET' });
    const cancel = await createCommand({
      machineId: 'HAM-1',
      type: 'CANCEL_JOB',
      payload: { jobId: 'job-0' },
    });
    const otherMachine = await createCommand({
      machineId: 'LON-1',
      type: 'START_JOB',
      payload: startPayload('job-2'),
    });

    await reportFailure('HAM-1');

    expect(await status(start.id)).toBe('CANCELLED');
    expect(await status(reset.id)).toBe('PENDING');
    expect(await status(cancel.id)).toBe('PENDING');
    expect(await status(otherMachine.id)).toBe('PENDING');
  });

  const cancelJobsFor = (jobId: string) =>
    prisma.command.findMany({
      where: {
        machineId: 'HAM-1',
        type: 'CANCEL_JOB',
        payload: { path: ['jobId'], equals: jobId },
      },
    });

  it('queues a CANCEL_JOB when an OFFLINE machine may have started the job', async () => {
    const { jobId } = await approvedOrder();
    await createCommand({
      machineId: 'HAM-1',
      type: 'START_JOB',
      payload: startPayload(jobId),
      status: 'DELIVERED',
    });

    await goSilent('HAM-1');

    expect(await cancelJobsFor(jobId)).toMatchObject([{ status: 'PENDING' }]);
  });

  it('queues a CANCEL_JOB for a job that was RUNNING on an OFFLINE machine', async () => {
    const { jobId } = await approvedOrder();
    await prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING' } });

    await goSilent('HAM-1');

    expect(await cancelJobsFor(jobId)).toHaveLength(1);
  });

  it("doesn't queue a CANCEL_JOB for a job the OFFLINE machine never got", async () => {
    const { jobId } = await approvedOrder();

    await goSilent('HAM-1');

    expect(await cancelJobsFor(jobId)).toEqual([]);
  });

  it("doesn't queue a CANCEL_JOB when the machine reported ERROR", async () => {
    const { jobId } = await approvedOrder();
    await prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING' } });

    await reportFailure('HAM-1');

    expect(await cancelJobsFor(jobId)).toEqual([]);
  });
});

describe('both ways of finding out, and running twice', () => {
  it('reroutes when the machine goes silent too', async () => {
    const { order: o, jobId } = await approvedOrder();

    expect(await goSilent('HAM-1')).toEqual(['HAM-1']);

    expect(await job(jobId)).toMatchObject({ status: 'RELEASED' });
    expect(await latestDecision(o.id)).toMatchObject({ kind: 'REROUTE', chosenMachineId: 'LON-1' });
    expect((await latestDecision(o.id))?.explanation).toMatch(/failed \(OFFLINE\)/);
    expect(await order(o.id)).toMatchObject({ status: 'REROUTE_PENDING' });
  });

  it('a second failure report creates no second reroute', async () => {
    const { order: o } = await approvedOrder();
    await reportFailure('HAM-1');

    await reportFailure('HAM-1');

    expect(await decisionsOf(o.id)).toHaveLength(2);
  });

  it('a duplicate failure event creates no second reroute', async () => {
    const { order: o } = await approvedOrder();
    const eventId = randomUUID();
    await reportFailure('HAM-1', { eventId, seq: 500 });

    await reportFailure('HAM-1', { eventId, seq: 500 });

    expect(await decisionsOf(o.id)).toHaveLength(2);
  });

  it('a machine going silent, then reporting ERROR, is rerouted only once', async () => {
    const { order: o } = await approvedOrder();
    await goSilent('HAM-1');

    await reportFailure('HAM-1');

    expect(await prisma.machine.findUniqueOrThrow({ where: { id: 'HAM-1' } })).toMatchObject({
      status: 'ERROR',
    });
    expect(await decisionsOf(o.id)).toHaveLength(2);
  });
});
