import { createScaledClock, type Clock } from '@factorymustgrow/shared';
import { env } from './env.js';

// Starts at the current real time when the process starts, so a restart moves simulated
// time back to now. Reseed after restarting if planned jobs end up far in the future.
let current: Clock = createScaledClock(env.CLOCK_SCALE);

export function getClock(): Clock {
  return current;
}

// Replaces the clock. Only tests should call this.
export function setClock(clock: Clock): void {
  current = clock;
}
