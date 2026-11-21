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
import { transaction, type Models } from '../config/database.js';
import { logger } from '../config/logger.js';
import { HttpError } from '../errors/http-error.js';
import { toMachineCommand } from '../mappers/command.mapper.js';
import { inBookingTransaction } from './booking-retry.service.js';
import { handleMachineFailure } from './machine-failure.service.js';

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

// Stores the event once, acknowledges the command it confirms, and, if it is the newest event
// from the machine so far, applies what it means: MACHINE_FAILURE marks the machine ERROR.
export async function receiveEvent(
  machineId: string,
  event: MachineEventRequest,
): Promise<MachineEventResponse> {
  // A failure reroutes orders, which books jobs: retried if a booking clashes at the same moment.
  return inBookingTransaction(
    async (tx) => {
      if (!(await tx.machines.exists(machineId))) {
        throw new HttpError(404, `Machine not found: ${machineId}`);
      }

      // 1. Is this the newest event from this machine? If so, lastSeq moves up to its seq.
      //    A duplicate always counts as not newest (its original already moved lastSeq to at
      //    least this seq), so this changes nothing for a duplicate.
      const newest = await tx.machines.advanceSeq(machineId, BigInt(event.seq));

      // 2. Store it, flagged stale if a newer event came first.
      const stored = await tx.machineEvents.insertIfNew({
        machineId,
        eventId: event.eventId,
        seq: BigInt(event.seq),
        type: event.type,
        payload: event.payload,
        receivedAt: getClock().now(),
        stale: !newest,
      });
      if (!stored) {
        // Already processed when it first arrived; doing it again would apply it twice.
        return { result: 'DUPLICATE' };
      }

      // 3. The event is a receipt for its command. That stays true whatever order events
      //    arrive in, so a stale event acknowledges its command too.
      await acknowledgeConfirmedCommand(tx, machineId, event);

      // 4. The event is also news about the machine. A stale event's news is out of date, and
      //    applying it would overwrite newer state (rule 7), so it stops here.
      if (!newest) {
        return { result: 'STALE' };
      }

      // 5. Apply the event's news. Job events (JOB_STARTED, JOB_COMPLETED) come later.
      if (event.type === 'MACHINE_FAILURE') {
        // Marks the machine ERROR and moves its work to other machines.
        await handleMachineFailure(tx, machineId, { type: 'REPORTED' });
      }

      return { result: 'STORED' };
    },
    { machineId, eventId: event.eventId },
  );
}

// Marks the command this event confirms as ACKED; see CONFIRMS.
async function acknowledgeConfirmedCommand(
  tx: Models,
  machineId: string,
  event: MachineEventRequest,
): Promise<void> {
  const type = CONFIRMS[event.type];

  // JOB_COMPLETED: no command asks a job to finish.
  if (type === null) return;

  // FAIL and RESET are about the whole machine: every open one is confirmed.
  if (!JOB_COMMANDS.includes(type)) {
    await tx.commands.acknowledge({ machineId, type });
    return;
  }

  // START_JOB and CANCEL_JOB are about one job: only the one for this job is confirmed.
  // A job event that doesn't say which job confirms nothing, rather than every job command.
  const { jobId } = event.payload;
  if (jobId === undefined) return;

  await tx.commands.acknowledge({ machineId, type, jobId });
}
