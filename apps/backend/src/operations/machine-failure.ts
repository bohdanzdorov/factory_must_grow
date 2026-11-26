// What happens when a machine fails. Both ways of finding out end up here, so they behave the
// same: the machine says so (a MACHINE_FAILURE event), or it goes silent (missed heartbeats).
// See "Failure detection" and "Failure handling" in docs/design-decisions.md.
import { getClock } from '../config/clock.js';
import type { Models } from '../config/database.js';
import { logger } from '../config/logger.js';
import { canChangeOrderStatus } from '../domain/order-status.js';
import type { MachineStatus, OrderStatus } from '../generated/prisma/client.js';
import { WORKING_STATUSES } from '../models/machines.model.js';
import { proposeRoute } from './propose-route.js';

export type FailureReason =
  // The machine reported MACHINE_FAILURE: it becomes ERROR.
  | { type: 'REPORTED' }
  // No heartbeat since `lastHeartbeatBefore`: it becomes OFFLINE.
  | { type: 'SILENT'; lastHeartbeatBefore: Date }
  // An operator set its site DOWN: it becomes OFFLINE.
  | { type: 'SITE_DOWN'; siteId: string };

// Marks the machine as failed and moves its work elsewhere: its jobs are freed, and each
// affected order gets a reroute proposal (REROUTE_PENDING) or is BLOCKED with a reason.
// Returns true if the machine's status changed, false if there was nothing to do (it was
// already failed, or a heartbeat arrived just in time). Safe to call twice: the second call
// finds the machine already failed and does nothing.
//
// Books jobs, so run it inside inBookingTransaction (config/database.ts).
export async function handleMachineFailure(
  tx: Models,
  machineId: string,
  reason: FailureReason,
): Promise<boolean> {
  const newStatus = await markFailed(tx, machineId, reason);
  if (newStatus === null) return false;

  await moveWorkOffMachine(tx, machineId, newStatus, explain(machineId, newStatus, reason));
  return true;
}

// Step 1: the status. Returns the new status, or null if it didn't change.
async function markFailed(
  tx: Models,
  machineId: string,
  reason: FailureReason,
): Promise<MachineStatus | null> {
  if (reason.type === 'REPORTED') {
    // From IDLE, RUNNING or OFFLINE. OFFLINE is included because we can hear the machine
    // again, and it says it is broken.
    const changed = await tx.machines.changeStatus(machineId, {
      from: [...WORKING_STATUSES, 'OFFLINE'],
      to: 'ERROR',
    });
    if (!changed) return null;
    logger.warn({ machineId }, 'Machine reported a failure; now ERROR');
    return 'ERROR';
  }

  if (reason.type === 'SITE_DOWN') {
    // From IDLE or RUNNING. A machine in ERROR stays ERROR: it still needs a reset.
    const changed = await tx.machines.changeStatus(machineId, {
      from: WORKING_STATUSES,
      to: 'OFFLINE',
    });
    if (!changed) return null;
    logger.warn({ machineId, siteId: reason.siteId }, 'Site went down; machine now OFFLINE');
    return 'OFFLINE';
  }

  // From IDLE or RUNNING only, and only if it is still silent. A machine in ERROR that goes
  // quiet stays ERROR: it is already unavailable, and ERROR ends with MACHINE_RESET.
  const changed = await tx.machines.changeStatus(machineId, {
    from: WORKING_STATUSES,
    to: 'OFFLINE',
    lastHeartbeatBefore: reason.lastHeartbeatBefore,
  });
  if (!changed) return null;
  logger.warn({ machineId }, 'Machine went silent; now OFFLINE');
  return 'OFFLINE';
}

// The sentence that starts each reroute's explanation (and a blocked order's reason).
function explain(machineId: string, newStatus: MachineStatus, reason: FailureReason): string {
  if (reason.type === 'SITE_DOWN') {
    return `Machine ${machineId} failed (${newStatus}): site ${reason.siteId} is down.`;
  }
  return `Machine ${machineId} failed (${newStatus}).`;
}

// Steps 2 to 5: free the machine's jobs and reroute the orders they belonged to.
async function moveWorkOffMachine(
  tx: Models,
  machineId: string,
  newStatus: MachineStatus,
  explanation: string,
): Promise<void> {
  const now = getClock().now();

  // Step 2: lock the orders whose jobs are on this machine, so an approval or rejection at
  // the same moment waits for us. Then read the jobs again: one of those may have just
  // changed them before we got the lock.
  const jobsBeforeLock = await tx.jobs.findActiveOnMachine(machineId);
  const orderIds = [...new Set(jobsBeforeLock.map((job) => job.routingDecision.orderId))];
  await tx.orders.lockByIds(orderIds);
  const jobs = orderIds.length > 0 ? await tx.jobs.findActiveOnMachine(machineId) : [];

  // Step 3: free each job. For each order, remember the decision being replaced, so the new
  // decision can link to it.
  const replacedDecisionByOrder = new Map<string, string>();

  for (const job of jobs) {
    const decision = job.routingDecision;

    if (decision.status === 'PROPOSED') {
      // A proposal nobody approved yet: it is replaced by the new one, and its slot is freed.
      await tx.jobs.changeStatusIfActive(job.id, 'CANCELLED');
      await tx.routingDecisions.changeStatus(decision.id, 'PROPOSED', 'SUPERSEDED');
    } else if (decision.status === 'APPROVED') {
      // Approved work: the job is kept, marked RELEASED, so nothing is lost.
      // An OFFLINE machine may still be running (it only lost its network). If it may have
      // started this job, queue a CANCEL_JOB now; it goes out with the machine's first
      // heartbeat when it reconnects. A machine in ERROR has already dropped its job.
      if (
        newStatus === 'OFFLINE' &&
        (job.status === 'RUNNING' || (await tx.commands.wasStartSent(machineId, job.id)))
      ) {
        await tx.commands.insert({
          machineId,
          type: 'CANCEL_JOB',
          payload: { jobId: job.id },
          createdAt: now,
        });
      }
      await tx.jobs.changeStatusIfActive(job.id, 'RELEASED');
    } else {
      // Rejected, expired and superseded decisions have no active jobs; if one ever does,
      // it is a bug elsewhere. Leave it rather than guess.
      logger.error({ jobId: job.id, decision }, 'Active job on a decision that is not live');
      continue;
    }

    replacedDecisionByOrder.set(decision.orderId, decision.id);
  }

  // Step 4: it must not be told to start work it no longer has. Only START_JOB: a queued
  // RESET is how it comes back, and a queued CANCEL_JOB must still reach it. This comes after
  // step 3, which needs to see which START_JOBs were already handed out.
  await tx.commands.cancelOpen(machineId, 'START_JOB');

  // Step 5: reroute each order, most urgent deadline first, so it gets the first free slot.
  // Routing skips this machine on its own: it is ERROR or OFFLINE now.
  const orders = await tx.orders.findManyByIdsByDeadline([...replacedDecisionByOrder.keys()]);

  for (const order of orders) {
    const proposal = await proposeRoute(tx, order, {
      kind: 'REROUTE',
      supersedesId: replacedDecisionByOrder.get(order.id) ?? null,
      reason: explanation,
    });

    const to: OrderStatus = proposal.booked ? 'REROUTE_PENDING' : 'BLOCKED';
    if (!canChangeOrderStatus(order.status, to)) {
      throw new Error(`Order ${order.id} is ${order.status} and cannot become ${to}`);
    }
    await tx.orders.updateStatus(order.id, to, proposal.booked ? null : proposal.explanation);

    logger.info(
      { orderId: order.id, machineId, outcome: to, decisionId: proposal.decisionId },
      proposal.booked ? 'Order rerouted; waiting for approval' : 'Order blocked; no machine fits',
    );
  }
}
