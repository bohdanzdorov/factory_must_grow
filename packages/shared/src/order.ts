import { z } from 'zod';
import { CapabilitySchema, OrderStatusSchema } from './enums.js';

export const OrderSchema = z.object({
  id: z.string(),
  partName: z.string(),
  quantity: z.number().int(),
  requiredCapabilities: z.array(CapabilitySchema),
  deadline: z.iso.datetime(),
  destination: z.string(),
  status: OrderStatusSchema,
  blockedReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Order = z.infer<typeof OrderSchema>;

export const CreateOrderSchema = z.object({
  partName: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(10_000),
  requiredCapabilities: z
    .array(CapabilitySchema)
    .min(1)
    .refine((capabilities) => new Set(capabilities).size === capabilities.length, {
      message: 'Capabilities must not repeat',
    }),
  deadline: z.iso
    .datetime({ offset: true })
    .refine((deadline) => new Date(deadline).getTime() > Date.now(), {
      message: 'Deadline must be in the future',
    }),
  // The backend also checks that shipping times exist for this destination.
  destination: z.string().trim().min(1).max(100),
});
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export const ListOrdersQuerySchema = z.object({
  status: OrderStatusSchema.optional(),
});
export type ListOrdersQuery = z.infer<typeof ListOrdersQuerySchema>;
