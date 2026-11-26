// The dispatcher (background/dispatcher.ts): expiring proposals nobody approved in time, and
// queuing START_JOB when an approved job's planned start arrives. The background loop isn't
// running in tests; each test calls the step it needs, with a clock that only moves when told.
import { randomUUID } from 'node:crypto';
import {
  HeartbeatResponseSchema,
  OrderDecisionResultSchema,
  type MachineEventRequest,
} from '@factorymustgrow/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  expireOverdueProposals,
  runDispatcher,
  startDueJobs,
} from '../src/background/dispatcher.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import type { MachineStatus } from '../src/generated/prisma/enums.js';
import { api } from './helpers/api.js';
import { useManualClock } from './helpers/clock.js';
import { findInconsistencies } from './helpers/consistency.js';
import {
  createMachine,
  createOrder,
  createShippingLeadTime,
  createSite,
} from './helpers/factories.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// At scale 60, the 120-second approval window is 2 simulated hours: routing books the first
// job 2 hours from now.
const WINDOW = 2 * HOUR;
const ROUNDS = 5;

let clock: ReturnType<typeof useManualClock>;
let seq = 1;

beforeEach(async () => {
  clock = useManualClock(new Date('2030-01-01T08:00:00.000Z'), 60);
  await createSite({ id: 'HAM' });
  await createMachine({ id: 'HAM-1', siteId: 'HAM' });
  await createShippingLeadTime({ siteId: 'HAM', destination: 'DE', days: 1 });
});

// Routes a new order (to HAM-1, the only machine) and returns the proposal and its job.
async function propose() {
  const order = await createOrder();
  const res = await api().post(`/api/orders/${order.id}/route`);
  expect(res.status).toBe(201);
  const { decision } = OrderDecisionResultSchema.parse(res.body);
  const job = decision.jobs[0];
  if (!job) throw new Error('The proposal booked no job');
  return { order, decision, job };
}

const approve = (decisionId: string) => api().post(`/api/decisions/${decisionId}/approve`);

// Routes and approves a new order.
async function approved() {
  const proposal = await propose();
  expect((await approve(proposal.decision.id)).status).toBe(200);
  return proposal;
}

const startCommands = () =>
  prisma.command.findMany({ where: { type: 'START_JOB' }, orderBy: { createdAt: 'asc' } });

async function expectConsistent() {
  expect(await findInconsistencies()).toEqual([]);
}

describe('starting approved jobs', () => {
  it('queues nothing before the planned start, and exactly one START_JOB at it', async () => {
    const { job } = await approved();

    clock.advance(WINDOW - MINUTE);
    expect(await startDueJobs()).toEqual([]);

    clock.advance(MINUTE);
    expect(await startDueJobs()).toEqual([job.id]);
    expect(await startCommands()).toMatchObject([
      {
        machineId: 'HAM-1',
        status: 'PENDING',
        payload: { jobId: job.id, plannedStart: job.plannedStart, plannedEnd: job.plannedEnd },
      },
    ]);

    // Later runs don't send it again, also once the machine has confirmed it.
    expect(await startDueJobs()).toEqual([]);
    await prisma.command.updateMany({ data: { status: 'ACKED' } });
    expect(await startDueJobs()).toEqual([]);
    expect(await startCommands()).toHaveLength(1);
    // The job only becomes RUNNING when the machine says it started.
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('PLANNED');
  });

  it('hands the command to the machine with its next heartbeat', async () => {
    const { job } = await approved();
    clock.advance(WINDOW);
    await startDueJobs();

    const res = await api()
      .post('/api/machines/HAM-1/heartbeat')
      .set('Authorization', `Bearer ${env.INGEST_TOKEN}`)
      .send({ state: 'IDLE', jobId: null });

    expect(res.status).toBe(200);
    expect(HeartbeatResponseSchema.parse(res.body).commands).toMatchObject([
      { type: 'START_JOB', payload: { jobId: job.id } },
    ]);
    expect((await startCommands())[0]?.status).toBe('DELIVERED');
  });

  it('starts a job late if its planned start passed while nothing was running', async () => {
    const { job } = await approved();
    // The backend was down for 5 hours.
    clock.advance(WINDOW + 5 * HOUR);

    expect(await startDueJobs()).toEqual([job.id]);
  });

  it('gives a machine one job at a time: the next once the first is confirmed', async () => {
    const first = await approved();
    const second = await approved();
    // Both are due.
    clock.advance(10 * HOUR);

    expect(await startDueJobs()).toEqual([first.job.id]);
    // The first START_JOB is still open, so the machine may not have started yet.
    expect(await startDueJobs()).toEqual([]);

    await prisma.command.updateMany({ data: { status: 'ACKED' } });
    expect(await startDueJobs()).toEqual([second.job.id]);
  });

  it.each<MachineStatus>(['RUNNING', 'ERROR', 'OFFLINE'])(
    'starts nothing on a machine that is %s',
    async (status) => {
      await approved();
      await prisma.machine.update({ where: { id: 'HAM-1' }, data: { status } });
      clock.advance(WINDOW);

      expect(await startDueJobs()).toEqual([]);
    },
  );

  it('starts nothing at a site that is down', async () => {
    await approved();
    await prisma.site.update({ where: { id: 'HAM' }, data: { status: 'DOWN' } });
    clock.advance(WINDOW);

    expect(await startDueJobs()).toEqual([]);
  });

  it('never starts a proposal that was not approved', async () => {
    await propose();
    clock.advance(WINDOW);

    await runDispatcher();
    expect(await startCommands()).toEqual([]);
  });

  it('leaves no START_JOB open when the machine fails at the same moment', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await approved();
      clock.advance(WINDOW);

      const failure: MachineEventRequest = {
        eventId: randomUUID(),
        seq: seq++,
        type: 'MACHINE_FAILURE',
        payload: {},
      };
      const [res] = await Promise.all([
        api()
          .post('/api/machines/HAM-1/events')
          .set('Authorization', `Bearer ${env.INGEST_TOKEN}`)
          .send(failure),
        startDueJobs(),
      ]);

      expect(res.status).toBe(200);
      // Includes: no open START_JOB and no active job on the failed machine.
      await expectConsistent();
      // Repaired for the next round.
      await prisma.machine.update({ where: { id: 'HAM-1' }, data: { status: 'IDLE' } });
    }
  });
});

describe('expiring proposals nobody approved', () => {
  it('expires a proposal at its planned start: slot freed, order back to DRAFT', async () => {
    const { order, decision, job } = await propose();

    clock.advance(WINDOW - MINUTE);
    expect(await expireOverdueProposals()).toEqual([]);

    clock.advance(MINUTE);
    expect(await expireOverdueProposals()).toEqual([decision.id]);

    const saved = await prisma.routingDecision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(saved.status).toBe('EXPIRED');
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'CANCELLED',
    );
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'DRAFT',
    );
    // Running again changes nothing.
    expect(await expireOverdueProposals()).toEqual([]);
    await expectConsistent();
  });

  it('expires a reroute proposal the same way', async () => {
    const { decision } = await propose();
    await prisma.routingDecision.update({ where: { id: decision.id }, data: { kind: 'REROUTE' } });
    clock.advance(WINDOW);

    expect(await expireOverdueProposals()).toEqual([decision.id]);
  });

  it('leaves an approved proposal alone', async () => {
    await approved();
    clock.advance(WINDOW);

    expect(await expireOverdueProposals()).toEqual([]);
  });

  it('approval and expiry at the same moment: exactly one outcome', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { decision } = await propose();
      clock.advance(WINDOW);

      const [res, expired] = await Promise.all([approve(decision.id), expireOverdueProposals()]);

      // Both see the planned start has come, so the proposal expires, exactly once: whichever
      // goes first expires it, and the other finds it no longer PROPOSED.
      expect(res.status).toBe(409);
      expect(expired.length).toBeLessThanOrEqual(1);
      expect(
        (await prisma.routingDecision.findUniqueOrThrow({ where: { id: decision.id } })).status,
      ).toBe('EXPIRED');
      await expectConsistent();
    }
  });

  it('an approval just before the planned start wins, and the job is then started', async () => {
    const { decision, job } = await propose();
    clock.advance(WINDOW - MINUTE);
    expect((await approve(decision.id)).status).toBe(200);

    clock.advance(MINUTE);
    await runDispatcher();

    expect(
      (await prisma.routingDecision.findUniqueOrThrow({ where: { id: decision.id } })).status,
    ).toBe('APPROVED');
    expect((await startCommands()).map((command) => command.payload)).toMatchObject([
      { jobId: job.id },
    ]);
    await expectConsistent();
  });
});
