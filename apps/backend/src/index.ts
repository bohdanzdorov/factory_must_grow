import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';

const server = createApp().listen(env.PORT, (err) => {
  if (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  logger.info({ port: env.PORT }, 'Server started');
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'Shutting down');

  server.close(() => {
    prisma.$disconnect().then(
      () => process.exit(0),
      (err: unknown) => {
        logger.error({ err }, 'Failed to close database connection');
        process.exit(1);
      },
    );
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
