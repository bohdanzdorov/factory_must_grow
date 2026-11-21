import type { DbClient } from '../config/prisma.js';
import type { Command, CommandStatus, CommandType, Prisma } from '../generated/prisma/client.js';

// Commands the machine hasn't confirmed yet. Both are sent in every heartbeat response:
// DELIVERED means it was handed out at least once, not that the machine received it.
export const OPEN_COMMAND_STATUSES: CommandStatus[] = ['PENDING', 'DELIVERED'];

export function commandsModel(db: DbClient) {
  return {
    // The machine's unconfirmed commands, oldest first, so they run in the order given.
    findOpen(machineId: string): Promise<Command[]> {
      return db.command.findMany({
        where: { machineId, status: { in: OPEN_COMMAND_STATUSES } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    },

    // PENDING → DELIVERED for these commands; returns how many changed.
    async markDelivered(ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;
      const { count } = await db.command.updateMany({
        where: { id: { in: ids }, status: 'PENDING' },
        data: { status: 'DELIVERED' },
      });
      return count;
    },

    // Queues a command for the machine; it is sent with its next heartbeat.
    insert(data: {
      machineId: string;
      type: CommandType;
      payload: Prisma.InputJsonValue;
      createdAt: Date;
    }): Promise<Command> {
      return db.command.create({ data });
    },

    // Marks the machine's open commands of this type CANCELLED; returns how many changed.
    async cancelOpen(machineId: string, type: CommandType): Promise<number> {
      const { count } = await db.command.updateMany({
        where: { machineId, type, status: { in: OPEN_COMMAND_STATUSES } },
        data: { status: 'CANCELLED' },
      });
      return count;
    },

    // Whether a START_JOB for this job was ever handed to the machine (DELIVERED or ACKED),
    // so the machine may have started it.
    async wasStartSent(machineId: string, jobId: string): Promise<boolean> {
      const count = await db.command.count({
        where: {
          machineId,
          type: 'START_JOB',
          status: { in: ['DELIVERED', 'ACKED'] },
          payload: { path: ['jobId'], equals: jobId },
        },
      });
      return count > 0;
    },

    // Marks the machine's open commands of this type ACKED; returns how many changed.
    // With `jobId`, only commands whose payload names that job. Conditional on the status,
    // so acknowledging twice changes nothing the second time.
    async acknowledge(filter: {
      machineId: string;
      type: CommandType;
      jobId?: string;
    }): Promise<number> {
      const { count } = await db.command.updateMany({
        where: {
          machineId: filter.machineId,
          type: filter.type,
          status: { in: OPEN_COMMAND_STATUSES },
          ...(filter.jobId === undefined
            ? {}
            : { payload: { path: ['jobId'], equals: filter.jobId } }),
        },
        data: { status: 'ACKED' },
      });
      return count;
    },
  };
}
