import { pino } from 'pino';
import { env } from './env.js';

// Request logs include every header; this keeps the ingest token (and any future
// credentials) out of log files.
export const logRedaction = {
  paths: ['req.headers.authorization', 'req.headers.cookie'],
  censor: '[redacted]',
};

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: logRedaction,
  ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
});
