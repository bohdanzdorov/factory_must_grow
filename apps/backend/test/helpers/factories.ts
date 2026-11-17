// Create test rows directly in the database. Every field has a default, so a test
// only states what matters to it.
import { getClock } from '../../src/config/clock.js';
import { prisma } from '../../src/config/prisma.js';
import type {
  Capability,
  JobStatus,
  MachineStatus,
  OrderStatus,
  RoutingDecisionKind,
  RoutingDecisionStatus,
  SiteStatus,
} from '../../src/generated/prisma/enums.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
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
  const now = getClock().now();

  return prisma.order.create({
    data: {
      partName: 'Test part',
      quantity: 10,
      requiredCapabilities: ['MILLING_3_AXIS'],
      deadline: new Date(now.getTime() + 7 * DAY_MS),
      destination: 'DE',
      createdAt: now,
      ...overrides,
    },
  });
}

export async function createRoutingDecision(
  overrides: {
    orderId?: string;
    chosenMachineId?: string | null;
    kind?: RoutingDecisionKind;
    status?: RoutingDecisionStatus;
    explanation?: string;
  } = {},
) {
  const { orderId = (await createOrder()).id, ...fields } = overrides;

  return prisma.routingDecision.create({
    data: {
      explanation: 'Test decision',
      kind: 'INITIAL',
      createdAt: getClock().now(),
      ...fields,
      orderId,
    },
  });
}

// A job on a machine. Without a machine or decision, new ones are created for it.
// By default it starts at the clock's current time and lasts one hour.
export async function createJob(
  overrides: {
    machineId?: string;
    routingDecisionId?: string;
    status?: JobStatus;
    plannedStart?: Date;
    plannedEnd?: Date;
  } = {},
) {
  const now = getClock().now();
  const {
    machineId = (await createMachine()).id,
    routingDecisionId = (await createRoutingDecision()).id,
    plannedStart = now,
    plannedEnd = new Date(plannedStart.getTime() + HOUR_MS),
    ...fields
  } = overrides;

  return prisma.job.create({
    data: { ...fields, machineId, routingDecisionId, plannedStart, plannedEnd },
  });
}
