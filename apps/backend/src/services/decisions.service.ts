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
import { expireProposal, isOverdue } from '../operations/expire-proposal.js';

// What a transaction below ended with. "expired" is not thrown as an error inside the
// transaction, because that would roll back the expiry it just saved.
type Outcome = { kind: 'done'; result: OrderDecisionResult } | { kind: 'expired' };

export async function approveDecision(decisionId: string): Promise<OrderDecisionResult> {
  const outcome = await transaction(async (tx): Promise<Outcome> => {
    const { decision, order } = await lockDecisionAndOrder(tx, decisionId);

    // Approving twice (a double-click, a retried request) is harmless: return the result.
    if (decision.status === 'APPROVED') return done(decision, order);
    requireProposed(decision, 'approved');

    // Too late: the job would already have had to start. Expire it instead. The dispatcher
    // expires overdue proposals on its own too; both hold the order's lock, so only one does.
    if (isOverdue(decision, getClock().now())) {
      await expireProposal(tx, decision, order);
      return { kind: 'expired' };
    }

    // Approving must never confirm work with no slot, or on a machine that broke since.
    await requireBookedOnAvailableMachine(tx, decision);

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

// The proposal must still hold a booked slot (rule 8: no approved order without one), and its
// machine and site must still be able to take work (rule 3). The machine may have failed after
// routing; the operator then rejects the proposal and routes the order again.
async function requireBookedOnAvailableMachine(
  tx: Models,
  decision: RoutingDecisionRecord,
): Promise<void> {
  const job = decision.jobs.find((candidate) => candidate.status === 'PLANNED');
  if (!job) {
    throw new HttpError(
      409,
      `Decision ${decision.id} has no booked slot; reject it and route the order again.`,
    );
  }

  const machine = await tx.machines.findById(job.machineId);
  const site = machine ? await tx.sites.findById(machine.siteId) : null;
  if (!machine || !site) {
    throw new Error(`Machine ${job.machineId} of job ${job.id} or its site does not exist`);
  }

  if (machine.status === 'ERROR' || machine.status === 'OFFLINE') {
    throw new HttpError(
      409,
      `Machine ${machine.id} is ${machine.status}, so this proposal can't be approved. ` +
        'Reject it and route the order again.',
    );
  }
  if (site.status !== 'UP') {
    throw new HttpError(
      409,
      `Site ${site.id} is ${site.status}, so this proposal can't be approved. ` +
        'Reject it and route the order again.',
    );
  }
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
