import type { DbClient } from '../config/prisma.js';
import type { Prisma, Site, SiteStatus } from '../generated/prisma/client.js';
import { machineInclude } from './machines.model.js';

const siteDetailInclude = {
  machines: { include: machineInclude, orderBy: { id: 'asc' } },
} satisfies Prisma.SiteInclude;

export type SiteDetailRecord = Prisma.SiteGetPayload<{ include: typeof siteDetailInclude }>;

export function sitesModel(db: DbClient) {
  return {
    findAll(): Promise<Site[]> {
      return db.site.findMany({ orderBy: { id: 'asc' } });
    },

    findById(id: string): Promise<Site | null> {
      return db.site.findUnique({ where: { id } });
    },

    findByIdWithMachines(id: string): Promise<SiteDetailRecord | null> {
      return db.site.findUnique({ where: { id }, include: siteDetailInclude });
    },

    // Sets the site's status to `to` if it isn't already; returns true if it changed. The
    // site row stays locked until the transaction ends, so two status changes for the same
    // site run one after the other.
    async changeStatus(id: string, to: SiteStatus): Promise<boolean> {
      const { count } = await db.site.updateMany({
        where: { id, status: { not: to } },
        data: { status: to },
      });
      return count === 1;
    },
  };
}
