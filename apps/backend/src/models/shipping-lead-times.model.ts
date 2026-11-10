import type { DbClient } from '../config/prisma.js';

export function shippingLeadTimesModel(db: DbClient) {
  return {
    async destinationExists(destination: string): Promise<boolean> {
      const row = await db.shippingLeadTime.findFirst({
        where: { destination },
        select: { siteId: true },
      });

      return row !== null;
    },
  };
}
