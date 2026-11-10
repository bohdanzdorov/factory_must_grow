import type { ErrorResponse } from '@factorymustgrow/shared';
import type { Request, Response } from 'express';

export function notFound(req: Request, res: Response): void {
  const body: ErrorResponse = { error: { message: `Route not found: ${req.method} ${req.path}` } };
  res.status(404).json(body);
}
