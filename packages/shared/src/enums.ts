import { z } from 'zod';

// These must match the enums in apps/backend/prisma/schema.prisma.
// apps/backend/src/checks/enum-sync.ts fails typechecking if they drift apart.

export const CapabilitySchema = z.enum([
  'MILLING_3_AXIS',
  'MILLING_5_AXIS',
  'TURNING',
  'INSPECTION',
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const SiteStatusSchema = z.enum(['UP', 'DOWN']);
export type SiteStatus = z.infer<typeof SiteStatusSchema>;

export const MachineStatusSchema = z.enum(['IDLE', 'RUNNING', 'ERROR', 'OFFLINE']);
export type MachineStatus = z.infer<typeof MachineStatusSchema>;

export const OrderStatusSchema = z.enum([
  'DRAFT',
  'ROUTED',
  'APPROVED',
  'IN_PRODUCTION',
  'COMPLETE',
  'BLOCKED',
  'REROUTE_PENDING',
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const JobStatusSchema = z.enum(['PLANNED', 'RUNNING', 'COMPLETE', 'RELEASED', 'CANCELLED']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const RoutingDecisionKindSchema = z.enum(['INITIAL', 'REROUTE']);
export type RoutingDecisionKind = z.infer<typeof RoutingDecisionKindSchema>;

export const RoutingDecisionStatusSchema = z.enum([
  'PROPOSED',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
  'NO_ELIGIBLE_MACHINE',
]);
export type RoutingDecisionStatus = z.infer<typeof RoutingDecisionStatusSchema>;

export const CandidateRejectionReasonSchema = z.enum([
  'MISSING_CAPABILITY',
  'MACHINE_UNAVAILABLE',
  'SITE_DOWN',
  'MISSES_DEADLINE',
  'REJECTED_BY_OPERATOR',
  'NO_SHIPPING_ROUTE',
]);
export type CandidateRejectionReason = z.infer<typeof CandidateRejectionReasonSchema>;
