// What machines send: heartbeats (answered with their pending commands) and events.
// See "Ingest API" in docs/design-decisions.md.
import type {
  CommandType,
  HeartbeatResponse,
  MachineCommand,
  MachineEventRequest,
  MachineEventResponse,
  MachineEventType,
} from '@factorymustgrow/shared';
import { getClock } from '../config/clock.js';
import { transaction } from '../config/database.js';
import { logger } from '../config/logger.js';
import { HttpError } from '../errors/http-error.js';
import { toMachineCommand } from '../mappers/command.mapper.js';

// The command each event confirms. Job commands are matched by their jobId too.
const CONFIRMS: Record<MachineEventType, CommandType | null> = {
  JOB_STARTED: 'START_JOB',
  JOB_CANCELLED: 'CANCEL_JOB',
  MACHINE_FAILURE: 'FAIL',
  MACHINE_RESET: 'RESET',
  JOB_COMPLETED: null,
};
const JOB_COMMANDS: CommandType[] = ['START_JOB', 'CANCEL_JOB'];

// Records the heartbeat and returns the machine's unconfirmed commands, oldest first.
// Commands are sent on every heartbeat until their event arrives, so a lost response loses
// nothing. The machine's status is not changed here: status changes come from events.
export async function recordHeartbeat(machineId: string): Promise<HeartbeatResponse> {
  return transaction(async (tx) => {
    const found = await tx.machines.recordHeartbeat(machineId, getClock().now());
    if (!found) {
      throw new HttpError(404, `Machine not found: ${machineId}`);
    }

    const commands: MachineCommand[] = [];
    const newlyDelivered: string[] = [];

    for (const record of await tx.commands.findOpen(machineId)) {
      const command = toMachineCommand(record);
      if (!command) {
        // A 500 would block every heartbeat from this machine, which would then look offline.
        // Commands are checked when created, so this only catches a bug.
        logger.error({ commandId: record.id, machineId }, 'Stored command is invalid; not sent');
        continue;
      }
      commands.push(command);
      if (record.status === 'PENDING') newlyDelivered.push(record.id);
    }

    await tx.commands.markDelivered(newlyDelivered);

    return { commands };
  });
}

// Stores the event once and acknowledges the command it confirms. What the event means for
// the machine, its jobs and orders comes in later tasks (W3-04, W3-10).
export async function receiveEvent(
  machineId: string,
  event: MachineEventRequest,
): Promise<MachineEventResponse> {
  return transaction(async (tx) => {
    if (!(await tx.machines.exists(machineId))) {
      throw new HttpError(404, `Machine not found: ${machineId}`);
    }

    const stored = await tx.machineEvents.insertIfNew({
      machineId,
      eventId: event.eventId,
      seq: BigInt(event.seq),
      type: event.type,
      payload: event.payload,
      receivedAt: getClock().now(),
    });
    if (!stored) {
      // Already processed when it first arrived; doing it again would apply it twice.
      return { result: 'DUPLICATE' };
    }

    const commandType = CONFIRMS[event.type];
    if (commandType) {
      const { jobId } = event.payload;
      if (!JOB_COMMANDS.includes(commandType)) {
        await tx.commands.acknowledge({ machineId, type: commandType });
      } else if (jobId !== undefined) {
        await tx.commands.acknowledge({ machineId, type: commandType, jobId });
      }
      // A job event without a jobId confirms nothing, rather than every job command.
    }

    return { result: 'STORED' };
  });
}
