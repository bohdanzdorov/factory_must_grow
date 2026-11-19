import { ClockStateSchema } from '@factorymustgrow/shared';
import { createManualClock, createScaledClock } from '../src/domain/clock.js';
import { describe, expect, it } from 'vitest';
import { api } from './helpers/api.js';
import { useManualClock } from './helpers/clock.js';

describe('createScaledClock', () => {
  it('starts at the current real time by default', () => {
    let real = Date.parse('2026-03-01T10:00:00Z');
    const clock = createScaledClock(60, { realNow: () => real });

    expect(clock.now().toISOString()).toBe('2026-03-01T10:00:00.000Z');
    real += 1;
    expect(clock.now().getTime()).toBe(Date.parse('2026-03-01T10:00:00Z') + 60);
  });

  it('runs scale times faster than real time', () => {
    let real = 0;
    const clock = createScaledClock(60, {
      start: new Date('2026-03-01T10:00:00Z'),
      realNow: () => real,
    });

    real += 30_000; // 30 real seconds

    expect(clock.now().toISOString()).toBe('2026-03-01T10:30:00.000Z');
    expect(clock.scale).toBe(60);
  });

  it('rejects a scale that is not positive', () => {
    expect(() => createScaledClock(0)).toThrow('Clock scale must be positive');
    expect(() => createScaledClock(-1)).toThrow('Clock scale must be positive');
  });
});

describe('createManualClock', () => {
  it('only moves when told to', () => {
    const clock = createManualClock(new Date('2026-03-01T10:00:00Z'));

    expect(clock.now().toISOString()).toBe('2026-03-01T10:00:00.000Z');

    clock.advance(90 * 60 * 1000);
    expect(clock.now().toISOString()).toBe('2026-03-01T11:30:00.000Z');

    clock.set(new Date('2026-04-01T00:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});

describe('GET /api/clock', () => {
  it('returns the simulated time and scale', async () => {
    useManualClock(new Date('2026-03-01T10:00:00Z'), 60);

    const res = await api().get('/api/clock');

    expect(res.status).toBe(200);
    expect(ClockStateSchema.parse(res.body)).toEqual({
      now: '2026-03-01T10:00:00.000Z',
      scale: 60,
    });
  });
});
