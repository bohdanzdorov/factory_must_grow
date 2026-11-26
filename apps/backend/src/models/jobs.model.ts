import type { DbClient } from '../config/prisma.js';
import type { Reservation } from '../domain/routing.js';
import type { Job, JobStatus, RoutingDecisionStatus } from '../generated/prisma/client.js';

export interface NewJob {
  routingDecisionId: string;
  machineId: string;
  plannedStart: Date;
  plannedEnd: Date;
  // Defaults to PLANNED in the database.
  status?: JobStatus;
}

// Jobs in these statuses hold their time slot. Must match the WHERE clause of the
// job_no_overlap constraint in prisma/migrations/*_add_job_no_overlap/migration.sql.
export const ACTIVE_JOB_STATUSES: JobStatus[] = ['PLANNED', 'RUNNING'];

export type ActiveJobOnMachine = Job & {
  routingDecision: { id: string; status: RoutingDecisionStatus; orderId: string };
};

export function jobsModel(db: DbClient) {
  return {
    // Fails with a job_no_overlap error if the slot is taken; see errors/database-errors.ts.
    insert(data: NewJob): Promise<Job> {
      return db.job.create({ data });
    },

    // Moves a decision's jobs that are currently `from` to `to`; returns how many.
    // Used to cancel a rejected or expired proposal's booking, which frees its slot.
    async changeStatusForDecision(
      routingDecisionId: string,
      from: JobStatus,
      to: JobStatus,
    ): Promise<number> {
      const { count } = await db.job.updateMany({
        where: { routingDecisionId, status: from },
        data: { status: to },
      });
      return count;
    },

    // The machine's active jobs (PLANNED or RUNNING), each with its decision's id and status
    // and its order's id, oldest planned start first. Used when the machine fails.
    findActiveOnMachine(machineId: string): Promise<ActiveJobOnMachine[]> {
      return db.job.findMany({
        where: { machineId, status: { in: ACTIVE_JOB_STATUSES } },
        include: { routingDecision: { select: { id: true, status: true, orderId: true } } },
        orderBy: [{ plannedStart: 'asc' }, { id: 'asc' }],
      });
    },

    // Approved jobs whose planned start has come by `now` and that haven't started: PLANNED,
    // on an APPROVED decision. Optionally only one machine's. Oldest planned start first.
    findDueToStart(now: Date, machineId?: string): Promise<Job[]> {
      return db.job.findMany({
        where: {
          status: 'PLANNED',
          plannedStart: { lte: now },
          routingDecision: { status: 'APPROVED' },
          ...(machineId === undefined ? {} : { machineId }),
        },
        orderBy: [{ plannedStart: 'asc' }, { id: 'asc' }],
      });
    },

    // Moves the job to `to` if it is still active (PLANNED or RUNNING); returns whether it did.
    async changeStatusIfActive(id: string, to: JobStatus): Promise<boolean> {
      const { count } = await db.job.updateMany({
        where: { id, status: { in: ACTIVE_JOB_STATUSES } },
        data: { status: to },
      });
      return count === 1;
    },

    // Every slot held by an active job, in the shape routing expects. Pass `endingAfter` to
    // skip jobs that are already over; they can no longer block anything.
    async findActiveReservations(endingAfter?: Date): Promise<Reservation[]> {
      const jobs = await db.job.findMany({
        where: {
          status: { in: ACTIVE_JOB_STATUSES },
          ...(endingAfter ? { plannedEnd: { gt: endingAfter } } : {}),
        },
        select: { machineId: true, plannedStart: true, plannedEnd: true },
        orderBy: [{ machineId: 'asc' }, { plannedStart: 'asc' }],
      });

      return jobs.map((job) => ({
        machineId: job.machineId,
        start: job.plannedStart,
        end: job.plannedEnd,
      }));
    },
  };
}
