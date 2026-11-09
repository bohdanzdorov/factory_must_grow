import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../errors/http-error.js';

interface ExposableClientError extends Error {
  status: number;
  expose: true;
}

// Errors from Express libraries, such as a malformed JSON body.
function isExposableClientError(err: unknown): err is ExposableClientError {
  return (
    err instanceof Error &&
    'status' in err &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500 &&
    'expose' in err &&
    err.expose === true
  );
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: { message: err.message } });
    return;
  }

  if (isExposableClientError(err)) {
    res.status(err.status).json({ error: { message: err.message } });
    return;
  }

  req.log.error({ err }, 'Unhandled error');
  res.status(500).json({ error: { message: 'Internal server error' } });
}
