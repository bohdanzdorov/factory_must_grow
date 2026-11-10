import type { DbClient } from '../config/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';

export const machineInclude = {
  capabilities: { orderBy: { capability: 'asc' } },
} satisfies Prisma.MachineInclude;

export type MachineRecord = Prisma.MachineGetPayload<{ include: typeof machineInclude }>;

export function machinesModel(db: DbClient) {
  return {
    findMany(filter: { siteId?: string }): Promise<MachineRecord[]> {
      return db.machine.findMany({
        where: { siteId: filter.siteId },
        include: machineInclude,
        orderBy: { id: 'asc' },
      });
    },

    findById(id: string): Promise<MachineRecord | null> {
      return db.machine.findUnique({ where: { id }, include: machineInclude });
    },
  };
}
