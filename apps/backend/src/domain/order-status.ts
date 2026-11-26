// Which status changes are allowed, for orders and for routing decisions. Every service
// checks a change here before saving it, so an impossible change (such as COMPLETE back to
// DRAFT) is refused everywhere in the same way. Explained in docs/design-decisions.md.
import type { OrderStatus, RoutingDecisionStatus } from '../generated/prisma/enums.js';

// For each status, the statuses an order may move to next. Comments name what triggers them.
const orderTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  // Routing finds a machine, or finds none.
  DRAFT: ['ROUTED', 'BLOCKED'],
  // Routed again, by hand or by the blocked-order retry: a first proposal, or a reroute for an
  // order whose machine failed. May still find nothing.
  BLOCKED: ['ROUTED', 'REROUTE_PENDING', 'BLOCKED'],
  // Approved; rejected or expired (back to DRAFT); or the proposed machine fails first.
  ROUTED: ['APPROVED', 'DRAFT', 'REROUTE_PENDING', 'BLOCKED'],
  // The job starts; or the machine fails before it does.
  APPROVED: ['IN_PRODUCTION', 'REROUTE_PENDING', 'BLOCKED'],
  // The job completes; or the machine fails mid-job.
  IN_PRODUCTION: ['COMPLETE', 'REROUTE_PENDING', 'BLOCKED'],
  // The reroute is approved; rejected or expired; or the new machine fails too.
  REROUTE_PENDING: ['APPROVED', 'DRAFT', 'REROUTE_PENDING', 'BLOCKED'],
  // Final.
  COMPLETE: [],
};

// A proposal is decided exactly once. Every other status is final.
const decisionTransitions: Record<RoutingDecisionStatus, readonly RoutingDecisionStatus[]> = {
  PROPOSED: ['APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED'],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
  SUPERSEDED: [],
  NO_ELIGIBLE_MACHINE: [],
};

export function canChangeOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return orderTransitions[from].includes(to);
}

export function canChangeDecisionStatus(
  from: RoutingDecisionStatus,
  to: RoutingDecisionStatus,
): boolean {
  return decisionTransitions[from].includes(to);
}
