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
