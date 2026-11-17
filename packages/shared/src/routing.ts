import { z } from 'zod';
import {
  CandidateRejectionReasonSchema,
  JobStatusSchema,
  RoutingDecisionKindSchema,
  RoutingDecisionStatusSchema,
} from './enums.js';
import { OrderSchema } from './order.js';

// A machine's time slot for an order.
export const JobSchema = z.object({
  id: z.string(),
  machineId: z.string(),
  status: JobStatusSchema,
  plannedStart: z.iso.datetime(),
  plannedEnd: z.iso.datetime(),
});
export type Job = z.infer<typeof JobSchema>;

// What routing found out about one machine.
export const RoutingCandidateSchema = z.object({
  machineId: z.string(),
  siteId: z.string(),
  // 1 is the best viable machine. Null when rejected.
  rank: z.number().int().positive().nullable(),
  rejectionReason: CandidateRejectionReasonSchema.nullable(),
  // Null when the machine was rejected before its schedule was looked at.
  earliestStart: z.iso.datetime().nullable(),
  finishAt: z.iso.datetime().nullable(),
  arrivalAt: z.iso.datetime().nullable(),
  // Deadline minus arrival. Negative means late.
  slackMinutes: z.number().nullable(),
});
export type RoutingCandidate = z.infer<typeof RoutingCandidateSchema>;

export const RoutingDecisionSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  kind: RoutingDecisionKindSchema,
  status: RoutingDecisionStatusSchema,
  // Null when no machine was eligible.
  chosenMachineId: z.string().nullable(),
  explanation: z.string(),
  // The operator's reason for rejecting the proposal. Null unless REJECTED.
  rejectionNote: z.string().nullable(),
  // The decision this one replaces, for reroutes.
  supersedesId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  // Viable machines by rank, then rejected machines by id.
  candidates: z.array(RoutingCandidateSchema),
  // The slots this decision booked: one today, several if order splitting is added.
  jobs: z.array(JobSchema),
});
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

// An order together with one of its decisions. Returned by every action on a decision:
// routing an order, and approving or rejecting a proposal.
export const OrderDecisionResultSchema = z.object({
  order: OrderSchema,
  decision: RoutingDecisionSchema,
});
export type OrderDecisionResult = z.infer<typeof OrderDecisionResultSchema>;

// Body of POST /api/decisions/:id/reject.
export const RejectDecisionSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RejectDecisionInput = z.infer<typeof RejectDecisionSchema>;
