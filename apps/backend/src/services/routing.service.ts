// Routing an order: loads the data, runs the pure routing function, and saves the decision,
// its candidates and the job holding the slot, all in one transaction.
import type { OrderDecisionResult, RoutingDecision } from '@factorymustgrow/shared';
import { getClock } from '../config/clock.js';
import { db, transaction, type Models } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { canChangeOrderStatus } from '../domain/order-status.js';
import { routeOrder as decideRoute } from '../domain/routing.js';
import { isJobOverlapError } from '../errors/database-errors.js';
import { HttpError } from '../errors/http-error.js';
import { toOrder } from '../mappers/order.mapper.js';
import { toNewCandidates, toRoutingDecision } from '../mappers/routing-decision.mapper.js';

// If another request books the same slot first, the job insert fails on the job_no_overlap
// constraint and everything rolls back. Routing again with fresh data finds the next slot.
const MAX_ATTEMPTS = 3;

export async function routeOrder(orderId: string): Promise<OrderDecisionResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await transaction((tx) => routeOnce(tx, orderId));
    } catch (err) {
      if (!isJobOverlapError(err)) throw err;

      if (attempt >= MAX_ATTEMPTS) {
        throw new HttpError(
          409,
          'Could not book a slot because machines are being booked at the same time. Try again.',
        );
      }
      logger.info({ orderId, attempt }, 'Slot was taken during routing; retrying');
    }
  }
}

async function routeOnce(tx: Models, orderId: string): Promise<OrderDecisionResult> {
  // Two route requests for the same order now run one after the other, so the second
  // sees the first one's result and fails the status check below.
  if (!(await tx.orders.lockById(orderId))) {
    throw new HttpError(404, `Order not found: ${orderId}`);
  }

  const order = await tx.orders.findById(orderId);
  if (!order) {
    throw new HttpError(404, `Order not found: ${orderId}`);
  }

  // Allowed exactly from DRAFT (first routing) and BLOCKED (retry), per the state machine.
  if (!canChangeOrderStatus(order.status, 'ROUTED')) {
    throw new HttpError(
      409,
      `Order ${orderId} is ${order.status}; only DRAFT or BLOCKED orders can be routed.`,
    );
  }

  const clock = getClock();
  const now = clock.now();

  const machines = await tx.machines.findMany({});
  const sites = await tx.sites.findAll();
  const reservations = await tx.jobs.findActiveReservations(now);
  const shippingDays = await tx.shippingLeadTimes.daysToDestination(order.destination);
  const excludedMachineIds = await tx.routingDecisions.findRejectedMachineIds(orderId);

  const result = decideRoute({
    order,
    machines: machines.map((machine) => ({
      id: machine.id,
      siteId: machine.siteId,
      status: machine.status,
      capabilities: machine.capabilities.map((capability) => ({
        capability: capability.capability,
        cycleMinutesPerPart: capability.cycleMinutesPerPart.toNumber(),
      })),
    })),
    sites,
    reservations,
    shippingDays,
    excludedMachineIds,
    now,
    // The window is set in real seconds; the clock scale turns it into simulated time.
    approvalWindowMs: env.APPROVAL_WINDOW_SECONDS * 1000 * clock.scale,
  });

  const chosen = result.chosen;

  const decision = await tx.routingDecisions.insert({
    orderId,
    kind: 'INITIAL',
    status: chosen ? 'PROPOSED' : 'NO_ELIGIBLE_MACHINE',
    chosenMachineId: chosen?.machineId ?? null,
    explanation: result.explanation,
    supersedesId: null,
    createdAt: now,
    candidates: toNewCandidates(result),
  });

  if (chosen?.earliestStart && chosen.finishAt) {
    // Fails with a job_no_overlap error if another request took this slot meanwhile.
    await tx.jobs.insert({
      routingDecisionId: decision.id,
      machineId: chosen.machineId,
      plannedStart: chosen.earliestStart,
      plannedEnd: chosen.finishAt,
    });
  }

  const updatedOrder = chosen
    ? await tx.orders.updateStatus(orderId, 'ROUTED', null)
    : await tx.orders.updateStatus(orderId, 'BLOCKED', result.explanation);

  // Read back, so the response includes the job created above.
  const saved = await tx.routingDecisions.findById(decision.id);
  if (!saved) {
    throw new Error(`Routing decision ${decision.id} disappeared inside its own transaction`);
  }

  return { order: toOrder(updatedOrder), decision: toRoutingDecision(saved) };
}

export async function listDecisions(orderId: string): Promise<RoutingDecision[]> {
  if (!(await db.orders.findById(orderId))) {
    throw new HttpError(404, `Order not found: ${orderId}`);
  }

  const records = await db.routingDecisions.findByOrderId(orderId);

  return records.map(toRoutingDecision);
}
