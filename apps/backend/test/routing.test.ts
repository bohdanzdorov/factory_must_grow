import { describe, expect, it } from 'vitest';
import {
  routeOrder,
  type Reservation,
  type RoutingInput,
  type RoutingMachine,
} from '../src/domain/routing.js';
import type { Capability, MachineStatus } from '../src/generated/prisma/enums.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-03-01T08:00:00Z');
const APPROVAL_WINDOW = 2 * HOUR;

// Simulated time, relative to NOW.
const at = (offsetMs: number) => new Date(NOW + offsetMs);

function machine(
  id: string,
  options: {
    siteId?: string;
    status?: MachineStatus;
    capabilities?: [Capability, number][];
  } = {},
): RoutingMachine {
  const { siteId = 'HAM', status = 'IDLE', capabilities = [['MILLING_3_AXIS', 10]] } = options;
  return {
    id,
    siteId,
    status,
    capabilities: capabilities.map(([capability, cycleMinutesPerPart]) => ({
      capability,
      cycleMinutesPerPart,
    })),
  };
}

function reservation(machineId: string, startOffset: number, endOffset: number): Reservation {
  return { machineId, start: at(startOffset), end: at(endOffset) };
}

// Defaults: 6 parts × 10 minutes = 60 minutes on a 3-axis mill, due in 10 days.
function input(overrides: Partial<RoutingInput> = {}): RoutingInput {
  return {
    order: {
      quantity: 6,
      requiredCapabilities: ['MILLING_3_AXIS'],
      deadline: at(10 * DAY),
      destination: 'DE',
    },
    machines: [],
    sites: [
      { id: 'HAM', status: 'UP' },
      { id: 'LON', status: 'UP' },
    ],
    reservations: [],
    shippingDays: { HAM: 1, LON: 3 },
    excludedMachineIds: [],
    now: at(0),
    approvalWindowMs: APPROVAL_WINDOW,
    ...overrides,
  };
}

function reasonFor(result: ReturnType<typeof routeOrder>, machineId: string) {
  return result.candidates.find((candidate) => candidate.machineId === machineId)?.rejectionReason;
}

describe('routeOrder: timing', () => {
  it('starts after the approval window and adds production and shipping time', () => {
    const result = routeOrder(input({ machines: [machine('HAM-1')] }));

    expect(result.chosen).toMatchObject({
      machineId: 'HAM-1',
      rank: 1,
      rejectionReason: null,
      earliestStart: at(2 * HOUR),
      finishAt: at(3 * HOUR),
      arrivalAt: at(DAY + 3 * HOUR),
      // 10 days − (1 day + 3 hours)
      slackMinutes: (9 * DAY - 3 * HOUR) / MINUTE,
    });
  });

  it('adds the cycle times of every required capability', () => {
    const result = routeOrder(
      input({
        order: {
          quantity: 6,
          requiredCapabilities: ['TURNING', 'MILLING_3_AXIS'],
          deadline: at(10 * DAY),
          destination: 'DE',
        },
        machines: [
          machine('LON-TURNMILL-1', {
            siteId: 'LON',
            capabilities: [
              ['TURNING', 7],
              ['MILLING_3_AXIS', 11],
            ],
          }),
        ],
      }),
    );

    // 6 parts × (7 + 11) minutes = 108 minutes
    expect(result.chosen?.finishAt).toEqual(at(2 * HOUR + 108 * MINUTE));
  });
});

describe('routeOrder: finding a slot', () => {
  it('waits for a fully booked machine and prefers a free one', () => {
    const result = routeOrder(
      input({
        machines: [machine('HAM-1'), machine('HAM-2')],
        reservations: [reservation('HAM-1', 0, 5 * DAY)],
      }),
    );

    expect(result.chosen?.machineId).toBe('HAM-2');
    expect(result.candidates.find((c) => c.machineId === 'HAM-1')?.earliestStart).toEqual(
      at(5 * DAY),
    );
  });

  it('uses a gap between reservations when the job fits', () => {
    const result = routeOrder(
      input({
        machines: [machine('HAM-1')],
        reservations: [
          reservation('HAM-1', HOUR, 2.5 * HOUR),
          reservation('HAM-1', 4 * HOUR, 6 * HOUR),
        ],
      }),
    );

    // The 90-minute gap from 2.5 h to 4 h fits the 60-minute job.
    expect(result.chosen?.earliestStart).toEqual(at(2.5 * HOUR));
  });

  it('skips a gap that is too short', () => {
    const result = routeOrder(
      input({
        machines: [machine('HAM-1')],
        reservations: [
          reservation('HAM-1', HOUR, 2.5 * HOUR),
          reservation('HAM-1', 3 * HOUR, 6 * HOUR),
        ],
      }),
    );

    expect(result.chosen?.earliestStart).toEqual(at(6 * HOUR));
  });

  it('fits a job that ends exactly when the next reservation starts', () => {
    const result = routeOrder(
      input({
        machines: [machine('HAM-1')],
        reservations: [reservation('HAM-1', 3 * HOUR, 4 * HOUR)],
      }),
    );

    expect(result.chosen?.earliestStart).toEqual(at(2 * HOUR));
    expect(result.chosen?.finishAt).toEqual(at(3 * HOUR));
  });

  it('handles reservations that overlap each other', () => {
    const result = routeOrder(
      input({
        machines: [machine('HAM-1')],
        reservations: [
          reservation('HAM-1', 3 * HOUR, 4 * HOUR),
          reservation('HAM-1', 2 * HOUR, 5 * HOUR),
        ],
      }),
    );

    expect(result.chosen?.earliestStart).toEqual(at(5 * HOUR));
  });
});

describe('routeOrder: rejections', () => {
  it('rejects a machine without a required capability', () => {
    const result = routeOrder(
      input({ machines: [machine('HAM-LATHE-1', { capabilities: [['TURNING', 5]] })] }),
    );

    expect(reasonFor(result, 'HAM-LATHE-1')).toBe('MISSING_CAPABILITY');
    expect(result.chosen).toBeNull();
  });

  it('rejects machines in ERROR or OFFLINE, but not RUNNING ones', () => {
    const result = routeOrder(
      input({
        machines: [
          machine('HAM-1', { status: 'ERROR' }),
          machine('HAM-2', { status: 'OFFLINE' }),
          machine('HAM-3', { status: 'RUNNING' }),
        ],
      }),
    );

    expect(reasonFor(result, 'HAM-1')).toBe('MACHINE_UNAVAILABLE');
    expect(reasonFor(result, 'HAM-2')).toBe('MACHINE_UNAVAILABLE');
    expect(result.chosen?.machineId).toBe('HAM-3');
  });

  it('rejects machines at a site that is down', () => {
    const result = routeOrder(
      input({
        machines: [machine('HAM-1')],
        sites: [{ id: 'HAM', status: 'DOWN' }],
      }),
    );

    expect(reasonFor(result, 'HAM-1')).toBe('SITE_DOWN');
  });

  it('rejects machines whose site has no shipping route to the destination', () => {
    const result = routeOrder(input({ machines: [machine('HAM-1')], shippingDays: { LON: 3 } }));

    expect(reasonFor(result, 'HAM-1')).toBe('NO_SHIPPING_ROUTE');
  });

  it('reports an operator rejection before any other reason', () => {
    const result = routeOrder(
      input({
        machines: [machine('HAM-LATHE-1', { capabilities: [['TURNING', 5]] })],
        excludedMachineIds: ['HAM-LATHE-1'],
      }),
    );

    expect(reasonFor(result, 'HAM-LATHE-1')).toBe('REJECTED_BY_OPERATOR');
  });

  it('rejects a machine that would miss the deadline, keeping its timing', () => {
    const result = routeOrder(
      input({
        order: {
          quantity: 6,
          requiredCapabilities: ['MILLING_3_AXIS'],
          deadline: at(DAY),
          destination: 'DE',
        },
        machines: [machine('LON-1', { siteId: 'LON' })],
      }),
    );

    const candidate = result.candidates[0];
    expect(candidate?.rejectionReason).toBe('MISSES_DEADLINE');
    expect(candidate?.arrivalAt).toEqual(at(3 * DAY + 3 * HOUR));
    expect(candidate?.slackMinutes).toBe(-(2 * DAY + 3 * HOUR) / MINUTE);
    expect(result.chosen).toBeNull();
  });
});

describe('routeOrder: ranking', () => {
  it('prefers the machine with the most slack', () => {
    const result = routeOrder(
      input({ machines: [machine('LON-1', { siteId: 'LON' }), machine('HAM-1')] }),
    );

    expect(result.candidates.map((c) => [c.machineId, c.rank])).toEqual([
      ['HAM-1', 1],
      ['LON-1', 2],
    ]);
  });

  it('breaks a slack tie by the least loaded site', () => {
    const result = routeOrder(
      input({
        machines: [
          machine('HAM-1'),
          // Busy with other work, and cannot take this order itself.
          machine('HAM-LATHE-1', { capabilities: [['TURNING', 5]] }),
          machine('LON-1', { siteId: 'LON' }),
        ],
        reservations: [reservation('HAM-LATHE-1', 0, 8 * HOUR)],
        shippingDays: { HAM: 1, LON: 1 },
      }),
    );

    expect(result.chosen?.machineId).toBe('LON-1');
  });

  it('ignores reservations that are already over when measuring site load', () => {
    const result = routeOrder(
      input({
        machines: [
          machine('HAM-1'),
          machine('HAM-LATHE-1', { capabilities: [['TURNING', 5]] }),
          machine('LON-1', { siteId: 'LON' }),
        ],
        reservations: [reservation('HAM-LATHE-1', -8 * HOUR, -HOUR)],
        shippingDays: { HAM: 1, LON: 1 },
      }),
    );

    // Both sites have no remaining load, so the machine id decides.
    expect(result.chosen?.machineId).toBe('HAM-1');
  });

  it('breaks a full tie by machine id, whatever order machines arrive in', () => {
    const machines = [machine('HAM-MILL5-2'), machine('HAM-MILL5-1')];

    const forward = routeOrder(input({ machines }));
    const reversed = routeOrder(input({ machines: [...machines].reverse() }));

    expect(forward.chosen?.machineId).toBe('HAM-MILL5-1');
    expect(reversed).toEqual(forward);
  });

  it('lists viable machines by rank, then rejected machines by id', () => {
    const result = routeOrder(
      input({
        machines: [
          machine('B-LATHE', { capabilities: [['TURNING', 5]] }),
          machine('LON-1', { siteId: 'LON' }),
          machine('A-LATHE', { capabilities: [['TURNING', 5]] }),
          machine('HAM-1'),
        ],
      }),
    );

    expect(result.candidates.map((c) => c.machineId)).toEqual([
      'HAM-1',
      'LON-1',
      'A-LATHE',
      'B-LATHE',
    ]);
  });
});

describe('routeOrder: explanation', () => {
  it('names the chosen machine and counts rejections by reason', () => {
    const result = routeOrder(
      input({
        machines: [
          machine('HAM-1'),
          machine('HAM-LATHE-1', { capabilities: [['TURNING', 5]] }),
          machine('HAM-2', { status: 'OFFLINE' }),
        ],
      }),
    );

    expect(result.explanation).toBe(
      'Chose HAM-1 at HAM: starts 2026-03-01T10:00:00.000Z, finishes 2026-03-01T11:00:00.000Z, ' +
        'arrives 2026-03-02T11:00:00.000Z with 8.9 days to spare. 1 viable machine; ' +
        'rejected: 1 missing a capability, 1 machine unavailable.',
    );
  });

  it('explains why nothing was chosen', () => {
    const result = routeOrder(
      input({ machines: [machine('HAM-LATHE-1', { capabilities: [['TURNING', 5]] })] }),
    );

    expect(result.explanation).toBe('No eligible machine. Rejected: 1 missing a capability.');
  });

  it('handles having no machines at all', () => {
    const result = routeOrder(input());

    expect(result.chosen).toBeNull();
    expect(result.explanation).toBe('No eligible machine. Rejected: no machines to consider.');
  });
});
