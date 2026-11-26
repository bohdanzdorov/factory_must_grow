// Routing an order (POST /api/orders/:id/route) and listing its decisions
// (GET /api/orders/:id/decisions). The routing itself is in operations/propose-route.ts.
import type { OrderDecisionResult, RoutingDecision } from '@factorymustgrow/shared';
import { db, inBookingTransaction, type Models } from '../config/database.js';
import { canChangeOrderStatus } from '../domain/order-status.js';
import { HttpError } from '../errors/http-error.js';
import { toOrder } from '../mappers/order.mapper.js';
import { toRoutingDecision } from '../mappers/routing-decision.mapper.js';
import { proposeRoute } from '../operations/propose-route.js';

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

  // Read back, so the response includes the job created inside proposeRoute. Routing by hand
  // always saves a decision, even when no machine fits.
  const saved = proposal.decisionId
    ? await tx.routingDecisions.findById(proposal.decisionId)
    : null;
  if (!saved) {
    throw new Error(
      `Routing decision ${String(proposal.decisionId)} was not saved inside its own transaction`,
    );
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
