import { z } from 'zod';
import { SiteStatusSchema } from './enums.js';
import { MachineSchema } from './machine.js';

export const SiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  status: SiteStatusSchema,
});
export type Site = z.infer<typeof SiteSchema>;

export const SiteDetailSchema = SiteSchema.extend({
  machines: z.array(MachineSchema),
});
export type SiteDetail = z.infer<typeof SiteDetailSchema>;
