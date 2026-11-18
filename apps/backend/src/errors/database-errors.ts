// Recognising specific database errors, so they can become proper HTTP responses
// instead of 500s.
//
// Prisma has no error code of its own for exclusion constraints. Through the pg driver
// adapter they arrive as a generic PrismaClientKnownRequestError with code P2039, and the
// real Postgres details are nested in `meta.driverAdapterError.cause`:
//   { code: '23P01', message: 'conflicting key value violates exclusion constraint "job_no_overlap"' }
// This shape was observed in a real failure; test/job-overlap.test.ts checks it still holds.
import { Prisma } from '../generated/prisma/client.js';

// https://www.postgresql.org/docs/current/errcodes-appendix.html
const EXCLUSION_VIOLATION = '23P01';

interface PostgresErrorDetails {
  code?: unknown;
  message?: unknown;
}

// The Postgres error behind a Prisma error, if there is one.
function postgresError(err: unknown): PostgresErrorDetails | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
    return null;
  }

  const meta = err.meta as { driverAdapterError?: { cause?: PostgresErrorDetails } } | undefined;

  return meta?.driverAdapterError?.cause ?? null;
}

// True when a job could not be saved because its machine already has an active job in an
// overlapping time slot (the job_no_overlap constraint).
export function isJobOverlapError(err: unknown): boolean {
  const details = postgresError(err);

  return (
    details?.code === EXCLUSION_VIOLATION &&
    typeof details.message === 'string' &&
    details.message.includes('"job_no_overlap"')
  );
}

// Prisma's code for "Transaction failed due to a write conflict or a deadlock".
const WRITE_CONFLICT_OR_DEADLOCK = 'P2034';

// True when Postgres aborted the transaction to break a deadlock, or because it clashed with
// a concurrent write. Broader than isJobOverlapError: it doesn't say what the clash was about.
// Either way the whole transaction was rolled back and nothing was saved.
//
// It happens when two requests write conflicting jobs at practically the same instant: each
// then waits for the other's unsaved job, and Postgres aborts one of them. Observed in the
// W2-06 stress tests, where it surfaced as a 500 until routing retried on it.
export function isDeadlockOrWriteConflict(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === WRITE_CONFLICT_OR_DEADLOCK
  );
}

// Another request was booking at the same moment. Whether Postgres reported it as an overlap
// (one request was slightly ahead) or as a deadlock (both at the same instant), the
// transaction saved nothing, so running it again with fresh data is safe.
export function isConcurrentBookingConflict(err: unknown): boolean {
  return isJobOverlapError(err) || isDeadlockOrWriteConflict(err);
}
