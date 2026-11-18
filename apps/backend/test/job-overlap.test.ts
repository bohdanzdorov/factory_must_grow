// The database itself refuses to double-book a machine (rule 1). These tests insert jobs
// directly, bypassing routing, to prove the constraint holds even if application code is wrong.
import { describe, expect, it } from 'vitest';
import { db, transaction } from '../src/config/database.js';
import { prisma } from '../src/config/prisma.js';
import {
  isConcurrentBookingConflict,
  isDeadlockOrWriteConflict,
  isJobOverlapError,
} from '../src/errors/database-errors.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { createJob, createMachine, createRoutingDecision } from './helpers/factories.js';

const at = (time: string) => new Date(`2030-01-01T${time}:00Z`);

describe('job_no_overlap constraint', () => {
  it('rejects a second active job in an overlapping slot on the same machine', async () => {
    const machine = await createMachine();
    await createJob({ machineId: machine.id, plannedStart: at('10:00'), plannedEnd: at('11:00') });

    const error: unknown = await createJob({
      machineId: machine.id,
      plannedStart: at('10:30'),
      plannedEnd: at('11:30'),
    }).catch((err: unknown) => err);

    expect(isJobOverlapError(error)).toBe(true);
    expect(await prisma.job.count()).toBe(1);
  });

  it('counts RUNNING jobs as holding their slot', async () => {
    const machine = await createMachine();
    await createJob({ machineId: machine.id, status: 'RUNNING', plannedStart: at('10:00') });

    const error: unknown = await createJob({
      machineId: machine.id,
      plannedStart: at('10:15'),
    }).catch((err: unknown) => err);

    expect(isJobOverlapError(error)).toBe(true);
  });

  it('allows a job that starts exactly when another ends', async () => {
    const machine = await createMachine();
    await createJob({ machineId: machine.id, plannedStart: at('10:00'), plannedEnd: at('11:00') });

    await createJob({ machineId: machine.id, plannedStart: at('11:00'), plannedEnd: at('12:00') });

    expect(await prisma.job.count()).toBe(2);
  });

  it('allows the same slot on different machines', async () => {
    await createJob({ plannedStart: at('10:00') });
    await createJob({ plannedStart: at('10:00') });

    expect(await prisma.job.count()).toBe(2);
  });

  it.each(['RELEASED', 'CANCELLED', 'COMPLETE'] as const)(
    'lets a %s job keep its history without blocking the slot',
    async (status) => {
      const machine = await createMachine();
      await createJob({ machineId: machine.id, status, plannedStart: at('10:00') });

      await createJob({ machineId: machine.id, plannedStart: at('10:00') });

      expect(await prisma.job.count()).toBe(2);
    },
  );

  it('also applies when an inactive job is made active again', async () => {
    const machine = await createMachine();
    const cancelled = await createJob({
      machineId: machine.id,
      status: 'CANCELLED',
      plannedStart: at('10:00'),
    });
    await createJob({ machineId: machine.id, plannedStart: at('10:00') });

    const error: unknown = await prisma.job
      .update({ where: { id: cancelled.id }, data: { status: 'PLANNED' } })
      .catch((err: unknown) => err);

    expect(isJobOverlapError(error)).toBe(true);
  });

  it('rejects a job that does not end after it starts', async () => {
    const error: unknown = await createJob({
      plannedStart: at('10:00'),
      plannedEnd: at('10:00'),
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    // A different constraint, so it must not be mistaken for a double-booking.
    expect(isJobOverlapError(error)).toBe(false);
  });

  it('lets exactly one of two simultaneous bookings for the same slot succeed', async () => {
    const machine = await createMachine();
    const [first, second] = await Promise.all([createRoutingDecision(), createRoutingDecision()]);

    const results = await Promise.allSettled(
      [first, second].map((decision) =>
        db.jobs.insert({
          routingDecisionId: decision.id,
          machineId: machine.id,
          plannedStart: at('10:00'),
          plannedEnd: at('11:00'),
        }),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(isJobOverlapError(failure?.reason)).toBe(true);
    expect(await prisma.job.count()).toBe(1);
  });

  it('rolls back the whole transaction when a booking collides', async () => {
    const machine = await createMachine();
    await createJob({ machineId: machine.id, plannedStart: at('10:00') });
    const decision = await createRoutingDecision();

    const error: unknown = await transaction(async (tx) => {
      // Fits on its own...
      await tx.jobs.insert({
        routingDecisionId: decision.id,
        machineId: machine.id,
        plannedStart: at('12:00'),
        plannedEnd: at('13:00'),
      });
      // ...but this one collides, so neither may be saved.
      await tx.jobs.insert({
        routingDecisionId: decision.id,
        machineId: machine.id,
        plannedStart: at('10:30'),
        plannedEnd: at('11:30'),
      });
    }).catch((err: unknown) => err);

    expect(isJobOverlapError(error)).toBe(true);
    expect(await prisma.job.count()).toBe(1);
  });
});

describe('isJobOverlapError', () => {
  it('is false for errors that are not from the database', () => {
    expect(isJobOverlapError(new Error('conflicting key value violates "job_no_overlap"'))).toBe(
      false,
    );
    expect(isJobOverlapError(undefined)).toBe(false);
  });
});

describe('isDeadlockOrWriteConflict and isConcurrentBookingConflict', () => {
  const deadlock = new Prisma.PrismaClientKnownRequestError(
    'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
    { code: 'P2034', clientVersion: 'test' },
  );

  async function realOverlapError(): Promise<unknown> {
    const machine = await createMachine();
    await createJob({ machineId: machine.id, plannedStart: at('10:00') });
    return createJob({ machineId: machine.id, plannedStart: at('10:30') }).catch(
      (err: unknown) => err,
    );
  }

  it('recognises a deadlock, but not as an overlap', () => {
    expect(isDeadlockOrWriteConflict(deadlock)).toBe(true);
    expect(isJobOverlapError(deadlock)).toBe(false);
  });

  it('treats both an overlap and a deadlock as a concurrent booking conflict', async () => {
    const overlap = await realOverlapError();

    expect(isConcurrentBookingConflict(overlap)).toBe(true);
    expect(isConcurrentBookingConflict(deadlock)).toBe(true);
    expect(isDeadlockOrWriteConflict(overlap)).toBe(false);
  });

  it('does not treat other errors as conflicts', () => {
    const otherPrismaError = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: 'test',
    });

    expect(isConcurrentBookingConflict(otherPrismaError)).toBe(false);
    expect(isConcurrentBookingConflict(new Error('Disk full'))).toBe(false);
    expect(isConcurrentBookingConflict(undefined)).toBe(false);
  });
});

describe('jobs.findActiveReservations', () => {
  it('returns only PLANNED and RUNNING jobs, sorted by machine and start', async () => {
    const machine = await createMachine({ id: 'M-1' });
    await createJob({ machineId: machine.id, status: 'RUNNING', plannedStart: at('12:00') });
    await createJob({ machineId: machine.id, status: 'PLANNED', plannedStart: at('09:00') });
    await createJob({ machineId: machine.id, status: 'CANCELLED', plannedStart: at('15:00') });
    await createJob({ machineId: machine.id, status: 'COMPLETE', plannedStart: at('06:00') });

    expect(await db.jobs.findActiveReservations()).toEqual([
      { machineId: 'M-1', start: at('09:00'), end: at('10:00') },
      { machineId: 'M-1', start: at('12:00'), end: at('13:00') },
    ]);
  });

  it('can skip jobs that are already over', async () => {
    const machine = await createMachine({ id: 'M-1' });
    await createJob({ machineId: machine.id, plannedStart: at('09:00') });
    await createJob({ machineId: machine.id, plannedStart: at('12:00') });

    // The 09:00–10:00 job ends exactly at 10:00, so it no longer counts.
    expect(await db.jobs.findActiveReservations(at('10:00'))).toEqual([
      { machineId: 'M-1', start: at('12:00'), end: at('13:00') },
    ]);
  });
});
