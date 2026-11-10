// Seed data for local development and demos. Described in docs/seed-data.md;
// keep that file in sync when changing this one.
import type { Capability } from '../src/generated/prisma/enums.js';

export const sites = [
  { id: 'HAM', name: 'Hamburg', country: 'DE' },
  { id: 'LON', name: 'London', country: 'GB' },
  { id: 'KYI', name: 'Kyiv', country: 'UA' },
];

interface SeedMachine {
  id: string;
  siteId: string;
  name: string;
  capabilities: { capability: Capability; cycleMinutesPerPart: number }[];
}

export const machines: SeedMachine[] = [
  {
    id: 'HAM-MILL3-1',
    siteId: 'HAM',
    name: '3-axis mill',
    capabilities: [{ capability: 'MILLING_3_AXIS', cycleMinutesPerPart: 8 }],
  },
  {
    id: 'HAM-MILL5-1',
    siteId: 'HAM',
    name: '5-axis mill',
    capabilities: [
      { capability: 'MILLING_5_AXIS', cycleMinutesPerPart: 12 },
      { capability: 'MILLING_3_AXIS', cycleMinutesPerPart: 10 },
    ],
  },
  {
    // Identical twin of HAM-MILL5-1, for tie-break and double-booking tests.
    id: 'HAM-MILL5-2',
    siteId: 'HAM',
    name: '5-axis mill',
    capabilities: [
      { capability: 'MILLING_5_AXIS', cycleMinutesPerPart: 12 },
      { capability: 'MILLING_3_AXIS', cycleMinutesPerPart: 10 },
    ],
  },
  {
    id: 'HAM-LATHE-1',
    siteId: 'HAM',
    name: 'Lathe',
    capabilities: [{ capability: 'TURNING', cycleMinutesPerPart: 5 }],
  },
  {
    id: 'LON-MILL5-1',
    siteId: 'LON',
    name: '5-axis mill',
    capabilities: [
      { capability: 'MILLING_5_AXIS', cycleMinutesPerPart: 11 },
      { capability: 'MILLING_3_AXIS', cycleMinutesPerPart: 9 },
    ],
  },
  {
    // The only machine that does both turning and milling.
    id: 'LON-TURNMILL-1',
    siteId: 'LON',
    name: 'Turn-mill',
    capabilities: [
      { capability: 'TURNING', cycleMinutesPerPart: 7 },
      { capability: 'MILLING_3_AXIS', cycleMinutesPerPart: 11 },
    ],
  },
  {
    id: 'LON-LATHE-1',
    siteId: 'LON',
    name: 'Lathe',
    capabilities: [{ capability: 'TURNING', cycleMinutesPerPart: 6 }],
  },
  {
    id: 'KYI-MILL3-1',
    siteId: 'KYI',
    name: '3-axis mill',
    capabilities: [{ capability: 'MILLING_3_AXIS', cycleMinutesPerPart: 7 }],
  },
  {
    id: 'KYI-MILL5-1',
    siteId: 'KYI',
    name: '5-axis mill',
    capabilities: [
      { capability: 'MILLING_5_AXIS', cycleMinutesPerPart: 13 },
      { capability: 'MILLING_3_AXIS', cycleMinutesPerPart: 10 },
    ],
  },
  {
    id: 'KYI-CMM-1',
    siteId: 'KYI',
    name: 'CMM inspection',
    capabilities: [{ capability: 'INSPECTION', cycleMinutesPerPart: 4 }],
  },
];

// Days to ship finished parts from a site to the customer's destination country.
export const shippingDays: Record<string, Record<string, number>> = {
  HAM: { DE: 1, GB: 3, FR: 2, UA: 4, US: 7 },
  LON: { DE: 3, GB: 1, FR: 2, UA: 5, US: 6 },
  KYI: { DE: 4, GB: 5, FR: 4, UA: 1, US: 9 },
};

interface SeedOrder {
  partName: string;
  quantity: number;
  requiredCapabilities: Capability[];
  // Deadlines are relative to when the seed runs, so they never fall in the past.
  daysUntilDeadline: number;
  destination: string;
}

export const orders: SeedOrder[] = [
  {
    partName: 'Bracket housing',
    quantity: 40,
    requiredCapabilities: ['MILLING_5_AXIS'],
    daysUntilDeadline: 10,
    destination: 'DE',
  },
  {
    partName: 'Mounting plate',
    quantity: 120,
    requiredCapabilities: ['MILLING_3_AXIS'],
    daysUntilDeadline: 7,
    destination: 'GB',
  },
  {
    partName: 'Drive shaft',
    quantity: 60,
    requiredCapabilities: ['TURNING'],
    daysUntilDeadline: 5,
    destination: 'FR',
  },
  {
    partName: 'Flange adapter',
    quantity: 25,
    requiredCapabilities: ['TURNING', 'MILLING_3_AXIS'],
    daysUntilDeadline: 14,
    destination: 'GB',
  },
  {
    partName: 'Impeller',
    quantity: 10,
    requiredCapabilities: ['MILLING_5_AXIS'],
    daysUntilDeadline: 21,
    destination: 'US',
  },
  {
    partName: 'Sensor mount',
    quantity: 200,
    requiredCapabilities: ['MILLING_3_AXIS'],
    daysUntilDeadline: 12,
    destination: 'UA',
  },
  {
    partName: 'Gearbox cover',
    quantity: 80,
    requiredCapabilities: ['INSPECTION'],
    daysUntilDeadline: 6,
    destination: 'UA',
  },
  {
    partName: 'Bushing',
    quantity: 150,
    requiredCapabilities: ['TURNING'],
    daysUntilDeadline: 9,
    destination: 'DE',
  },
  {
    partName: 'Turbine blade',
    quantity: 15,
    requiredCapabilities: ['MILLING_5_AXIS'],
    daysUntilDeadline: 4,
    destination: 'GB',
  },
  {
    partName: 'Valve body',
    quantity: 30,
    requiredCapabilities: ['TURNING', 'MILLING_3_AXIS'],
    daysUntilDeadline: 20,
    destination: 'DE',
  },
  {
    partName: 'Heat sink',
    quantity: 90,
    requiredCapabilities: ['MILLING_3_AXIS'],
    daysUntilDeadline: 3,
    destination: 'FR',
  },
  {
    partName: 'Pump housing',
    quantity: 35,
    requiredCapabilities: ['MILLING_5_AXIS'],
    daysUntilDeadline: 30,
    destination: 'UA',
  },
  {
    partName: 'Spacer ring',
    quantity: 5,
    requiredCapabilities: ['TURNING'],
    daysUntilDeadline: 2,
    destination: 'GB',
  },
  // Impossible: no single machine does both 5-axis milling and inspection.
  {
    partName: 'Precision manifold',
    quantity: 20,
    requiredCapabilities: ['MILLING_5_AXIS', 'INSPECTION'],
    daysUntilDeadline: 25,
    destination: 'DE',
  },
  // Impossible: the fastest shipping to the US takes 6 days.
  {
    partName: 'Express pin',
    quantity: 50,
    requiredCapabilities: ['TURNING'],
    daysUntilDeadline: 3,
    destination: 'US',
  },
];
