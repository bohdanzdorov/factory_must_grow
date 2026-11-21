import { randomUUID } from 'node:crypto';
import type { MachineEventRequest } from '@factorymustgrow/shared';
import { describe, expect, it } from 'vitest';
import { startLoop } from '../src/background/loop.js';
import { transaction } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import type { MachineStatus } from '../src/generated/prisma/enums.js';
import { markSilentMachinesOffline } from '../src/services/heartbeat-monitor.service.js';
import { handleMachineFailure } from '../src/services/machine-failure.service.js';
import { api } from './helpers/api.js';
import { useManualClock } from './helpers/clock.js';
import { createMachine } from './helpers/factories.js';

const MINUTE = 60_000;
const T0 = new Date('2026-11-21T08:00:00.000Z');

function sendEvent(machineId: string, event: Partial<MachineEventRequest> = {}) {
  const body: MachineEventRequest = {
    eventId: randomUUID(),
    seq: 1,
    type: 'MACHINE_FAILURE',
    payload: {},
    ...event,
  };
  return api()
    .post(`/api/machines/${machineId}/events`)
    .set('Authorization', `Bearer ${env.INGEST_TOKEN}`)
    .send(body);
}

function statusOf(machineId: string): Promise<MachineStatus> {
  return prisma.machine
    .findUniqueOrThrow({ where: { id: machineId } })
    .then((machine) => machine.status);
}

describe('the machine reports a failure (MACHINE_FAILURE)', () => {
  it.each<MachineStatus>(['IDLE', 'RUNNING', 'OFFLINE'])(
    'turns a %s machine into ERROR',
    async (status) => {
      const machine = await createMachine({ status });

      await sendEvent(machine.id);

      expect(await statusOf(machine.id)).toBe('ERROR');
    },
  );

  it('leaves an ERROR machine in ERROR', async () => {
    const machine = await createMachine({ status: 'ERROR' });

    const res = await sendEvent(machine.id);

    expect(res.status).toBe(200);
    expect(await statusOf(machine.id)).toBe('ERROR');
  });

  it("doesn't act on a stale failure", async () => {
    const machine = await createMachine({ status: 'IDLE', lastSeq: 100n });

    await sendEvent(machine.id, { seq: 50 });

    expect(await statusOf(machine.id)).toBe('IDLE');
  });

  it("doesn't act on a duplicate failure", async () => {
    const machine = await createMachine({ status: 'IDLE' });
    const eventId = randomUUID();
    await sendEvent(machine.id, { eventId, seq: 1 });
    // The machine was repaired in the meantime.
    await prisma.machine.update({ where: { id: machine.id }, data: { status: 'IDLE' } });

    await sendEvent(machine.id, { eventId, seq: 1 });

    expect(await statusOf(machine.id)).toBe('IDLE');
  });

  it.each(['JOB_STARTED', 'JOB_COMPLETED', 'JOB_CANCELLED', 'MACHINE_RESET'] as const)(
    "%s doesn't change the machine's status",
    async (type) => {
      const machine = await createMachine({ status: 'IDLE' });

      await sendEvent(machine.id, { type, payload: { jobId: 'job-1' } });

      expect(await statusOf(machine.id)).toBe('IDLE');
    },
  );
});

describe('the machine goes silent (missed heartbeats)', () => {
  // 10 real seconds at 60x: 10 simulated minutes.
  const TIMEOUT = 10 * MINUTE;

  function machineLastHeardAt(lastHeartbeatAt: Date | null, status: MachineStatus = 'IDLE') {
    return createMachine({ status }).then(async (machine) => {
      await prisma.machine.update({ where: { id: machine.id }, data: { lastHeartbeatAt } });
      return machine;
    });
  }

  it('marks a machine OFFLINE once it has been silent longer than the timeout', async () => {
    const clock = useManualClock(T0, 60);
    const machine = await machineLastHeardAt(T0);
    clock.advance(TIMEOUT + 1);

    const marked = await markSilentMachinesOffline();

    expect(marked).toEqual([machine.id]);
    expect(await statusOf(machine.id)).toBe('OFFLINE');
  });

  it('leaves a machine alone while it is within the timeout', async () => {
    const clock = useManualClock(T0, 60);
    const machine = await machineLastHeardAt(T0);
    clock.advance(TIMEOUT);

    expect(await markSilentMachinesOffline()).toEqual([]);
    expect(await statusOf(machine.id)).toBe('IDLE');
  });

  it('converts the timeout with the clock scale', async () => {
    // At 1x, 10 real seconds are 10 simulated seconds, not 10 minutes.
    const clock = useManualClock(T0, 1);
    const machine = await machineLastHeardAt(T0);
    clock.advance(10_001);

    expect(await markSilentMachinesOffline()).toEqual([machine.id]);
  });

  it('marks a RUNNING machine OFFLINE too', async () => {
    const clock = useManualClock(T0, 60);
    const machine = await machineLastHeardAt(T0, 'RUNNING');
    clock.advance(TIMEOUT + 1);

    await markSilentMachinesOffline();

    expect(await statusOf(machine.id)).toBe('OFFLINE');
  });

  it('leaves a machine that has never sent a heartbeat alone', async () => {
    const clock = useManualClock(T0, 60);
    const machine = await machineLastHeardAt(null);
    clock.advance(24 * 60 * MINUTE);

    expect(await markSilentMachinesOffline()).toEqual([]);
    expect(await statusOf(machine.id)).toBe('IDLE');
  });

  it.each<MachineStatus>(['ERROR', 'OFFLINE'])('leaves a %s machine as it is', async (status) => {
    const clock = useManualClock(T0, 60);
    const machine = await machineLastHeardAt(T0, status);
    clock.advance(TIMEOUT + 1);

    expect(await markSilentMachinesOffline()).toEqual([]);
    expect(await statusOf(machine.id)).toBe(status);
  });

  it('keeps a machine online when a heartbeat arrives just before it is marked', async () => {
    useManualClock(T0, 60);
    const machine = await machineLastHeardAt(T0);
    // The monitor found the machine silent: last heard before this cutoff...
    const cutoff = new Date(T0.getTime() + 1);
    // ...but a heartbeat lands before the monitor changes its status.
    await prisma.machine.update({
      where: { id: machine.id },
      data: { lastHeartbeatAt: new Date(T0.getTime() + 2 * MINUTE) },
    });

    const changed = await transaction((tx) =>
      handleMachineFailure(tx, machine.id, { type: 'SILENT', lastHeartbeatBefore: cutoff }),
    );

    expect(changed).toBe(false);
    expect(await statusOf(machine.id)).toBe('IDLE');
  });

  it('marks only the silent machines', async () => {
    const clock = useManualClock(T0, 60);
    const silent = await machineLastHeardAt(T0);
    clock.advance(TIMEOUT + 1);
    const alive = await machineLastHeardAt(clock.now());

    expect(await markSilentMachinesOffline()).toEqual([silent.id]);
    expect(await statusOf(alive.id)).toBe('IDLE');
  });
});

describe('startLoop', () => {
  it('runs the task repeatedly, waits before the first run, and stops', async () => {
    let runs = 0;
    const loop = startLoop(
      'test',
      () => {
        runs += 1;
        return Promise.resolve();
      },
      { intervalMs: 10, firstRunAfterMs: 50 },
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runs).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 100));
    await loop.stop();
    const runsAtStop = runs;
    expect(runsAtStop).toBeGreaterThan(1);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(runs).toBe(runsAtStop);
  });

  it('never starts a run while the previous one is still going', async () => {
    let running = 0;
    let maxRunning = 0;
    const loop = startLoop(
      'test',
      async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 30));
        running -= 1;
      },
      { intervalMs: 1, firstRunAfterMs: 0 },
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    await loop.stop();

    expect(maxRunning).toBe(1);
  });

  it('keeps going after a run fails', async () => {
    let runs = 0;
    const loop = startLoop(
      'test',
      () => {
        runs += 1;
        return runs === 1 ? Promise.reject(new Error('boom')) : Promise.resolve();
      },
      { intervalMs: 5, firstRunAfterMs: 0 },
    );

    await new Promise((resolve) => setTimeout(resolve, 60));
    await loop.stop();

    expect(runs).toBeGreaterThan(1);
  });
});
