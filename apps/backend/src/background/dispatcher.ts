// The dispatcher: turns approved plans into work on the machines. Runs every real second in
// the background (see index.ts); tests call its steps directly. Each run:
// 1. expires proposals nobody approved before their planned start;
// 2. queues a START_JOB for each machine whose next approved job is due.
// A queued command goes out with the machine's next heartbeat (services/ingest.service.ts).
// See "Dispatcher" in docs/design-decisions.md.
import { getClock } from '../config/clock.js';
import { db, inBookingTransaction, type Models } from '../config/database.js';
import { logger } from '../config/logger.js';
import { expireProposal, isOverdue } from '../operations/expire-proposal.js';

// How often the dispatcher runs, in real milliseconds.
export const DISPATCH_INTERVAL_MS = 1_000;

// A job that starts more than this late (in real time, converted with the clock scale) is
// logged as a warning: the backend was down, or the machine was still busy with the job
// before. It is started anyway, so nothing is lost; its deadline may suffer.
const LATE_START_WARNING_REAL_MS = 5_000;

export async function runDispatcher(): Promise<void> {
  // Expiry first: an overdue proposal must never be mistaken for work to start.
  await expireOverdueProposals();
  await startDueJobs();
}

// Expires every proposal whose booked job should already have started. Returns the ids of the
// decisions it expired.
export async function expireOverdueProposals(): Promise<string[]> {
  const now = getClock().now();
  const expired: string[] = [];

  // One transaction per proposal: one proposal's trouble can't undo or hold up another's.
  for (const decisionId of await db.routingDecisions.findOverdueProposalIds(now)) {
    try {
      const changed = await inBookingTransaction(
        (tx) => expireIfStillOverdue(tx, decisionId, now),
        {
          decisionId,
        },
      );
      if (changed) expired.push(decisionId);
    } catch (err) {
      // Rolled back, so it is still PROPOSED; the next run, a second later, tries again.
      logger.error({ err, decisionId }, 'Expiring a proposal failed');
    }
  }

  if (expired.length > 0) {
    logger.info({ decisions: expired }, 'Expired proposals nobody approved in time');
  }
  return expired;
}

async function expireIfStillOverdue(tx: Models, decisionId: string, now: Date): Promise<boolean> {
  const found = await tx.routingDecisions.findById(decisionId);
  if (!found) return false;

  // Locked, then read again: an approval at the same moment holds the same lock, so exactly
  // one of the two happens. If the approval went first, the decision is no longer PROPOSED.
  await tx.orders.lockById(found.orderId);
  const decision = await tx.routingDecisions.findById(decisionId);
  const order = await tx.orders.findById(found.orderId);
  if (decision?.status !== 'PROPOSED' || !order || !isOverdue(decision, now)) return false;

  await expireProposal(tx, decision, order);
  return true;
}

// Queues a START_JOB on every machine whose next approved job is due and that can take it.
// Returns the ids of the jobs it queued.
export async function startDueJobs(): Promise<string[]> {
  const now = getClock().now();
  const due = await db.jobs.findDueToStart(now);
  const machineIds = [...new Set(due.map((job) => job.machineId))];
  const started: string[] = [];

  // One transaction per machine, for the same reason as above.
  for (const machineId of machineIds) {
    try {
      const jobId = await inBookingTransaction((tx) => startNextJob(tx, machineId, now), {
        machineId,
      });
      if (jobId) started.push(jobId);
    } catch (err) {
      logger.error({ err, machineId }, 'Starting a job failed');
    }
  }

  return started;
}

// Queues a START_JOB for the machine's earliest due job, if the machine can take it now.
// Returns the job's id, or null if nothing was queued.
async function startNextJob(tx: Models, machineId: string, now: Date): Promise<string | null> {
  // Locked, then read again. A failure in progress on this machine holds its row, so this
  // waits until the failure is saved and then sees ERROR or OFFLINE. A failure that comes
  // after waits for us instead, and then cancels the START_JOB queued here. Either way, no
  // START_JOB is left open on a failed machine.
  const status = await tx.machines.lockAndReadStatus(machineId);
  if (status !== 'IDLE') return null;

  const machine = await tx.machines.findById(machineId);
  const site = machine ? await tx.sites.findById(machine.siteId) : null;
  if (site?.status !== 'UP') return null;

  // One job at a time. The machine still shows IDLE until its JOB_STARTED arrives, so
  // without this the next run would queue a second job beside the first.
  if (await tx.commands.hasOpen(machineId, 'START_JOB')) return null;

  // Read again inside the transaction: the job may have been released since. Skip jobs
  // already sent, so the same job is never started twice.
  let job = null;
  for (const candidate of await tx.jobs.findDueToStart(now, machineId)) {
    if (!(await tx.commands.wasStartQueued(candidate.id))) {
      job = candidate;
      break;
    }
  }
  if (!job) return null;

  await tx.commands.insert({
    machineId,
    type: 'START_JOB',
    payload: {
      jobId: job.id,
      plannedStart: job.plannedStart.toISOString(),
      plannedEnd: job.plannedEnd.toISOString(),
    },
    createdAt: now,
  });

  const lateMs = now.getTime() - job.plannedStart.getTime();
  if (lateMs > LATE_START_WARNING_REAL_MS * getClock().scale) {
    logger.warn(
      { machineId, jobId: job.id, lateSimulatedMinutes: Math.round(lateMs / 60_000) },
      'Starting a job late',
    );
  } else {
    logger.info({ machineId, jobId: job.id }, 'Job due; START_JOB queued');
  }
  return job.id;
}
