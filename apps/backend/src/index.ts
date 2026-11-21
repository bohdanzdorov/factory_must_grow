import { createApp } from './app.js';
import { startLoop } from './background/loop.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import {
  HEARTBEAT_CHECK_INTERVAL_MS,
  markSilentMachinesOffline,
} from './services/heartbeat-monitor.service.js';

const server = createApp().listen(env.PORT, (err) => {
  if (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  logger.info({ port: env.PORT }, 'Server started');
});

// Marks machines OFFLINE when their heartbeats stop. The first check waits one full timeout:
// after a restart every machine's last heartbeat looks old, and the simulators need a moment
// to get through again.
const heartbeatMonitor = startLoop(
  'heartbeat-monitor',
  async () => {
    await markSilentMachinesOffline();
  },
  {
    intervalMs: HEARTBEAT_CHECK_INTERVAL_MS,
    firstRunAfterMs: env.HEARTBEAT_TIMEOUT_SECONDS * 1000,
  },
);

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'Shutting down');

  server.close(() => {
    heartbeatMonitor
      .stop()
      .then(() => prisma.$disconnect())
      .then(
        () => process.exit(0),
        (err: unknown) => {
          logger.error({ err }, 'Failed to shut down cleanly');
          process.exit(1);
        },
      );
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
