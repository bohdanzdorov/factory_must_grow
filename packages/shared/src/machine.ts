import { z } from 'zod';
import { CapabilitySchema, MachineStatusSchema } from './enums.js';

export const MachineCapabilitySchema = z.object({
  capability: CapabilitySchema,
  cycleMinutesPerPart: z.number().positive(),
});
export type MachineCapability = z.infer<typeof MachineCapabilitySchema>;

export const MachineSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  name: z.string(),
  status: MachineStatusSchema,
  lastHeartbeatAt: z.iso.datetime().nullable(),
  capabilities: z.array(MachineCapabilitySchema),
});
export type Machine = z.infer<typeof MachineSchema>;

export const ListMachinesQuerySchema = z.object({
  siteId: z.string().min(1).optional(),
});
export type ListMachinesQuery = z.infer<typeof ListMachinesQuerySchema>;
