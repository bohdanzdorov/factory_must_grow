// Routing an order: loads the data, runs the pure routing function, and saves the decision,
// its candidates and the job holding the slot, all in one transaction.
import type { OrderDecisionResult, RoutingDecision } from '@factorymustgrow/shared';
import { getClock } from '../config/clock.js';
import { db, type Models } from '../config/database.js';
import { env } from '../config/env.js';
import { canChangeOrderStatus } from '../domain/order-status.js';
import { routeOrder as decideRoute } from '../domain/routing.js';
import { HttpError } from '../errors/http-error.js';
import type { Order, RoutingDecisionKind } from '../generated/prisma/client.js';
import { toOrder } from '../mappers/order.mapper.js';
import { toNewCandidates, toRoutingDecision } from '../mappers/routing-decision.mapper.js';
import { ChosenMachineFailedError, inBookingTransaction } from './booking-retry.service.js';

export async function routeOrder(orderId: string): Promise<OrderDecisionResult> {
  return inBookingTransaction((tx) => routeOnce(tx, orderId), { orderId });
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

  const proposal = await proposeRoute(tx, order, { kind: 'INITIAL', supersedesId: null });

  const updatedOrder = proposal.booked
    ? await tx.orders.updateStatus(orderId, 'ROUTED', null)
    : await tx.orders.updateStatus(orderId, 'BLOCKED', proposal.explanation);

  // Read back, so the response includes the job created inside proposeRoute.
  const saved = await tx.routingDecisions.findById(proposal.decisionId);
  if (!saved) {
    throw new Error(
      `Routing decision ${proposal.decisionId} disappeared inside its own transaction`,
    );
  }

  return { order: toOrder(updatedOrder), decision: toRoutingDecision(saved) };
}

export interface ProposedRoute {
  decisionId: string;
  // True if a machine was chosen and its slot booked; false if no machine fits.
  booked: boolean;
  explanation: string;
}

// Routes the order and saves the result: a PROPOSED decision with its job booked, or a
// NO_ELIGIBLE_MACHINE decision with no job. Doesn't change the order's status; the caller
// does that (ROUTED for a first routing, REROUTE_PENDING for a reroute, or BLOCKED).
//
// `kind` and `supersedesId` say whether this is a first routing or a reroute, and which
// decision it replaces. `reason`, if given, starts the explanation (why it was rerouted).
//
// Throws a booking conflict or ChosenMachineFailedError when something changed at the same
// moment; run it inside inBookingTransaction, which routes again.
export async function proposeRoute(
  tx: Models,
  order: Order,
  options: { kind: RoutingDecisionKind; supersedesId: string | null; reason?: string },
): Promise<ProposedRoute> {
  const clock = getClock();
  const now = clock.now();

  const machines = await tx.machines.findMany({});
  const sites = await tx.sites.findAll();
  const reservations = await tx.jobs.findActiveReservations(now);
  const shippingDays = await tx.shippingLeadTimes.daysToDestination(order.destination);
  const excludedMachineIds = await tx.routingDecisions.findRejectedMachineIds(order.id);

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

  if (chosen) {
    // The machines were read without a lock, so the chosen one may have failed since. Lock
    // it and look again: if it failed, nothing is saved and routing runs again. This also
    // makes a failure in progress on it finish first, so we never book on a machine whose
    // jobs the failure has already collected.
    const status = await tx.machines.lockAndReadStatus(chosen.machineId);
    if (status === 'ERROR' || status === 'OFFLINE') {
      throw new ChosenMachineFailedError(chosen.machineId);
    }
  }

  const explanation = options.reason
    ? `${options.reason} ${result.explanation}`
    : result.explanation;

  const decision = await tx.routingDecisions.insert({
    orderId: order.id,
    kind: options.kind,
    status: chosen ? 'PROPOSED' : 'NO_ELIGIBLE_MACHINE',
    chosenMachineId: chosen?.machineId ?? null,
    explanation,
    supersedesId: options.supersedesId,
    createdAt: now,
    candidates: toNewCandidates(result),
  });

  if (chosen) {
    // A chosen machine always has a slot. If not, routing has a bug: fail loudly rather than
    // save a proposal that books nothing.
    if (!chosen.earliestStart || !chosen.finishAt) {
      throw new Error(`Routing chose ${chosen.machineId} without a time slot`);
    }

    // Fails with a job_no_overlap error if another request took this slot meanwhile.
    await tx.jobs.insert({
      routingDecisionId: decision.id,
      machineId: chosen.machineId,
      plannedStart: chosen.earliestStart,
      plannedEnd: chosen.finishAt,
    });
  }

  return { decisionId: decision.id, booked: chosen !== null, explanation };
}

export async function listDecisions(orderId: string): Promise<RoutingDecision[]> {
  if (!(await db.orders.findById(orderId))) {
    throw new HttpError(404, `Order not found: ${orderId}`);
  }

  const records = await db.routingDecisions.findByOrderId(orderId);

  return records.map(toRoutingDecision);
}
