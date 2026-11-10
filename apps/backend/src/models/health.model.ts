import type { DbClient } from '../config/prisma.js';

export function healthModel(db: DbClient) {
  return {
    async ping(): Promise<void> {
      await db.$queryRaw`SELECT 1`;
    },
  };
}
