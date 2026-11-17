import type { DbClient } from '../config/prisma.js';
import type { Reservation } from '../domain/routing.js';
import type { Job, JobStatus } from '../generated/prisma/client.js';

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
