import { Router } from 'express';
import { listDestinations } from '../controllers/destinations.controller.js';

export const destinationsRouter = Router();

destinationsRouter.get('/', listDestinations);
