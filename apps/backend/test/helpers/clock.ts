import { createManualClock, type ManualClock } from '../../src/domain/clock.js';
import { setClock } from '../../src/config/clock.js';

// Makes the app use a clock that only moves when the test moves it.
export function useManualClock(start: Date = new Date(), scale = 1): ManualClock {
  const clock = createManualClock(start, scale);
  setClock(clock);
  return clock;
}
