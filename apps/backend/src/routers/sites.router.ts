import { Router } from 'express';
import { getSite, listSites } from '../controllers/sites.controller.js';

export const sitesRouter = Router();

sitesRouter.get('/', listSites);
sitesRouter.get('/:id', getSite);
