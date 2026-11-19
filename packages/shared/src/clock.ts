import { z } from 'zod';

// Response of GET /api/clock: the backend's simulated time and how fast it runs.
// The clock itself lives in the backend (apps/backend/src/domain/clock.ts).
export const ClockStateSchema = z.object({
  now: z.iso.datetime(),
  // Simulated milliseconds per real millisecond.
  scale: z.number().positive(),
});
export type ClockState = z.infer<typeof ClockStateSchema>;
