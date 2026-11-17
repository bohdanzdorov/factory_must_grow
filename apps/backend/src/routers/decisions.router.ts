import { Router } from 'express';
import { approveDecision, rejectDecision } from '../controllers/decisions.controller.js';

export const decisionsRouter = Router();

decisionsRouter.post('/:id/approve', approveDecision);
decisionsRouter.post('/:id/reject', rejectDecision);
