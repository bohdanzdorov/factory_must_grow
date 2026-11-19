import type { MachineEventRequest } from '@factorymustgrow/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/transport/api-client.js';
import { Outbox, RETRY_FIRST_MS, RETRY_MAX_MS } from '../../src/transport/outbox.js';
import { fakeRealTime, silentLogger } from '../helpers.js';

function setup() {
  const time = fakeRealTime();
  // Every attempt is recorded; queued errors make the next attempts fail.
  const attempts: MachineEventRequest[] = [];
  const failures: Error[] = [];
  let ids = 0;

  const outbox = new Outbox({
    send: (event) => {
      attempts.push(event);
      const failure = failures.shift();
      return failure ? Promise.reject(failure) : Promise.resolve();
    },
    logger: silentLogger,
    firstSeq: 1000,
    newId: () => `event-${String(++ids)}`,
    realNow: time.now,
  });

  return {
    time,
    attempts,
    outbox,
    failNext: (...errors: Error[]) => {
      failures.push(...errors);
    },
  };
}

describe('Outbox', () => {
  it('gives each event a new id and the next seq', () => {
    const { outbox } = setup();

    expect(outbox.add({ type: 'JOB_STARTED', payload: { jobId: 'j' } })).toMatchObject({
      eventId: 'event-1',
      seq: 1000,
    });
    expect(outbox.add({ type: 'JOB_COMPLETED', payload: { jobId: 'j' } })).toMatchObject({
      eventId: 'event-2',
      seq: 1001,
    });
  });

  it('starts seq at the real time by default, so a restart never goes backwards', () => {
    const outbox = new Outbox({
      send: () => Promise.resolve(),
      logger: silentLogger,
      realNow: () => 1_763_539_200_000,
    });
    expect(outbox.add({ type: 'MACHINE_RESET', payload: {} }).seq).toBe(1_763_539_200_000);
  });

  it('sends events in order and empties the queue', async () => {
    const { attempts, outbox } = setup();
    outbox.add({ type: 'JOB_STARTED', payload: { jobId: 'j' } });
    outbox.add({ type: 'JOB_COMPLETED', payload: { jobId: 'j' } });

    await outbox.flush();

    expect(attempts.map((e) => e.seq)).toEqual([1000, 1001]);
    expect(outbox.size).toBe(0);
  });

  it('stops at a failed event and sends it again, unchanged, before the later ones', async () => {
    const { time, attempts, outbox, failNext } = setup();
    outbox.add({ type: 'JOB_STARTED', payload: { jobId: 'j' } });
    outbox.add({ type: 'JOB_COMPLETED', payload: { jobId: 'j' } });
    // The backend may have stored it and only the response got lost: a real duplicate.
    failNext(new Error('socket hang up'));

    await outbox.flush();
    expect(attempts).toHaveLength(1);
    expect(outbox.size).toBe(2);

    time.advance(RETRY_FIRST_MS);
    await outbox.flush();

    expect(attempts.map((e) => [e.eventId, e.seq])).toEqual([
      ['event-1', 1000],
      ['event-1', 1000],
      ['event-2', 1001],
    ]);
    expect(outbox.size).toBe(0);
  });

  it('waits before retrying, doubling the delay up to a limit', async () => {
    const { time, attempts, outbox, failNext } = setup();
    outbox.add({ type: 'MACHINE_RESET', payload: {} });
    failNext(...Array.from({ length: 6 }, () => new ApiError(503, 'unavailable')));

    await outbox.flush();
    const delays: number[] = [];
    while (outbox.size > 0) {
      // Count how long until the next attempt; nothing is sent while waiting.
      const before = attempts.length;
      let waited = 0;
      while (attempts.length === before) {
        time.advance(100);
        waited += 100;
        await outbox.flush();
      }
      delays.push(waited);
    }

    expect(delays).toEqual([500, 1000, 2000, 4000, RETRY_MAX_MS, RETRY_MAX_MS]);
  });

  it('keeps retrying a 404, since the endpoint may not exist yet', async () => {
    const { time, attempts, outbox, failNext } = setup();
    outbox.add({ type: 'MACHINE_RESET', payload: {} });
    failNext(new ApiError(404, 'not found'));

    await outbox.flush();
    time.advance(RETRY_FIRST_MS);
    await outbox.flush();

    expect(attempts).toHaveLength(2);
    expect(outbox.size).toBe(0);
  });

  it('drops an event the backend rejects as invalid (400) and carries on', async () => {
    const { attempts, outbox, failNext } = setup();
    outbox.add({ type: 'JOB_STARTED', payload: { jobId: 'j' } });
    outbox.add({ type: 'JOB_COMPLETED', payload: { jobId: 'j' } });
    failNext(new ApiError(400, 'invalid'));

    await outbox.flush();

    expect(attempts.map((e) => e.seq)).toEqual([1000, 1001]);
    expect(outbox.size).toBe(0);
  });
});
