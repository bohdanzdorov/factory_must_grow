// Retrying BLOCKED orders after a machine comes back. See "Recovery" in
// docs/design-decisions.md.
//
// A recovery only asks for a retry (requestBlockedOrderRetry); the background loop in index.ts
// does the routing a moment later (retryBlockedOrdersIfRequested). Routing every blocked
// order is slow, and a recovery usually happens inside a heartbeat request, which must stay
// fast: a slow heartbeat looks like a dead machine.
import { db, inBookingTransaction, type Models } from '../config/database.js';
import { logger } from '../config/logger.js';
import { proposeRoute } from './propose-route.js';

// In memory: a request lost in a restart only means blocked orders wait for the next
// recovery, or for "Try routing again".
let retryRequested = false;

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

// Routes every BLOCKED order again, most urgent deadline first. An order that now fits gets
// a proposal and becomes ROUTED; one that still doesn't stays BLOCKED, and nothing is saved
// for it. Returns the ids of the orders that got a proposal.
export async function retryBlockedOrders(): Promise<string[]> {
  const blocked = await db.orders.findManyByStatusByDeadline('BLOCKED');
  const routed: string[] = [];

  // One transaction per order: one order's trouble can't undo or hold up another's.
  for (const order of blocked) {
    try {
      const gotProposal = await inBookingTransaction((tx) => retryOne(tx, order.id), {
        orderId: order.id,
      });
      if (gotProposal) routed.push(order.id);
    } catch (err) {
      logger.error({ err, orderId: order.id }, 'Retrying a blocked order failed');
    }
  }

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

  const proposal = await proposeRoute(tx, order, {
    kind: 'INITIAL',
    supersedesId: null,
    saveWhenNoMachine: false,
  });
  if (!proposal.booked) return false;

  await tx.orders.updateStatus(orderId, 'ROUTED', null);
  return true;
}
