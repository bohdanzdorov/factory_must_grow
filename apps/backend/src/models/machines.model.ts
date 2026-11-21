import type { DbClient } from '../config/prisma.js';
import type { MachineStatus, Prisma } from '../generated/prisma/client.js';

// Machines that are expected to be sending heartbeats.
export const WORKING_STATUSES: MachineStatus[] = ['IDLE', 'RUNNING'];

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

    // Ids of working machines (IDLE or RUNNING) last heard from before `cutoff`. A machine
    // that has never sent a heartbeat (lastHeartbeatAt is null) is not included.
    async findSilentSince(cutoff: Date): Promise<string[]> {
      const machines = await db.machine.findMany({
        where: { status: { in: WORKING_STATUSES }, lastHeartbeatAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      return machines.map((machine) => machine.id);
    },

    // Sets the machine's status to `to`, but only if it is currently one of `from` (and, with
    // `lastHeartbeatBefore`, only if it is still silent since then). Returns true if it changed.
    // The condition is checked in the same UPDATE, so a heartbeat or status change that lands
    // at the same moment is never overwritten.
    async changeStatus(
      id: string,
      change: { from: MachineStatus[]; to: MachineStatus; lastHeartbeatBefore?: Date },
    ): Promise<boolean> {
      const { count } = await db.machine.updateMany({
        where: {
          id,
          status: { in: change.from },
          ...(change.lastHeartbeatBefore === undefined
            ? {}
            : { lastHeartbeatAt: { lt: change.lastHeartbeatBefore } }),
        },
        data: { status: change.to },
      });
      return count === 1;
    },
  };
}
