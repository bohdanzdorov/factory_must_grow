import type { Site, SiteDetail } from '@factorymustgrow/shared';
import { db } from '../config/database.js';
import { HttpError } from '../errors/http-error.js';
import { toSite, toSiteDetail } from '../mappers/site.mapper.js';

export async function listSites(): Promise<Site[]> {
  const records = await db.sites.findAll();

  return records.map(toSite);
}

export async function getSite(id: string): Promise<SiteDetail> {
  const record = await db.sites.findByIdWithMachines(id);

  if (!record) {
    throw new HttpError(404, `Site not found: ${id}`);
  }

  return toSiteDetail(record);
}
