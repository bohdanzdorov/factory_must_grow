// What machines send: heartbeats (answered with their pending commands) and events.
// See "Ingest API" in docs/design-decisions.md.
import type {
  CommandType,
  HeartbeatRequest,
  HeartbeatResponse,
  MachineCommand,
  MachineEventRequest,
  MachineEventResponse,
  MachineEventType,
} from '@factorymustgrow/shared';
import { getClock } from '../config/clock.js';
import { inBookingTransaction, transaction, type Models } from '../config/database.js';
import { logger } from '../config/logger.js';
import { HttpError } from '../errors/http-error.js';
import { toMachineCommand } from '../mappers/command.mapper.js';
import { requestBlockedOrderRetry } from '../operations/blocked-orders.js';
import { handleMachineFailure } from '../operations/machine-failure.js';
import { handleMachineRecovery } from '../operations/machine-recovery.js';

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
// nothing. The only status change a heartbeat makes is ending OFFLINE (see
// operations/machine-recovery.ts): OFFLINE means we stopped hearing from the machine, so
// hearing from it again is what ends it. Every other status change comes from events.
export async function recordHeartbeat(
  machineId: string,
  report: HeartbeatRequest,
): Promise<HeartbeatResponse> {
  const { response, backOnline } = await transaction(async (tx) => {
    const found = await tx.machines.recordHeartbeat(machineId, getClock().now());
    if (!found) {
      throw new HttpError(404, `Machine not found: ${machineId}`);
    }

    const back = await handleMachineRecovery(tx, machineId, {
      type: 'HEARTBEAT',
      reported: report.state,
    });

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

    return { response: { commands }, backOnline: back };
  });

  // Retried in the background, after this transaction is saved, so the heartbeat stays fast.
  if (backOnline) requestBlockedOrderRetry();
  return response;
}

// Stores the event once, acknowledges the command it confirms, and, if it is the newest event
// from the machine so far, applies what it means: MACHINE_FAILURE marks the machine ERROR,
// MACHINE_RESET brings it back.
export async function receiveEvent(
  machineId: string,
  event: MachineEventRequest,
): Promise<MachineEventResponse> {
  // A failure locks the machine and then its orders, while routing locks an order and then a
  // machine. At the same moment, the two can deadlock: run again if they do.
  const { response, retryBlocked } = await inBookingTransaction(
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
        return done('DUPLICATE');
      }

      // 3. The event is a receipt for its command. That stays true whatever order events
      //    arrive in, so a stale event acknowledges its command too.
      await acknowledgeConfirmedCommand(tx, machineId, event);

      // 4. The event is also news about the machine. A stale event's news is out of date, and
      //    applying it would overwrite newer state (rule 7), so it stops here.
      if (!newest) {
        return done('STALE');
      }

      // 5. Apply the event's news. Job events (JOB_STARTED, JOB_COMPLETED) come later.
      if (event.type === 'MACHINE_FAILURE') {
        // Marks the machine ERROR and frees its work; its orders wait to be rerouted.
        return done('STORED', await handleMachineFailure(tx, machineId, { type: 'REPORTED' }));
      }
      if (event.type === 'MACHINE_RESET') {
        // Brings a broken machine back.
        return done('STORED', await handleMachineRecovery(tx, machineId, { type: 'RESET' }));
      }

      return done('STORED');
    },
    { machineId, eventId: event.eventId },
  );

  // A failure leaves orders waiting for a new machine, and a reset may make room for blocked
  // orders: both are rerouted in the background, after this transaction is saved.
  if (retryBlocked) requestBlockedOrderRetry();
  return response;
}

function done(result: MachineEventResponse['result'], retryBlocked = false) {
  return { response: { result }, retryBlocked };
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
