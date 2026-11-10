import { z } from 'zod';

// These must match the enums in apps/backend/prisma/schema.prisma.
// apps/backend/src/models/enum-sync.ts fails typechecking if they drift apart.

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
