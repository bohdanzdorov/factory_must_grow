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

    // Moves the machine's lastSeq up to `seq` if `seq` is higher than every event seq
    // processed so far. Returns true if it moved (the event is the newest yet), false if an
    // event with an equal or higher seq was already processed (the event is stale).
    //
    // One conditional UPDATE, not a read and then a write: the database compares and writes in
    // one step, so two events processed at the same moment can't both count as newest. When it
    // moves, the machine row stays locked until the transaction ends, so a machine's events are
    // processed one after another.
    async advanceSeq(id: string, seq: bigint): Promise<boolean> {
      const { count } = await db.machine.updateMany({
        where: { id, lastSeq: { lt: seq } },
        data: { lastSeq: seq },
      });
      return count === 1;
    },
  };
}
