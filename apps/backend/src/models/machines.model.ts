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

    async exists(id: string): Promise<boolean> {
      return (await db.machine.count({ where: { id } })) > 0;
    },

    // Records when the machine was last heard from; false if there is no such machine.
    async recordHeartbeat(id: string, at: Date): Promise<boolean> {
      const { count } = await db.machine.updateMany({
        where: { id },
        data: { lastHeartbeatAt: at },
      });
      return count === 1;
    },
  };
}
