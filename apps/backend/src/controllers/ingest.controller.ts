import { HeartbeatRequestSchema, MachineEventRequestSchema } from '@factorymustgrow/shared';
import type { Request, Response } from 'express';
import * as ingestService from '../services/ingest.service.js';

export async function recordHeartbeat(req: Request<{ id: string }>, res: Response): Promise<void> {
  // The body (the machine's state and its running jobId) is validated but not used yet.
  // Validating it now means a machine that sends a malformed heartbeat gets a 400 straight
  // away, instead of the problem going unnoticed until the fields are needed.
  // W3-04 and W3-06 will use them to notice a machine that reconnects after being marked
  // OFFLINE, possibly still running a job the backend has already moved elsewhere.
  HeartbeatRequestSchema.parse(req.body);

  res.json(await ingestService.recordHeartbeat(req.params.id));
}

export async function receiveEvent(req: Request<{ id: string }>, res: Response): Promise<void> {
  const event = MachineEventRequestSchema.parse(req.body);

  res.json(await ingestService.receiveEvent(req.params.id, event));
}
