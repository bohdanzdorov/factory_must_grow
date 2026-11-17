// Approving and rejecting routing proposals, both first proposals and reroutes (rule 8).
// Every change is checked against the state machine in domain/order-status.ts.
import type { OrderDecisionResult, RejectDecisionInput } from '@factorymustgrow/shared';
import { getClock } from '../config/clock.js';
import { transaction, type Models } from '../config/database.js';
import { canChangeDecisionStatus, canChangeOrderStatus } from '../domain/order-status.js';
import { HttpError } from '../errors/http-error.js';
import type { Order, OrderStatus, RoutingDecisionStatus } from '../generated/prisma/client.js';
import { toOrder } from '../mappers/order.mapper.js';
import { toRoutingDecision } from '../mappers/routing-decision.mapper.js';
import type { RoutingDecisionRecord } from '../models/routing-decisions.model.js';

// What a transaction below ended with. "expired" is not thrown as an error inside the
// transaction, because that would roll back the expiry it just saved.
type Outcome = { kind: 'done'; result: OrderDecisionResult } | { kind: 'expired' };

export async function approveDecision(decisionId: string): Promise<OrderDecisionResult> {
  const outcome = await transaction(async (tx): Promise<Outcome> => {
    const { decision, order } = await lockDecisionAndOrder(tx, decisionId);

    // Approving twice (a double-click, a retried request) is harmless: return the result.
    if (decision.status === 'APPROVED') return done(decision, order);
    requireProposed(decision, 'approved');

    // Too late: the job would already have had to start. Expire it instead.
    if (plannedStartHasPassed(decision)) {
      await expire(tx, decision, order);
      return { kind: 'expired' };
    }

    await changeDecisionStatus(tx, decision, 'APPROVED');
    const approvedOrder = await changeOrderStatus(tx, order, 'APPROVED');

    return done(await reload(tx, decisionId), approvedOrder);
  });

  if (outcome.kind === 'expired') {
    throw new HttpError(
      409,
      'This proposal has expired because its planned start has passed. ' +
        'The order is back in DRAFT; route it again.',
    );
  }

  return outcome.result;
}

export async function rejectDecision(
  decisionId: string,
  input: RejectDecisionInput,
): Promise<OrderDecisionResult> {
  const outcome = await transaction(async (tx): Promise<Outcome> => {
    const { decision, order } = await lockDecisionAndOrder(tx, decisionId);

    // Rejecting twice is harmless; the first reason is kept.
    if (decision.status === 'REJECTED') return done(decision, order);
    requireProposed(decision, 'rejected');

    await changeDecisionStatus(tx, decision, 'REJECTED', input.reason);
    // Frees the slot straight away. Routing this order again skips the rejected machine.
    await tx.jobs.changeStatusForDecision(decisionId, 'PLANNED', 'CANCELLED');
    const draftOrder = await changeOrderStatus(tx, order, 'DRAFT');

    return done(await reload(tx, decisionId), draftOrder);
  });

  if (outcome.kind === 'expired') {
    throw new Error('Rejecting a decision never expires it');
  }

  return outcome.result;
}

// Loads the decision, then locks its order, so approve, reject, routing and failure
// handling on the same order run one at a time. Both are read again after the lock,
// because another request may have changed them while this one waited.
async function lockDecisionAndOrder(
  tx: Models,
  decisionId: string,
): Promise<{ decision: RoutingDecisionRecord; order: Order }> {
  const found = await tx.routingDecisions.findById(decisionId);
  if (!found) {
    throw new HttpError(404, `Decision not found: ${decisionId}`);
  }

  await tx.orders.lockById(found.orderId);

  const decision = await reload(tx, decisionId);
  const order = await tx.orders.findById(found.orderId);
  if (!order) {
    throw new Error(`Order ${found.orderId} of decision ${decisionId} does not exist`);
  }

  return { decision, order };
}

function requireProposed(decision: RoutingDecisionRecord, action: string): void {
  if (decision.status !== 'PROPOSED') {
    throw new HttpError(
      409,
      `Decision ${decision.id} is ${decision.status}; only PROPOSED decisions can be ${action}.`,
    );
  }
}

function plannedStartHasPassed(decision: RoutingDecisionRecord): boolean {
  const now = getClock().now();

  return decision.jobs.some((job) => job.status === 'PLANNED' && job.plannedStart <= now);
}

// A proposal nobody approved in time: the same effect as a rejection, without a reason.
async function expire(tx: Models, decision: RoutingDecisionRecord, order: Order): Promise<void> {
  await changeDecisionStatus(tx, decision, 'EXPIRED');
  await tx.jobs.changeStatusForDecision(decision.id, 'PLANNED', 'CANCELLED');
  await changeOrderStatus(tx, order, 'DRAFT');
}

async function changeDecisionStatus(
  tx: Models,
  decision: RoutingDecisionRecord,
  to: RoutingDecisionStatus,
  rejectionNote: string | null = null,
): Promise<void> {
  if (!canChangeDecisionStatus(decision.status, to)) {
    throw new HttpError(
      409,
      `Decision ${decision.id} cannot change from ${decision.status} to ${to}.`,
    );
  }

  // Changes only if the status is still what we read; the order lock makes this the normal case.
  if (!(await tx.routingDecisions.changeStatus(decision.id, decision.status, to, rejectionNote))) {
    throw new HttpError(409, `Decision ${decision.id} was changed by another request. Try again.`);
  }
}

async function changeOrderStatus(tx: Models, order: Order, to: OrderStatus): Promise<Order> {
  if (!canChangeOrderStatus(order.status, to)) {
    throw new HttpError(409, `Order ${order.id} is ${order.status} and cannot become ${to}.`);
  }

  return tx.orders.updateStatus(order.id, to, null);
}

async function reload(tx: Models, decisionId: string): Promise<RoutingDecisionRecord> {
  const decision = await tx.routingDecisions.findById(decisionId);
  if (!decision) {
    throw new HttpError(404, `Decision not found: ${decisionId}`);
  }
  return decision;
}

function done(decision: RoutingDecisionRecord, order: Order): Outcome {
  return { kind: 'done', result: { order: toOrder(order), decision: toRoutingDecision(decision) } };
}
