import type { ErrorResponse } from '@factorymustgrow/shared';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
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

  if (err instanceof ZodError) {
    sendError(res, 400, {
      message: 'Invalid request',
      issues: err.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof HttpError) {
    sendError(res, err.statusCode, { message: err.message });
    return;
  }

  if (isExposableClientError(err)) {
    sendError(res, err.status, { message: err.message });
    return;
  }

  req.log.error({ err }, 'Unhandled error');
  sendError(res, 500, { message: 'Internal server error' });
}

function sendError(res: Response, status: number, error: ErrorResponse['error']): void {
  const body: ErrorResponse = { error };
  res.status(status).json(body);
}
