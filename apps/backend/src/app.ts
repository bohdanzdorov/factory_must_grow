import express, { type Express } from 'express';
import { errorHandler } from './middlewares/error.middleware.js';
import { notFound } from './middlewares/not-found.middleware.js';
import { requestLogger } from './middlewares/request-logger.middleware.js';
import { clockRouter } from './routers/clock.router.js';
import { decisionsRouter } from './routers/decisions.router.js';
import { destinationsRouter } from './routers/destinations.router.js';
import { healthRouter } from './routers/health.router.js';
import { ingestRouter } from './routers/ingest.router.js';
import { machinesRouter } from './routers/machines.router.js';
import { ordersRouter } from './routers/orders.router.js';
import { sitesRouter } from './routers/sites.router.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestLogger);
  app.use(express.json());

  app.use(healthRouter);
  app.use('/api/clock', clockRouter);
  app.use('/api/sites', sitesRouter);
  app.use('/api/machines', machinesRouter);
  app.use('/api/machines', ingestRouter);
  app.use('/api/destinations', destinationsRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/decisions', decisionsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
