import type { DbClient } from '../config/prisma.js';
import type { Prisma, Site } from '../generated/prisma/client.js';
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

    findByIdWithMachines(id: string): Promise<SiteDetailRecord | null> {
      return db.site.findUnique({ where: { id }, include: siteDetailInclude });
    },
  };
}
