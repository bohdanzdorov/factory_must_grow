import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../errors/http-error.js';

// Hashing both sides gives two buffers of the same length, which timingSafeEqual requires,
// whatever length the sent token has.
function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

const expectedToken = sha256(env.INGEST_TOKEN);

// Only machines may send heartbeats and events: one fake MACHINE_FAILURE would release jobs
// and reroute orders. They send the shared INGEST_TOKEN as "Authorization: Bearer <token>".
// Compared in constant time: === stops at the first wrong character, so how long the check
// takes would give away how much of a guess was right.
//
// Attach it to each ingest route, not with router.use: the ingest routes share the
// /api/machines prefix with the UI's reads, which need no token.
export function requireIngestToken(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (token === undefined || !timingSafeEqual(sha256(token), expectedToken)) {
    next(new HttpError(401, 'Missing or invalid ingest token'));
    return;
  }

  next();
}
