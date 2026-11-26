// Expiring a proposal nobody approved in time. Shared by approving too late
// (services/decisions.service.ts) and the dispatcher, which expires overdue proposals on its
// own (background/dispatcher.ts). See "Dispatcher" in docs/design-decisions.md.
import type { Models } from '../config/database.js';
import { canChangeOrderStatus } from '../domain/order-status.js';
import type { Order } from '../generated/prisma/client.js';
import type { RoutingDecisionRecord } from '../models/routing-decisions.model.js';

// A proposal is overdue once its booked job should already have started: approving it now
// would confirm work that is already late.
export function isOverdue(decision: RoutingDecisionRecord, now: Date): boolean {
  return decision.jobs.some((job) => job.status === 'PLANNED' && job.plannedStart <= now);
}

// The same effect as a rejection, without a reason: the decision becomes EXPIRED, its slot is
// freed (job CANCELLED), and the order goes back to DRAFT to be routed again.
//
// The caller must hold the order's lock and have read the decision after taking it, so the
// decision is still PROPOSED.
export async function expireProposal(
  tx: Models,
  decision: RoutingDecisionRecord,
  order: Order,
): Promise<void> {
  if (!(await tx.routingDecisions.changeStatus(decision.id, 'PROPOSED', 'EXPIRED'))) {
    throw new Error(`Decision ${decision.id} is no longer PROPOSED and cannot expire`);
  }
  await tx.jobs.changeStatusForDecision(decision.id, 'PLANNED', 'CANCELLED');

  if (!canChangeOrderStatus(order.status, 'DRAFT')) {
    throw new Error(`Order ${order.id} is ${order.status} and cannot go back to DRAFT`);
  }
  await tx.orders.updateStatus(order.id, 'DRAFT', null);
}
