import { describe, expect, it } from 'vitest';
import { BackendClock } from '../../src/domain/clock.js';
import { fakeRealTime, MINUTE, T0 } from '../helpers.js';

describe('BackendClock', () => {
  it('estimates simulated time between readings from the scale', () => {
    const time = fakeRealTime(1_000_000);
    const clock = BackendClock.fromState({ now: new Date(T0).toISOString(), scale: 60 }, time.now);

    time.advance(1_000);

    expect(clock.now().getTime()).toBe(T0 + MINUTE);
  });

  it('takes the new time and scale from a fresh reading', () => {
    const time = fakeRealTime(1_000_000);
    const clock = BackendClock.fromState({ now: new Date(T0).toISOString(), scale: 60 }, time.now);

    time.advance(5_000);
    clock.update({ now: new Date(T0 + 10 * MINUTE).toISOString(), scale: 120 });
    time.advance(1_000);

    expect(clock.scale).toBe(120);
    expect(clock.now().getTime()).toBe(T0 + 12 * MINUTE);
  });
});
