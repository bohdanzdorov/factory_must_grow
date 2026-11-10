import type { Request, Response } from 'express';
import * as sitesService from '../services/sites.service.js';

export async function listSites(_req: Request, res: Response): Promise<void> {
  res.json(await sitesService.listSites());
}

export async function getSite(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.json(await sitesService.getSite(req.params.id));
}
