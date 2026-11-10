import type { Site, SiteDetail } from '@factorymustgrow/shared';
import type { Site as SiteRecord } from '../generated/prisma/client.js';
import type { SiteDetailRecord } from '../models/sites.model.js';
import { toMachine } from './machine.mapper.js';

// Database record → API response.
export function toSite(record: SiteRecord): Site {
  return {
    id: record.id,
    name: record.name,
    country: record.country,
    status: record.status,
  };
}

// Database record → API response.
export function toSiteDetail(record: SiteDetailRecord): SiteDetail {
  return { ...toSite(record), machines: record.machines.map(toMachine) };
}
