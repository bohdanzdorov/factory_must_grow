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

// Used by the API to validate requests and by the order form, so both show the same messages.
export const CreateOrderSchema = z.object({
  partName: z
    .string({ error: 'Enter a part name' })
    .trim()
    .min(1, 'Enter a part name')
    .max(200, 'Use at most 200 characters'),
  quantity: z
    .number({ error: 'Enter a quantity' })
    .int('Use a whole number')
    .min(1, 'Enter at least 1')
    .max(10_000, 'Enter at most 10,000'),
  requiredCapabilities: z
    .array(CapabilitySchema, { error: 'Choose at least one capability' })
    .min(1, 'Choose at least one capability')
    .refine((capabilities) => new Set(capabilities).size === capabilities.length, {
      message: 'Capabilities must not repeat',
    }),
  // The backend also checks that the deadline is in the future, using simulated time.
  deadline: z.iso.datetime({ offset: true, error: 'Enter a valid date and time' }),
  // The backend also checks that shipping times exist for this destination.
  destination: z
    .string({ error: 'Choose a destination' })
    .trim()
    .min(1, 'Choose a destination')
    .max(100, 'Use at most 100 characters'),
});
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export const ListOrdersQuerySchema = z.object({
  status: OrderStatusSchema.optional(),
});
export type ListOrdersQuery = z.infer<typeof ListOrdersQuerySchema>;
