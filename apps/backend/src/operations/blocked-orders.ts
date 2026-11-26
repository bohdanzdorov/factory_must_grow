// Routing BLOCKED orders again, one order per transaction. Two kinds of order are BLOCKED:
// - orders whose machine just failed, waiting for a new one (operations/machine-failure.ts);
// - orders that fit nowhere, worth another try after a machine comes back.
// See "Failure handling" and "Recovery" in docs/design-decisions.md.
//
// A failure or recovery only asks for a retry (requestBlockedOrderRetry); the background loop
// in index.ts does the routing a moment later (retryBlockedOrdersIfRequested). Routing many
// orders is slow, and failures and recoveries happen inside machine requests, which must stay
// fast: a slow heartbeat looks like a dead machine.
import { db, inBookingTransaction, type Models } from '../config/database.js';
import { logger } from '../config/logger.js';
import { planNextRouting, proposeRoute } from './propose-route.js';

// In memory. The backend asks for a retry when it starts (index.ts), so a request lost in a
// restart is made up for straight away.
let retryRequested = false;

// How many retries in a row crashed, per order. A crash asks for another retry, but only this
// many times in a row: an order that crashes every time would otherwise be retried every
// second forever, logging an error each time. After that it waits, still BLOCKED, for the next
// failure, recovery or restart, which tries it once more.
const MAX_CRASHES_IN_A_ROW = 3;
const crashesInARow = new Map<string, number>();

// Asks for blocked orders to be retried on the background loop's next run.
export function requestBlockedOrderRetry(): void {
  retryRequested = true;
}

// Retries blocked orders if a retry was asked for since the last run. Returns the ids of the
// orders that got a proposal.
export async function retryBlockedOrdersIfRequested(): Promise<string[]> {
  if (!retryRequested) return [];
  retryRequested = false;
  return retryBlockedOrders();
}

// Routes every BLOCKED order again, most urgent deadline first, so it gets the first free
// slot. An order that now fits gets a proposal: a reroute (REROUTE_PENDING) for one whose
// machine failed, a first proposal (ROUTED) otherwise. One that still fits nowhere stays
// BLOCKED; a "no eligible machine" decision is saved only if it doesn't have one already, so
// retries don't fill its history. Returns the ids of the orders that got a proposal.
export async function retryBlockedOrders(): Promise<string[]> {
  const blocked = await db.orders.findManyByStatusByDeadline('BLOCKED');
  const routed: string[] = [];

  // One transaction per order: one order's trouble can't undo or hold up another's.
  let retryAgain = false;
  for (const order of blocked) {
    try {
      const gotProposal = await inBookingTransaction((tx) => retryOne(tx, order.id), {
        orderId: order.id,
      });
      crashesInARow.delete(order.id);
      if (gotProposal) routed.push(order.id);
    } catch (err) {
      // Its transaction rolled back, so it is still BLOCKED. Ask again, so it isn't left
      // waiting for some unrelated failure or recovery to trigger the next retry, unless it
      // keeps crashing.
      const crashes = (crashesInARow.get(order.id) ?? 0) + 1;
      crashesInARow.set(order.id, crashes);
      if (crashes < MAX_CRASHES_IN_A_ROW) {
        retryAgain = true;
        logger.error({ err, orderId: order.id }, 'Retrying a blocked order failed; will try again');
      } else {
        logger.error(
          { err, orderId: order.id, crashes },
          'Retrying a blocked order keeps failing; it waits for the next failure, recovery or restart',
        );
      }
    }
  }
  if (retryAgain) requestBlockedOrderRetry();

  if (blocked.length > 0) {
    logger.info({ blocked: blocked.length, routed: routed.length }, 'Retried blocked orders');
  }
  return routed;
}

async function retryOne(tx: Models, orderId: string): Promise<boolean> {
  // Locked and read again: an operator may have routed it by hand in the meantime.
  await tx.orders.lockById(orderId);
  const order = await tx.orders.findById(orderId);
  if (order?.status !== 'BLOCKED') return false;

  const plan = await planNextRouting(tx, order);
  const proposal = await proposeRoute(tx, order, {
    kind: plan.kind,
    supersedesId: plan.supersedesId,
    reason: plan.reason,
    saveWhenNoMachine: !plan.alreadyExplained,
  });

  if (proposal.booked) {
    await tx.orders.updateStatus(orderId, plan.statusWhenBooked, null);
    return true;
  }
  // Still fits nowhere. If a decision was saved, it is now the reason it is blocked.
  if (proposal.decisionId) {
    await tx.orders.updateStatus(orderId, 'BLOCKED', proposal.explanation);
  }
  return false;
}
