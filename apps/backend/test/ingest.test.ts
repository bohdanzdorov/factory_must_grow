import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ErrorResponseSchema,
  HeartbeatResponseSchema,
  MachineEventResponseSchema,
  type MachineEventRequest,
} from '@factorymustgrow/shared';
import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { env } from '../src/config/env.js';
import { logRedaction } from '../src/config/logger.js';
import { prisma } from '../src/config/prisma.js';
import { requestLogLevel } from '../src/middlewares/request-logger.middleware.js';
import { api } from './helpers/api.js';
import { useManualClock } from './helpers/clock.js';
import { createCommand, createMachine } from './helpers/factories.js';

const MINUTE = 60_000;
const AUTH = `Bearer ${env.INGEST_TOKEN}`;

// `object`, not HeartbeatRequest, so tests can also send invalid bodies.
function heartbeat(machineId: string, body: object = { state: 'IDLE', jobId: null }) {
  return api().post(`/api/machines/${machineId}/heartbeat`).set('Authorization', AUTH).send(body);
}

function sendEvent(machineId: string, event: Partial<MachineEventRequest> = {}) {
  const body: MachineEventRequest = {
    eventId: randomUUID(),
    seq: 1,
    type: 'MACHINE_RESET',
    payload: {},
    ...event,
  };
  return api().post(`/api/machines/${machineId}/events`).set('Authorization', AUTH).send(body);
}

function commandStatus(id: string) {
  return prisma.command.findUniqueOrThrow({ where: { id } }).then((command) => command.status);
}

describe('ingest token', () => {
  it.each([
    ['no Authorization header', undefined],
    ['a wrong token', 'Bearer wrong-token-0123456789'],
    ['the token without "Bearer "', env.INGEST_TOKEN],
  ])('refuses a heartbeat with %s', async (_name, header) => {
    const machine = await createMachine();
    const request = api().post(`/api/machines/${machine.id}/heartbeat`);
    if (header !== undefined) void request.set('Authorization', header);

    const res = await request.send({ state: 'IDLE', jobId: null });

    expect(res.status).toBe(401);
    expect(ErrorResponseSchema.parse(res.body).error.message).toBe(
      'Missing or invalid ingest token',
    );
  });

  it('refuses an event without the token', async () => {
    const machine = await createMachine();

    const res = await api().post(`/api/machines/${machine.id}/events`).send({});

    expect(res.status).toBe(401);
  });

  it("doesn't apply to the UI's machine reads", async () => {
    const machine = await createMachine();

    expect((await api().get('/api/machines')).status).toBe(200);
    expect((await api().get(`/api/machines/${machine.id}`)).status).toBe(200);
  });
});

describe('POST /api/machines/:id/heartbeat', () => {
  it('records when the machine was last heard from, in simulated time', async () => {
    const clock = useManualClock(new Date('2026-11-19T08:00:00.000Z'));
    const machine = await createMachine();
    clock.advance(5 * MINUTE);

    const res = await heartbeat(machine.id);

    expect(res.status).toBe(200);
    const stored = await prisma.machine.findUniqueOrThrow({ where: { id: machine.id } });
    expect(stored.lastHeartbeatAt).toEqual(new Date('2026-11-19T08:05:00.000Z'));
  });

  it("doesn't change the machine's status", async () => {
    const machine = await createMachine({ status: 'OFFLINE' });

    await heartbeat(machine.id, { state: 'IDLE', jobId: null });

    const stored = await prisma.machine.findUniqueOrThrow({ where: { id: machine.id } });
    expect(stored.status).toBe('OFFLINE');
  });

  it('returns no commands when there are none', async () => {
    const machine = await createMachine();

    const res = await heartbeat(machine.id);

    expect(HeartbeatResponseSchema.parse(res.body)).toEqual({ commands: [] });
  });

  it('returns open commands oldest first and marks pending ones DELIVERED', async () => {
    const clock = useManualClock(new Date('2026-11-19T08:00:00.000Z'));
    const machine = await createMachine();
    const start = await createCommand({
      machineId: machine.id,
      type: 'START_JOB',
      payload: {
        jobId: 'job-1',
        plannedStart: '2026-11-19T09:00:00.000Z',
        plannedEnd: '2026-11-19T10:00:00.000Z',
      },
    });
    clock.advance(MINUTE);
    const reset = await createCommand({ machineId: machine.id, type: 'RESET' });

    const res = await heartbeat(machine.id);

    expect(HeartbeatResponseSchema.parse(res.body)).toEqual({
      commands: [
        {
          id: start.id,
          type: 'START_JOB',
          payload: {
            jobId: 'job-1',
            plannedStart: '2026-11-19T09:00:00.000Z',
            plannedEnd: '2026-11-19T10:00:00.000Z',
          },
        },
        { id: reset.id, type: 'RESET', payload: {} },
      ],
    });
    expect(await commandStatus(start.id)).toBe('DELIVERED');
    expect(await commandStatus(reset.id)).toBe('DELIVERED');
  });

  it('sends a DELIVERED command again, but not an ACKED or CANCELLED one', async () => {
    const machine = await createMachine();
    const delivered = await createCommand({ machineId: machine.id, status: 'DELIVERED' });
    await createCommand({ machineId: machine.id, status: 'ACKED' });
    await createCommand({ machineId: machine.id, status: 'CANCELLED' });

    const res = await heartbeat(machine.id);

    expect(HeartbeatResponseSchema.parse(res.body).commands.map((c) => c.id)).toEqual([
      delivered.id,
    ]);
  });

  it("only returns the machine's own commands", async () => {
    const machine = await createMachine();
    await createCommand();

    const res = await heartbeat(machine.id);

    expect(HeartbeatResponseSchema.parse(res.body).commands).toEqual([]);
  });

  it('skips a stored command whose payload is invalid, and sends the rest', async () => {
    const machine = await createMachine();
    const broken = await createCommand({
      machineId: machine.id,
      type: 'START_JOB',
      payload: { jobId: 'job-1' },
    });
    const reset = await createCommand({ machineId: machine.id, type: 'RESET' });

    const res = await heartbeat(machine.id);

    expect(res.status).toBe(200);
    expect(HeartbeatResponseSchema.parse(res.body).commands.map((c) => c.id)).toEqual([reset.id]);
    expect(await commandStatus(broken.id)).toBe('PENDING');
  });

  it('gives 404 for an unknown machine', async () => {
    const res = await heartbeat('NO-SUCH-MACHINE');

    expect(res.status).toBe(404);
    expect(ErrorResponseSchema.parse(res.body).error.message).toBe(
      'Machine not found: NO-SUCH-MACHINE',
    );
  });

  it('gives 400 for an invalid body', async () => {
    const machine = await createMachine();

    const res = await heartbeat(machine.id, { state: 'OFFLINE', jobId: null });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/machines/:id/events', () => {
  it('stores the event with the simulated time it arrived', async () => {
    useManualClock(new Date('2026-11-19T08:00:00.000Z'));
    const machine = await createMachine();
    const eventId = randomUUID();

    const res = await sendEvent(machine.id, {
      eventId,
      seq: 1_763_539_200_000,
      type: 'JOB_STARTED',
      payload: { jobId: 'job-1' },
    });

    expect(res.status).toBe(200);
    expect(MachineEventResponseSchema.parse(res.body)).toEqual({ result: 'STORED' });
    const stored = await prisma.machineEvent.findMany({ where: { machineId: machine.id } });
    expect(stored).toMatchObject([
      {
        eventId,
        seq: 1_763_539_200_000n,
        type: 'JOB_STARTED',
        payload: { jobId: 'job-1' },
        receivedAt: new Date('2026-11-19T08:00:00.000Z'),
      },
    ]);
  });

  it('answers DUPLICATE for an event it already has, and stores it once', async () => {
    const machine = await createMachine();
    const eventId = randomUUID();

    const first = await sendEvent(machine.id, { eventId });
    const second = await sendEvent(machine.id, { eventId });

    expect(MachineEventResponseSchema.parse(first.body)).toEqual({ result: 'STORED' });
    expect(second.status).toBe(200);
    expect(MachineEventResponseSchema.parse(second.body)).toEqual({ result: 'DUPLICATE' });
    expect(await prisma.machineEvent.count({ where: { machineId: machine.id } })).toBe(1);
  });

  it('stores the same event once when both copies arrive at the same moment', async () => {
    const machine = await createMachine();
    const eventId = randomUUID();

    const results = await Promise.all([
      sendEvent(machine.id, { eventId }),
      sendEvent(machine.id, { eventId }),
    ]);

    expect(results.map((res) => res.status)).toEqual([200, 200]);
    expect(results.map((res) => MachineEventResponseSchema.parse(res.body).result).sort()).toEqual([
      'DUPLICATE',
      'STORED',
    ]);
    expect(await prisma.machineEvent.count({ where: { machineId: machine.id } })).toBe(1);
  });

  it('treats the same eventId from two machines as two events', async () => {
    const machineA = await createMachine();
    const machineB = await createMachine();
    const eventId = randomUUID();

    await sendEvent(machineA.id, { eventId });
    const res = await sendEvent(machineB.id, { eventId });

    expect(MachineEventResponseSchema.parse(res.body)).toEqual({ result: 'STORED' });
  });

  it.each([
    ['JOB_STARTED', 'START_JOB'],
    ['JOB_CANCELLED', 'CANCEL_JOB'],
  ] as const)('%s acknowledges the %s for the same job only', async (eventType, commandType) => {
    const machine = await createMachine();
    const payload = (jobId: string) => ({
      jobId,
      plannedStart: '2026-11-19T09:00:00.000Z',
      plannedEnd: '2026-11-19T10:00:00.000Z',
    });
    const sameJob = await createCommand({
      machineId: machine.id,
      type: commandType,
      payload: payload('job-1'),
      status: 'DELIVERED',
    });
    const otherJob = await createCommand({
      machineId: machine.id,
      type: commandType,
      payload: payload('job-2'),
      status: 'DELIVERED',
    });

    await sendEvent(machine.id, { type: eventType, payload: { jobId: 'job-1' } });

    expect(await commandStatus(sameJob.id)).toBe('ACKED');
    expect(await commandStatus(otherJob.id)).toBe('DELIVERED');
  });

  it.each([
    ['MACHINE_FAILURE', 'FAIL'],
    ['MACHINE_RESET', 'RESET'],
  ] as const)('%s acknowledges every open %s for the machine', async (eventType, commandType) => {
    const machine = await createMachine();
    const pending = await createCommand({ machineId: machine.id, type: commandType });
    const delivered = await createCommand({
      machineId: machine.id,
      type: commandType,
      status: 'DELIVERED',
    });
    const otherMachine = await createCommand({ type: commandType });

    await sendEvent(machine.id, { type: eventType });

    expect(await commandStatus(pending.id)).toBe('ACKED');
    expect(await commandStatus(delivered.id)).toBe('ACKED');
    expect(await commandStatus(otherMachine.id)).toBe('PENDING');
  });

  it('JOB_COMPLETED acknowledges nothing', async () => {
    const machine = await createMachine();
    const start = await createCommand({
      machineId: machine.id,
      type: 'START_JOB',
      payload: {
        jobId: 'job-1',
        plannedStart: '2026-11-19T09:00:00.000Z',
        plannedEnd: '2026-11-19T10:00:00.000Z',
      },
      status: 'DELIVERED',
    });

    await sendEvent(machine.id, { type: 'JOB_COMPLETED', payload: { jobId: 'job-1' } });

    expect(await commandStatus(start.id)).toBe('DELIVERED');
  });

  it("doesn't acknowledge a command of another type", async () => {
    const machine = await createMachine();
    const fail = await createCommand({ machineId: machine.id, type: 'FAIL' });

    await sendEvent(machine.id, { type: 'MACHINE_RESET' });

    expect(await commandStatus(fail.id)).toBe('PENDING');
  });

  it('a job event without a jobId acknowledges no job command', async () => {
    const machine = await createMachine();
    const start = await createCommand({
      machineId: machine.id,
      type: 'START_JOB',
      payload: {
        jobId: 'job-1',
        plannedStart: '2026-11-19T09:00:00.000Z',
        plannedEnd: '2026-11-19T10:00:00.000Z',
      },
    });

    await sendEvent(machine.id, { type: 'JOB_STARTED', payload: {} });

    expect(await commandStatus(start.id)).toBe('PENDING');
  });

  it('a duplicate acknowledges nothing again', async () => {
    const machine = await createMachine();
    const eventId = randomUUID();
    await sendEvent(machine.id, { eventId, type: 'MACHINE_RESET' });
    // A new RESET after the first one was confirmed.
    const later = await createCommand({ machineId: machine.id, type: 'RESET' });

    await sendEvent(machine.id, { eventId, type: 'MACHINE_RESET' });

    expect(await commandStatus(later.id)).toBe('PENDING');
  });

  it('stores an event from an OFFLINE machine', async () => {
    const machine = await createMachine({ status: 'OFFLINE' });

    const res = await sendEvent(machine.id);

    expect(MachineEventResponseSchema.parse(res.body)).toEqual({ result: 'STORED' });
  });

  it('gives 404 for an unknown machine', async () => {
    const res = await sendEvent('NO-SUCH-MACHINE');

    expect(res.status).toBe(404);
  });

  it.each([
    ['an eventId that is not a UUID', { eventId: 'abc' }],
    ['a negative seq', { seq: -1 }],
    ['an unknown type', { type: 'EXPLODED' }],
  ])('gives 400 for %s', async (_name, field) => {
    const machine = await createMachine();

    const res = await sendEvent(machine.id, field as Partial<MachineEventRequest>);

    expect(res.status).toBe(400);
    expect(await prisma.machineEvent.count()).toBe(0);
  });
});

describe('request logging', () => {
  // Shaped like what Express passes once a mounted router has run: req.url is shortened to
  // the part after /api/machines, and only req.originalUrl has the full path.
  function level(method: string, originalUrl: string, statusCode: number) {
    const url = originalUrl.replace(/^\/api\/machines/, '') || '/';
    return requestLogLevel(
      { method, url, originalUrl } as unknown as IncomingMessage,
      { statusCode } as unknown as ServerResponse,
    );
  }

  it('never writes the ingest token to the log', () => {
    const lines: string[] = [];
    // The app's redaction settings, on a logger that writes into `lines`.
    const testLogger = pino(
      { redact: logRedaction },
      {
        write: (line: string) => {
          lines.push(line);
        },
      },
    );

    testLogger.info({ req: { headers: { authorization: AUTH } } }, 'request completed');

    expect(lines.join('')).not.toContain(env.INGEST_TOKEN);
    expect(lines.join('')).toContain('[redacted]');
  });

  it("doesn't log a successful heartbeat", () => {
    expect(level('POST', '/api/machines/HAM-MILL5-1/heartbeat', 200)).toBe('silent');
  });

  it('logs a failed heartbeat', () => {
    expect(level('POST', '/api/machines/HAM-MILL5-1/heartbeat', 401)).toBe('warn');
    expect(level('POST', '/api/machines/HAM-MILL5-1/heartbeat', 500)).toBe('error');
  });

  it('logs events and every other request', () => {
    expect(level('POST', '/api/machines/HAM-MILL5-1/events', 200)).toBe('info');
    expect(level('GET', '/api/machines', 200)).toBe('info');
  });
});
