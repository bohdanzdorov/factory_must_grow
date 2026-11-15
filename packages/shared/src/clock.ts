import { z } from 'zod';

// Simulated time. Every stored or compared time in the system comes from a Clock,
// so routing, dispatching and the simulator agree on "now". See docs/design-decisions.md.
export interface Clock {
  now(): Date;
  // How many simulated milliseconds pass per real millisecond.
  readonly scale: number;
}

// A clock that starts at `start` (default: the current real time) and runs `scale` times
// faster than real time. `realNow` can be replaced in tests to control real time.
export function createScaledClock(
  scale: number,
  options: { start?: Date; realNow?: () => number } = {},
): Clock {
  if (!(scale > 0)) {
    throw new Error(`Clock scale must be positive, got ${String(scale)}`);
  }

  const realNow = options.realNow ?? Date.now;
  const realStart = realNow();
  const simulatedStart = options.start?.getTime() ?? realStart;

  return {
    scale,
    now: () => new Date(simulatedStart + (realNow() - realStart) * scale),
  };
}

export interface ManualClock extends Clock {
  set(time: Date): void;
  advance(milliseconds: number): void;
}

// A clock that only moves when told to. For tests.
export function createManualClock(start: Date, scale = 1): ManualClock {
  let current = start.getTime();

  return {
    scale,
    now: () => new Date(current),
    set: (time) => {
      current = time.getTime();
    },
    advance: (milliseconds) => {
      current += milliseconds;
    },
  };
}

export const ClockStateSchema = z.object({
  now: z.iso.datetime(),
  scale: z.number().positive(),
});
export type ClockState = z.infer<typeof ClockStateSchema>;
