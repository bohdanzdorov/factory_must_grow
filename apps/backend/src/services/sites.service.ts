import type { Site, SiteDetail, UpdateSiteStatus } from '@factorymustgrow/shared';
import { db, inBookingTransaction, transaction } from '../config/database.js';
import { HttpError } from '../errors/http-error.js';
import { toSite, toSiteDetail } from '../mappers/site.mapper.js';
import { requestBlockedOrderRetry } from '../operations/blocked-orders.js';
import { handleMachineFailure } from '../operations/machine-failure.js';

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

// An operator takes a whole site down, or brings it back. See "Site down" in
// docs/design-decisions.md. Setting the status it already has changes nothing.
export async function setSiteStatus(id: string, input: UpdateSiteStatus): Promise<Site> {
  if (input.status === 'DOWN') {
    // DOWN: every working machine at the site goes OFFLINE and its work is freed, in one
    // transaction. Its orders are rerouted in the background once that is saved.
    const anyFailed = await inBookingTransaction(
      async (tx) => {
        await requireSite(tx.sites.findById(id), id);
        if (!(await tx.sites.changeStatus(id, 'DOWN'))) return false;

        let failed = false;
        for (const machineId of await tx.machines.findIdsBySite(id)) {
          if (await handleMachineFailure(tx, machineId, { type: 'SITE_DOWN', siteId: id })) {
            failed = true;
          }
        }
        return failed;
      },
      { siteId: id },
    );
    if (anyFailed) requestBlockedOrderRetry();
  } else {
    // UP: its machines come back on their next heartbeat (operations/machine-recovery.ts),
    // and each one coming back asks for blocked orders to be retried.
    await transaction(async (tx) => {
      await requireSite(tx.sites.findById(id), id);
      await tx.sites.changeStatus(id, 'UP');
    });
  }

  return toSite(await requireSite(db.sites.findById(id), id));
}

async function requireSite<T>(found: Promise<T | null>, id: string): Promise<T> {
  const site = await found;
  if (!site) {
    throw new HttpError(404, `Site not found: ${id}`);
  }
  return site;
}
