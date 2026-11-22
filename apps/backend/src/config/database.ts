import { isConcurrentBookingConflict, isJobOverlapError } from '../errors/database-errors.js';
import { HttpError } from '../errors/http-error.js';
import { ChosenMachineFailedError } from '../errors/routing-errors.js';
import { commandsModel } from '../models/commands.model.js';
import { healthModel } from '../models/health.model.js';
import { jobsModel } from '../models/jobs.model.js';
import { machineEventsModel } from '../models/machine-events.model.js';
import { machinesModel } from '../models/machines.model.js';
import { ordersModel } from '../models/orders.model.js';
import { routingDecisionsModel } from '../models/routing-decisions.model.js';
import { shippingLeadTimesModel } from '../models/shipping-lead-times.model.js';
import { sitesModel } from '../models/sites.model.js';
import { logger } from './logger.js';
import { prisma, type DbClient } from './prisma.js';

// Every model, bound to one database client.
function createModels(client: DbClient) {
  return {
    health: healthModel(client),
    sites: sitesModel(client),
    machines: machinesModel(client),
    orders: ordersModel(client),
    jobs: jobsModel(client),
    routingDecisions: routingDecisionsModel(client),
    shippingLeadTimes: shippingLeadTimesModel(client),
    machineEvents: machineEventsModel(client),
    commands: commandsModel(client),
  };
}

export type Models = ReturnType<typeof createModels>;

// Models for single queries, each running on its own.
export const db: Models = createModels(prisma);

// Chosen deliberately rather than relying on Prisma's defaults (5 s and 2 s):
// how long a transaction may run, and how long it may wait for a free connection.
const TRANSACTION_TIMEOUT_MS = 10_000;
const TRANSACTION_MAX_WAIT_MS = 5_000;

// Runs `work` in one transaction: every model call on `tx` commits together,
// or all of them roll back if `work` throws.
export function transaction<T>(work: (tx: Models) => Promise<T>): Promise<T> {
  return prisma.$transaction((client) => work(createModels(client)), {
    timeout: TRANSACTION_TIMEOUT_MS,
    maxWait: TRANSACTION_MAX_WAIT_MS,
  });
}

// One first try plus 4 retries. Requests routed at the same moment all pick the same slot,
// so each round only one of them wins; more retries let a burst of requests get through.
const BOOKING_MAX_ATTEMPTS = 5;

// Like transaction(), for work that books jobs (routing, and failure handling, which
// reroutes). If it fails because another request booked the same slot at the same moment (an
// overlap, or a deadlock when both write at the same instant), or because the chosen machine
// failed meanwhile, everything rolls back and it runs again with fresh data. After the last
// attempt it gives up with 409. The context object is added to the retry log line.
export async function inBookingTransaction<T>(
  work: (tx: Models) => Promise<T>,
  context: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await transaction(work);
    } catch (err) {
      if (!(err instanceof ChosenMachineFailedError) && !isConcurrentBookingConflict(err)) {
        throw err;
      }

      if (attempt >= BOOKING_MAX_ATTEMPTS) {
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
