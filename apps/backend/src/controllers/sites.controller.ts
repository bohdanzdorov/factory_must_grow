import { UpdateSiteStatusSchema } from '@factorymustgrow/shared';
import type { Request, Response } from 'express';
import * as sitesService from '../services/sites.service.js';

export async function listSites(_req: Request, res: Response): Promise<void> {
  res.json(await sitesService.listSites());
}

export async function getSite(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.json(await sitesService.getSite(req.params.id));
}

export async function setSiteStatus(req: Request<{ id: string }>, res: Response): Promise<void> {
  const input = UpdateSiteStatusSchema.parse(req.body);

  res.json(await sitesService.setSiteStatus(req.params.id, input));
}
