// Create test rows directly in the database. Every field has a default, so a test
// only states what matters to it.
import { prisma } from '../../src/config/prisma.js';
import type {
  Capability,
  MachineStatus,
  OrderStatus,
  SiteStatus,
} from '../../src/generated/prisma/enums.js';

const DAY_MS = 24 * 60 * 60 * 1000;
let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${String(counter)}`;
}

export function createSite(
  overrides: { id?: string; name?: string; country?: string; status?: SiteStatus } = {},
) {
  return prisma.site.create({
    data: { id: nextId('SITE'), name: 'Test site', country: 'DE', ...overrides },
  });
}

export async function createMachine(
  overrides: {
    id?: string;
    siteId?: string;
    name?: string;
    status?: MachineStatus;
    lastSeq?: bigint;
    capabilities?: { capability: Capability; cycleMinutesPerPart: number }[];
  } = {},
) {
  const {
    capabilities = [{ capability: 'MILLING_3_AXIS', cycleMinutesPerPart: 10 }],
    siteId = (await createSite()).id,
    ...fields
  } = overrides;

  return prisma.machine.create({
    data: {
      id: nextId('MACHINE'),
      name: 'Test machine',
      ...fields,
      siteId,
      capabilities: { create: capabilities },
    },
    include: { capabilities: true },
  });
}

export function createShippingLeadTime(data: {
  siteId: string;
  destination: string;
  days: number;
}) {
  return prisma.shippingLeadTime.create({ data });
}

export function createOrder(
  overrides: {
    partName?: string;
    quantity?: number;
    requiredCapabilities?: Capability[];
    deadline?: Date;
    destination?: string;
    status?: OrderStatus;
    createdAt?: Date;
  } = {},
) {
  return prisma.order.create({
    data: {
      partName: 'Test part',
      quantity: 10,
      requiredCapabilities: ['MILLING_3_AXIS'],
      deadline: new Date(Date.now() + 7 * DAY_MS),
      destination: 'DE',
      ...overrides,
    },
  });
}
