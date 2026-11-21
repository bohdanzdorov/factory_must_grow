// Races between failures and bookings. They can't be timed reliably, so they are forced:
// - the machine list routing reads is made stale, as if the machine failed just after it was
//   read (routing must notice before booking and pick another machine);
// - a job insert fails with a deadlock, as if another request booked at the same instant
//   (failure handling must roll back and run again).
import { randomUUID } from 'node:crypto';
import { OrderDecisionResultSchema, type MachineEventRequest } from '@factorymustgrow/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import type * as JobsModel from '../src/models/jobs.model.js';
import type * as MachinesModel from '../src/models/machines.model.js';
import { api } from './helpers/api.js';
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
          return model.insert(data);
        },
      };
    },
  };
});

beforeEach(async () => {
  forced.staleIdle = { machineId: '', reads: 0 };
  forced.deadlocks = 0;
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

it('failure handling runs again when its reroute booking clashes', async () => {
  const order = await createOrder();
  const routed = await api().post(`/api/orders/${order.id}/route`);
  const decisionId = OrderDecisionResultSchema.parse(routed.body).decision.id;
  await api().post(`/api/decisions/${decisionId}/approve`);
  // The reroute's first booking fails as a deadlock.
  forced.deadlocks = 1;

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
  expect(forced.deadlocks).toBe(0);
  // Everything happened exactly once: one event, one reroute.
  expect(await prisma.machineEvent.count()).toBe(1);
  expect(await prisma.routingDecision.count({ where: { orderId: order.id } })).toBe(2);
  expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
    status: 'REROUTE_PENDING',
  });
});
