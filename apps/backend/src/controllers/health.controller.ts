import type { Request, Response } from 'express';
import { isDatabaseUp } from '../services/health.service.js';

export async function getHealth(_req: Request, res: Response): Promise<void> {
  const databaseUp = await isDatabaseUp();

  res.status(databaseUp ? 200 : 503).json({
    status: databaseUp ? 'ok' : 'degraded',
    database: databaseUp ? 'up' : 'down',
  });
}
