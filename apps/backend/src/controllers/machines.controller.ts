import { ListMachinesQuerySchema } from '@factorymustgrow/shared';
import type { Request, Response } from 'express';
import * as machinesService from '../services/machines.service.js';

export async function listMachines(req: Request, res: Response): Promise<void> {
  const query = ListMachinesQuerySchema.parse(req.query);

  res.json(await machinesService.listMachines(query));
}

export async function getMachine(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.json(await machinesService.getMachine(req.params.id));
}
