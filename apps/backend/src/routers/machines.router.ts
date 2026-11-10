import { Router } from 'express';
import { getMachine, listMachines } from '../controllers/machines.controller.js';

export const machinesRouter = Router();

machinesRouter.get('/', listMachines);
machinesRouter.get('/:id', getMachine);
