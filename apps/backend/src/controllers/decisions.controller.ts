import { RejectDecisionSchema } from '@factorymustgrow/shared';
import type { Request, Response } from 'express';
import * as decisionsService from '../services/decisions.service.js';

export async function approveDecision(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.json(await decisionsService.approveDecision(req.params.id));
}

export async function rejectDecision(req: Request<{ id: string }>, res: Response): Promise<void> {
  const input = RejectDecisionSchema.parse(req.body);

  res.json(await decisionsService.rejectDecision(req.params.id, input));
}
