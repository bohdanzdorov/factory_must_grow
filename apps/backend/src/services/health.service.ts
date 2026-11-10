import { db } from '../config/database.js';
import { logger } from '../config/logger.js';

export async function isDatabaseUp(): Promise<boolean> {
  try {
    await db.health.ping();
    return true;
  } catch (err) {
    logger.warn({ err }, 'Database health check failed');
    return false;
  }
}
