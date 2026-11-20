import { Router } from 'express';
import { receiveEvent, recordHeartbeat } from '../controllers/ingest.controller.js';
import { requireIngestToken } from '../middlewares/ingest-auth.middleware.js';

// Endpoints for machines, mounted at /api/machines next to the UI's machine reads.
// The token check is on each route, not router.use: router-level middleware would also run
// for the UI's GET /api/machines requests passing through this router.
export const ingestRouter = Router();

ingestRouter.post('/:id/heartbeat', requireIngestToken, recordHeartbeat);
ingestRouter.post('/:id/events', requireIngestToken, receiveEvent);
