import { logger } from '../config/logger.js';
import { prisma } from '../models/prisma.js';

export async function isDatabaseUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    logger.warn({ err }, 'Database health check failed');
    return false;
  }
}
