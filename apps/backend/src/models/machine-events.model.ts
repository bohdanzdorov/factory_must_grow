import type { DbClient } from '../config/prisma.js';
import type { MachineEventType, Prisma } from '../generated/prisma/client.js';

export interface NewMachineEvent {
  machineId: string;
  eventId: string;
  seq: bigint;
  type: MachineEventType;
  payload: Prisma.InputJsonValue;
  receivedAt: Date;
}

export function machineEventsModel(db: DbClient) {
  return {
    // Stores the event unless one with the same (machineId, eventId) is already stored.
    // Returns false for a duplicate.
    //
    // ON CONFLICT DO NOTHING (skipDuplicates) rather than catching the unique-constraint
    // error: an error inside a Postgres transaction aborts the whole transaction, while
    // skipping keeps it usable. A duplicate sent at the same moment waits for the first
    // insert to commit, then is skipped.
    async insertIfNew(event: NewMachineEvent): Promise<boolean> {
      const { count } = await db.machineEvent.createMany({ data: [event], skipDuplicates: true });
      return count === 1;
    },
  };
}
