import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  // Simulated milliseconds per real millisecond. At 60, a 30-minute job takes 30 seconds.
  CLOCK_SCALE: z.coerce.number().positive().default(60),
  // Real seconds an operator has to approve a proposal. Routing never plans a job to start
  // sooner, so a proposal cannot expire while someone is reading it.
  APPROVAL_WINDOW_SECONDS: z.coerce.number().int().positive().default(120),
  // Real seconds without a heartbeat before a working machine is marked OFFLINE; converted to
  // simulated time with the clock scale. Above the simulator's 5-second request timeout, so a
  // slow backend doesn't mark healthy machines offline.
  HEARTBEAT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(10),
  // Shared secret that machines (and simulators) send as "Authorization: Bearer <token>" on the
  // heartbeat and event endpoints. The same value goes in each simulator's environment.
  INGEST_TOKEN: z.string().min(16, 'INGEST_TOKEN must be at least 16 characters'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // The logger depends on these values, so it cannot be used here.
  console.error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const env = parsed.data;
