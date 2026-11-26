// Races between failures and bookings. They can't be timed reliably, so they are forced:
// - the machine list routing reads is made stale, as if the machine failed just after it was
//   read (routing must notice before booking and pick another machine);
// - a job insert fails with a deadlock, as if another request booked at the same instant
//   (the reroute must roll back and run again);
// - failure handling or a reroute crashes with an unexpected error (everything it did must
//   roll back, and a later attempt must still work).
import { randomUUID } from 'node:crypto';
import { OrderDecisionResultSchema, type MachineEventRequest } from '@factorymustgrow/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import type * as JobsModel from '../src/models/jobs.model.js';
import type * as MachinesModel from '../src/models/machines.model.js';
import {
  requestBlockedOrderRetry,
  retryBlockedOrdersIfRequested,
} from '../src/operations/blocked-orders.js';
import { api } from './helpers/api.js';
import { findInconsistencies } from './helpers/consistency.js';
import { useManualClock } from './helpers/clock.js';
import {
  createMachine,
  createOrder,
  createShippingLeadTime,
  createSite,
} from './helpers/factories.js';

const forced = vi.hoisted(() => ({
  // How many next machine-list reads show this machine as IDLE whatever its real status.
  staleIdle: { machineId: '', reads: 0 },
  // How many next job inserts fail with Prisma's deadlock error (P2034).
  deadlocks: 0,
  // How many next job inserts crash with an unexpected error.
  insertCrashes: 0,
  // How many next job status changes crash with an unexpected error.
  statusCrashes: 0,
}));

vi.mock('../src/models/machines.model.js', async (importOriginal) => {
  const actual = await importOriginal<typeof MachinesModel>();
  return {
    ...actual,
    machinesModel: (db: Parameters<typeof actual.machinesModel>[0]) => {
      const model = actual.machinesModel(db);
      return {
        ...model,
        findMany: async (filter: { siteId?: string }) => {
          const machines = await model.findMany(filter);
          if (forced.staleIdle.reads === 0) return machines;
          forced.staleIdle.reads -= 1;
          return machines.map((machine) =>
            machine.id === forced.staleIdle.machineId
              ? { ...machine, status: 'IDLE' as const }
              : machine,
          );
        },
      };
    },
  };
});

vi.mock('../src/models/jobs.model.js', async (importOriginal) => {
  const actual = await importOriginal<typeof JobsModel>();
  const { Prisma } = await import('../src/generated/prisma/client.js');
  return {
    ...actual,
    jobsModel: (db: Parameters<typeof actual.jobsModel>[0]) => {
      const model = actual.jobsModel(db);
      return {
        ...model,
        insert: (data: JobsModel.NewJob) => {
          if (forced.deadlocks > 0) {
            forced.deadlocks -= 1;
            return Promise.reject(
              new Prisma.PrismaClientKnownRequestError('Transaction failed due to a deadlock', {
                code: 'P2034',
                clientVersion: 'test',
              }),
            );
          }
          if (forced.insertCrashes > 0) {
            forced.insertCrashes -= 1;
            return Promise.reject(new Error('Disk full'));
          }
          return model.insert(data);
        },
        changeStatusIfActive: (
          id: string,
          to: Parameters<typeof model.changeStatusIfActive>[1],
        ) => {
          if (forced.statusCrashes > 0) {
            forced.statusCrashes -= 1;
            return Promise.reject(new Error('Disk full'));
          }
          return model.changeStatusIfActive(id, to);
        },
      };
    },
  };
});

beforeEach(async () => {
  forced.staleIdle = { machineId: '', reads: 0 };
  forced.deadlocks = 0;
  forced.insertCrashes = 0;
  forced.statusCrashes = 0;
  await retryBlockedOrdersIfRequested();
  useManualClock(new Date('2030-01-01T08:00:00.000Z'), 60);
  // HAM-1 ships faster, so routing prefers it; LON-1 is the backup.
  await createSite({ id: 'HAM' });
  await createSite({ id: 'LON' });
  await createMachine({ id: 'HAM-1', siteId: 'HAM' });
  await createMachine({ id: 'LON-1', siteId: 'LON' });
  await createShippingLeadTime({ siteId: 'HAM', destination: 'DE', days: 1 });
  await createShippingLeadTime({ siteId: 'LON', destination: 'DE', days: 2 });
});

describe('a machine that fails while routing is choosing it', () => {
  it('is noticed before booking, and routing picks another machine', async () => {
    await prisma.machine.update({ where: { id: 'HAM-1' }, data: { status: 'ERROR' } });
    // The first routing attempt still sees HAM-1 as IDLE.
    forced.staleIdle = { machineId: 'HAM-1', reads: 1 };
    const order = await createOrder();

    const res = await api().post(`/api/orders/${order.id}/route`);

    expect(res.status).toBe(201);
    expect(OrderDecisionResultSchema.parse(res.body).decision.chosenMachineId).toBe('LON-1');
    expect(await prisma.job.count({ where: { machineId: 'HAM-1' } })).toBe(0);
    expect(await prisma.routingDecision.count()).toBe(1);
  });

  it('gives up with 409 if it keeps happening', async () => {
    await prisma.machine.update({ where: { id: 'HAM-1' }, data: { status: 'ERROR' } });
    forced.staleIdle = { machineId: 'HAM-1', reads: 100 };
    const order = await createOrder();

    const res = await api().post(`/api/orders/${order.id}/route`);

    expect(res.status).toBe(409);
    expect(await prisma.routingDecision.count()).toBe(0);
  });
});

it('a reroute runs again when its booking clashes', async () => {
  const order = await createOrder();
  const routed = await api().post(`/api/orders/${order.id}/route`);
  const decisionId = OrderDecisionResultSchema.parse(routed.body).decision.id;
  await api().post(`/api/decisions/${decisionId}/approve`);

  const event: MachineEventRequest = {
    eventId: randomUUID(),
    seq: 1,
    type: 'MACHINE_FAILURE',
    payload: {},
  };
  const res = await api()
    .post('/api/machines/HAM-1/events')
    .set('Authorization', `Bearer ${env.INGEST_TOKEN}`)
    .send(event);
  expect(res.status).toBe(200);

  // The background retry reroutes the order; its first booking fails as a deadlock.
  forced.deadlocks = 1;
  await retryBlockedOrdersIfRequested();

  expect(forced.deadlocks).toBe(0);
  // Everything happened exactly once: one event, one reroute.
  expect(await prisma.machineEvent.count()).toBe(1);
  expect(await prisma.routingDecision.count({ where: { orderId: order.id } })).toBe(2);
  expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
    status: 'REROUTE_PENDING',
  });
});

// An order routed to HAM-1 and approved.
async function approvedOnHamburg(deadlineDays = 7) {
  const order = await createOrder({
    deadline: new Date(Date.parse('2030-01-01T08:00:00.000Z') + deadlineDays * 86_400_000),
  });
  const routed = await api().post(`/api/orders/${order.id}/route`);
  const decision = OrderDecisionResultSchema.parse(routed.body).decision;
  await api().post(`/api/decisions/${decision.id}/approve`);
  return { order, jobId: decision.jobs[0]?.id ?? '' };
}

function sendFailure(eventId: string) {
  const event: MachineEventRequest = { eventId, seq: 1, type: 'MACHINE_FAILURE', payload: {} };
  return api()
    .post('/api/machines/HAM-1/events')
    .set('Authorization', `Bearer ${env.INGEST_TOKEN}`)
    .send(event);
}

describe('a crash midway through failure handling', () => {
  it('rolls everything back, and the resent event then works', async () => {
    const { order, jobId } = await approvedOnHamburg();
    const eventId = randomUUID();
    forced.statusCrashes = 1;

    const crashed = await sendFailure(eventId);

    // Nothing at all was saved: not the status, not the event, not the freed job.
    expect(crashed.status).toBe(500);
    expect(await prisma.machine.findUniqueOrThrow({ where: { id: 'HAM-1' } })).toMatchObject({
      status: 'IDLE',
    });
    expect(await prisma.machineEvent.count()).toBe(0);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({
      status: 'PLANNED',
    });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: 'APPROVED',
    });

    // The simulator resends the same event, which now goes through once.
    const resent = await sendFailure(eventId);
    await retryBlockedOrdersIfRequested();

    expect(resent.status).toBe(200);
    expect(await prisma.machineEvent.count()).toBe(1);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: 'REROUTE_PENDING',
    });
    expect(await findInconsistencies()).toEqual([]);
  });
});

describe('a crash while rerouting one of several orders', () => {
  it('reroutes the others, leaves that one BLOCKED, and the next retry finishes it', async () => {
    const urgent = await approvedOnHamburg(5);
    const later = await approvedOnHamburg(7);
    await sendFailure(randomUUID());
    // The first reroute (the most urgent order) crashes while booking.
    forced.insertCrashes = 1;

    expect(await retryBlockedOrdersIfRequested()).toEqual([later.order.id]);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: urgent.order.id } })).toMatchObject({
      status: 'BLOCKED',
      blockedReason: 'Machine HAM-1 failed (ERROR).',
    });

    // The failed retry asked for another one.
    expect(await retryBlockedOrdersIfRequested()).toEqual([urgent.order.id]);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: urgent.order.id } })).toMatchObject({
      status: 'REROUTE_PENDING',
    });
    expect(await findInconsistencies()).toEqual([]);
  });

  it('stops asking again after 3 crashes in a row, and tries once more on the next trigger', async () => {
    const { order } = await approvedOnHamburg(5);
    await sendFailure(randomUUID());
    // Every reroute crashes from now on.
    forced.insertCrashes = 100;

    // The failure's retry, then the two more it asks for.
    for (let run = 0; run < 3; run++) {
      expect(await retryBlockedOrdersIfRequested()).toEqual([]);
    }
    expect(forced.insertCrashes).toBe(97);

    // The third crash in a row asked for nothing, so no retry runs.
    await retryBlockedOrdersIfRequested();
    expect(forced.insertCrashes).toBe(97);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'BLOCKED',
    );

    // Something else asks for a retry (a machine coming back, say), and this time it works.
    forced.insertCrashes = 0;
    requestBlockedOrderRetry();
    expect(await retryBlockedOrdersIfRequested()).toEqual([order.id]);
    expect(await findInconsistencies()).toEqual([]);
  });
});
