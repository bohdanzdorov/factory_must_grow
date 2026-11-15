import type { Request, Response } from 'express';
import * as clockService from '../services/clock.service.js';

export function getClock(_req: Request, res: Response): void {
  res.json(clockService.getClockState());
}
