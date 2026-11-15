import type { ClockState } from '@factorymustgrow/shared';
import { getClock } from '../config/clock.js';

export function getClockState(): ClockState {
  const clock = getClock();

  return { now: clock.now().toISOString(), scale: clock.scale };
}
