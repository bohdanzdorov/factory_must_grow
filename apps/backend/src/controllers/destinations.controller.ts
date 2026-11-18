import type { Request, Response } from 'express';
import * as destinationsService from '../services/destinations.service.js';

export async function listDestinations(_req: Request, res: Response): Promise<void> {
  res.json(await destinationsService.listDestinations());
}
