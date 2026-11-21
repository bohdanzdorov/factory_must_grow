// Running a transaction that books jobs again when something else got in the way at the same
// moment. Used by routing, and by failure handling (which reroutes, so it books jobs too).
import { transaction, type Models } from '../config/database.js';
import { logger } from '../config/logger.js';
import { isConcurrentBookingConflict, isJobOverlapError } from '../errors/database-errors.js';
import { HttpError } from '../errors/http-error.js';

// One first try plus 4 retries. Requests routed at the same moment all pick the same slot,
// so each round only one of them wins; more retries let a burst of requests get through.
const MAX_ATTEMPTS = 5;

// The machine routing chose failed while routing was running (see proposeRoute). Nothing was
// saved; routing again sees the machine as failed and picks another.
export class ChosenMachineFailedError extends Error {
  constructor(readonly machineId: string) {
    super(`Machine ${machineId} failed while routing chose it`);
    this.name = 'ChosenMachineFailedError';
  }
}

// Runs `work` in one transaction. If it fails because another request booked the same slot
// (an overlap, or a deadlock when both write at the same instant) or because the chosen
// machine failed meanwhile, everything rolls back and it runs again with fresh data.
// After the last attempt it gives up with 409.
export async function inBookingTransaction<T>(
  work: (tx: Models) => Promise<T>,
  context: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await transaction(work);
    } catch (err) {
      const machineFailed = err instanceof ChosenMachineFailedError;
      if (!machineFailed && !isConcurrentBookingConflict(err)) throw err;

      if (attempt >= MAX_ATTEMPTS) {
        throw new HttpError(
          409,
          'Could not book a slot because machines are being booked at the same time. Try again.',
        );
      }
      logger.info(
        { ...context, attempt, conflict: describeConflict(err) },
        'Something changed at the same moment; retrying',
      );
    }
  }
}

function describeConflict(err: unknown): string {
  if (err instanceof ChosenMachineFailedError) return 'machine failed';
  if (isJobOverlapError(err)) return 'overlap';
  return 'deadlock';
}
