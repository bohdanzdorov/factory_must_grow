import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  // Simulated milliseconds per real millisecond. At 60, a 30-minute job takes 30 seconds.
  CLOCK_SCALE: z.coerce.number().positive().default(60),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // The logger depends on these values, so it cannot be used here.
  console.error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const env = parsed.data;
