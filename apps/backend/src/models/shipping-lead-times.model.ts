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

    // Days to ship to `destination` from each site that has a route, keyed by site id.
    async daysToDestination(destination: string): Promise<Record<string, number>> {
      const rows = await db.shippingLeadTime.findMany({
        where: { destination },
        select: { siteId: true, days: true },
      });

      return Object.fromEntries(rows.map((row) => [row.siteId, row.days]));
    },
  };
}
