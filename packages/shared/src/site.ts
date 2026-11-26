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

// Body of POST /api/sites/:id/status: an operator takes a whole site down, or brings it back.
export const UpdateSiteStatusSchema = z.object({
  status: SiteStatusSchema,
});
export type UpdateSiteStatus = z.infer<typeof UpdateSiteStatusSchema>;
