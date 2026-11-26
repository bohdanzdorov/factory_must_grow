import { HeartbeatRequestSchema, MachineEventRequestSchema } from '@factorymustgrow/shared';
import type { Request, Response } from 'express';
import * as ingestService from '../services/ingest.service.js';

export async function recordHeartbeat(req: Request<{ id: string }>, res: Response): Promise<void> {
  const report = HeartbeatRequestSchema.parse(req.body);

  res.json(await ingestService.recordHeartbeat(req.params.id, report));
}

export async function receiveEvent(req: Request<{ id: string }>, res: Response): Promise<void> {
  const event = MachineEventRequestSchema.parse(req.body);

  res.json(await ingestService.receiveEvent(req.params.id, event));
}
