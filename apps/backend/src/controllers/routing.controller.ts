import type { Request, Response } from 'express';
import * as routingService from '../services/routing.service.js';

export async function routeOrder(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.status(201).json(await routingService.routeOrder(req.params.id));
}

export async function listDecisions(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.json(await routingService.listDecisions(req.params.id));
}
