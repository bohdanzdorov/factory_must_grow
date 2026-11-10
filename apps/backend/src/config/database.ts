import { healthModel } from '../models/health.model.js';
import { machinesModel } from '../models/machines.model.js';
import { ordersModel } from '../models/orders.model.js';
import { shippingLeadTimesModel } from '../models/shipping-lead-times.model.js';
import { sitesModel } from '../models/sites.model.js';
import { prisma, type DbClient } from './prisma.js';

// Every model, bound to one database client.
function createModels(client: DbClient) {
  return {
    health: healthModel(client),
    sites: sitesModel(client),
    machines: machinesModel(client),
    orders: ordersModel(client),
    shippingLeadTimes: shippingLeadTimesModel(client),
  };
}

export type Models = ReturnType<typeof createModels>;

// Models for single queries, each running on its own.
export const db: Models = createModels(prisma);

// Runs `work` in one transaction: every model call on `tx` commits together,
// or all of them roll back if `work` throws.
export function transaction<T>(work: (tx: Models) => Promise<T>): Promise<T> {
  return prisma.$transaction((client) => work(createModels(client)));
}
