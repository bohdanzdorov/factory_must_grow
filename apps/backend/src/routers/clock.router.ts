import { Router } from 'express';
import { getClock } from '../controllers/clock.controller.js';

export const clockRouter = Router();

clockRouter.get('/', getClock);
