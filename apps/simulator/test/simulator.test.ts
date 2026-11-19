import type {
  HeartbeatRequest,
  MachineCommand,
  MachineEventRequest,
} from '@factorymustgrow/shared';
import { describe, expect, it } from 'vitest';
import type { BackendApi } from '../src/transport/api-client.js';
import { BackendClock } from '../src/domain/clock.js';
import { Outbox } from '../src/transport/outbox.js';
import { CLOCK_REFRESH_MS, Simulator, TICK_MS } from '../src/simulator.js';
import { cancelJob, fail, fakeRealTime, reset, silentLogger, startJob, T0 } from './helpers.js';

const SCALE = 60;

// The backend's simulated time: starts at T0 when the test's real time does, then runs at 60x.
function backendNow(realNow: number): string {
  return new Date(T0 + (realNow - T0) * SCALE).toISOString();
}

// A backend that hands out commands until the test confirms them, like the real one will.
function fakeBackend(realNow: () => number) {
  const heartbeats: HeartbeatRequest[] = [];
  const events: MachineEventRequest[] = [];
  let pending: MachineCommand[] = [];
  let down = false;
  let clockReads = 0;

  const api: BackendApi = {
    getClock: () => {
      clockReads++;
      return Promise.resolve({ now: backendNow(realNow()), scale: SCALE });
    },
    getMachine: () => Promise.reject(new Error('not used')),
    heartbeat: (_id, body) => {
      if (down) return Promise.reject(new Error('ECONNREFUSED'));
      heartbeats.push(body);
      return Promise.resolve({ commands: pending });
    },
    sendEvent: (_id, body) => {
      if (down) return Promise.reject(new Error('ECONNREFUSED'));
      events.push(body);
      return Promise.resolve();
    },
  };

  return {
    api,
    heartbeats,
    events,
    clockReads: () => clockReads,
    eventTypes: () => events.map((e) => e.type),
    setDown: (value: boolean) => {
      down = value;
    },
    queue: (...commands: MachineCommand[]) => {
      pending = [...pending, ...commands];
    },
    confirm: (commandId: string) => {
      pending = pending.filter((c) => c.id !== commandId);
    },
  };
}

function setup() {
  const time = fakeRealTime();
  const backend = fakeBackend(time.now);
  const clock = BackendClock.fromState({ now: backendNow(time.now()), scale: SCALE }, time.now);
  const outbox = new Outbox({
    send: (event) => backend.api.sendEvent('HAM-MILL5-1', event),
    logger: silentLogger,
    realNow: time.now,
  });
  const simulator = new Simulator({
    machineId: 'HAM-MILL5-1',
    api: backend.api,
    clock,
    outbox,
    logger: silentLogger,
    realNow: time.now,
  });
  return { time, backend, simulator };
}

describe('Simulator', () => {
  it('reports IDLE with no job in its heartbeat', async () => {
    const { backend, simulator } = setup();

    await simulator.tick();

    expect(backend.heartbeats).toEqual([{ state: 'IDLE', jobId: null }]);
  });

  it('runs a job from its command to its completion at the clock scale', async () => {
    const { time, backend, simulator } = setup();
    backend.queue(startJob('c1', 'job-1', 30));

    await simulator.tick();
    expect(backend.eventTypes()).toEqual(['JOB_STARTED']);

    // Not confirmed yet, so the backend sends it again; the job must not start twice.
    time.advance(TICK_MS);
    await simulator.tick();
    expect(backend.heartbeats.at(-1)).toEqual({ state: 'RUNNING', jobId: 'job-1' });
    expect(backend.eventTypes()).toEqual(['JOB_STARTED']);
    backend.confirm('c1');

    // 30 simulated minutes at 60x: 30 real seconds after the start.
    time.advance(30_000 - TICK_MS - 1);
    await simulator.tick();
    expect(simulator.state.status).toBe('RUNNING');

    time.advance(1);
    await simulator.tick();
    expect(simulator.state.status).toBe('IDLE');
    expect(backend.eventTypes()).toEqual(['JOB_STARTED', 'JOB_COMPLETED']);
  });

  it('sends JOB_COMPLETED before the heartbeat that reports IDLE', async () => {
    const { time, backend, simulator } = setup();
    const order: string[] = [];
    const { heartbeat, sendEvent } = backend.api;
    backend.api.heartbeat = (id, body) => {
      order.push(`heartbeat ${body.state}`);
      return heartbeat(id, body);
    };
    backend.api.sendEvent = (id, body) => {
      order.push(body.type);
      return sendEvent(id, body);
    };

    backend.queue(startJob('c1', 'job-1', 1));
    await simulator.tick();
    backend.confirm('c1');
    time.advance(1_000);
    await simulator.tick();

    expect(order).toEqual(['heartbeat IDLE', 'JOB_STARTED', 'JOB_COMPLETED', 'heartbeat IDLE']);
  });

  it('starts a job that arrived while the machine was busy once it is IDLE', async () => {
    const { time, backend, simulator } = setup();
    backend.queue(fail('c1'));
    await simulator.tick();
    backend.confirm('c1');

    backend.queue(startJob('c2', 'job-2', 30));
    time.advance(TICK_MS);
    await simulator.tick();
    expect(simulator.state.status).toBe('ERROR');

    backend.queue(reset('c3'));
    time.advance(TICK_MS);
    await simulator.tick();
    // RESET came after START_JOB in that response, so the job starts on the next heartbeat.
    time.advance(TICK_MS);
    await simulator.tick();

    expect(simulator.state).toMatchObject({ status: 'RUNNING', jobId: 'job-2' });
    expect(backend.eventTypes()).toEqual(['MACHINE_FAILURE', 'MACHINE_RESET', 'JOB_STARTED']);
  });

  it('confirms CANCEL_JOB with JOB_CANCELLED', async () => {
    const { backend, simulator } = setup();
    backend.queue(startJob('c1', 'job-1', 30), cancelJob('c2', 'job-1'));

    await simulator.tick();

    expect(simulator.state.status).toBe('IDLE');
    expect(backend.eventTypes()).toEqual(['JOB_STARTED', 'JOB_CANCELLED']);
  });

  it('keeps running through a backend outage and delivers its events afterwards', async () => {
    const { time, backend, simulator } = setup();
    backend.queue(startJob('c1', 'job-1', 5));
    await simulator.tick();
    backend.confirm('c1');

    // 5 simulated minutes at 60x: the job finishes while the backend is down.
    backend.setDown(true);
    for (let i = 0; i < 6; i++) {
      time.advance(TICK_MS);
      await simulator.tick();
    }
    expect(simulator.state.status).toBe('IDLE');
    expect(backend.eventTypes()).toEqual(['JOB_STARTED']);

    backend.setDown(false);
    time.advance(10_000);
    await simulator.tick();

    expect(backend.eventTypes()).toEqual(['JOB_STARTED', 'JOB_COMPLETED']);
    expect(backend.events[1]?.seq).toBe((backend.events[0]?.seq ?? 0) + 1);
  });

  it('reads the clock again only every 30 seconds', async () => {
    const { time, backend, simulator } = setup();

    await simulator.tick();
    expect(backend.clockReads()).toBe(0);

    time.advance(CLOCK_REFRESH_MS);
    await simulator.tick();
    expect(backend.clockReads()).toBe(1);
  });
});
