import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LevelWithSilent } from 'pino';
import { pinoHttp } from 'pino-http';
import { logger } from '../config/logger.js';

const HEARTBEAT_PATH = /^\/api\/machines\/[^/]+\/heartbeat$/;

// Every machine sends a heartbeat each second, so logging them would bury everything else
// (10 machines = 10 lines a second). Successful heartbeats are not logged; failed ones are.
export function requestLogLevel(
  req: IncomingMessage,
  res: ServerResponse,
  err?: Error,
): LevelWithSilent {
  if (err || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';

  return req.method === 'POST' && HEARTBEAT_PATH.test(fullPath(req)) ? 'silent' : 'info';
}

// The path as the client sent it, without the query string. Not req.url: inside a router
// mounted at /api/machines, Express shortens req.url to the part after the mount point
// (/HAM-MILL5-1/heartbeat), and it is still shortened when the response is logged.
function fullPath(req: IncomingMessage & { originalUrl?: string }): string {
  return (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
}

export const requestLogger = pinoHttp({ logger, customLogLevel: requestLogLevel });
