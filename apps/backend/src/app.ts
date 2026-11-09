import express, { type Express } from 'express';
import { errorHandler } from './middlewares/error.middleware.js';
import { notFound } from './middlewares/not-found.middleware.js';
import { requestLogger } from './middlewares/request-logger.middleware.js';
import { healthRouter } from './routers/health.router.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestLogger);
  app.use(express.json());

  app.use(healthRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
